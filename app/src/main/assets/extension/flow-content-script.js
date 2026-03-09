/**
 * Flow Content Script — Auto Post V2 Automation
 * รันบน Google Flow (labs.google/fx) เพื่อ automate:
 *   - Upload ภาพ (นางแบบ + สินค้า)
 *   - พิมพ์ prompt
 *   - สร้างภาพ / สร้างวิดีโอ
 *   - ตรวจสอบเสร็จ + ดาวน์โหลด
 *
 * Message Types ที่รับจาก background.js:
 *   FLOW_UPLOAD_IMAGES  — อัพโหลดภาพ reference
 *   FLOW_CREATE_IMAGE   — สร้างภาพ (ตั้งค่า + prompt + กด Create)
 *   FLOW_CREATE_VIDEO   — สร้างวิดีโอ (ตั้งค่า + prompt + กด Create)
 *   FLOW_DOWNLOAD       — ดาวน์โหลดผลลัพธ์
 *   FLOW_PING           — ตรวจสอบว่า script โหลดแล้ว
 */

// ============================================================
// UTILITY
// ============================================================

const FLOW_LOG_PREFIX = '[FlowBot]';
const fl = (...args) => console.log(FLOW_LOG_PREFIX, ...args);
const flErr = (...args) => console.error(FLOW_LOG_PREFIX, ...args);
const wait = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
// DOM HELPERS
// ============================================================

/**
 * หาปุ่มจาก Google Symbols icon name
 * เช่น: findByIcon('add_2'), findByIcon('upload'), findByIcon('arrow_forward')
 */
function findByIcon(iconName, container = document) {
    const icons = container.querySelectorAll('i.google-symbols, i.material-icons, i.material-icons-outlined');
    for (const icon of icons) {
        if (icon.textContent.trim() === iconName) {
            return icon.closest('button') || icon.parentElement;
        }
    }
    return null;
}

/**
 * หาปุ่มจาก text content
 */
function findByText(text, tag = 'button', container = document) {
    const elements = container.querySelectorAll(tag);
    for (const el of elements) {
        if (el.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
            return el;
        }
    }
    return null;
}

/**
 * รอ element ปรากฏ (retry)
 */
async function waitFor(selectorOrFn, timeout = 15000, interval = 500) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const el = typeof selectorOrFn === 'function'
            ? selectorOrFn()
            : document.querySelector(selectorOrFn);
        if (el) return el;
        await wait(interval);
    }
    return null;
}

/**
 * Human-like click — ส่ง event sequence ครบ
 * mouseenter → mouseover → mousemove → mousedown → mouseup → click
 */
function humanClick(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y };
    ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'].forEach(type => {
        element.dispatchEvent(new MouseEvent(type, opts));
    });
    return true;
}

/**
 * Click ที่ handle button-overlay ด้วย (เหมือน story-content-script.js)
 */
function clickWithOverlay(btn) {
    if (!btn) return false;
    const overlay = btn.querySelector('[data-type="button-overlay"]');
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    const events = ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'];
    if (overlay) events.forEach(t => overlay.dispatchEvent(new MouseEvent(t, opts)));
    events.forEach(t => btn.dispatchEvent(new MouseEvent(t, opts)));
    btn.click();
    return true;
}

/**
 * แปลง base64 data URL เป็น File object
 */
function base64ToFile(dataUrl, filename = 'image.png') {
    const [header, data] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
    const binary = atob(data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new File([arr], filename, { type: mime });
}

/**
 * หา combobox และเลือก option
 */
async function selectCombobox(labelOrBtn, optionText) {
    let btn = labelOrBtn;
    if (typeof labelOrBtn === 'string') {
        const comboboxes = document.querySelectorAll('button[role="combobox"]');
        for (const cb of comboboxes) {
            if (cb.textContent.toLowerCase().includes(labelOrBtn.toLowerCase())) {
                btn = cb;
                break;
            }
        }
    }
    if (!btn || typeof btn === 'string') return false;

    clickWithOverlay(btn);
    await wait(600);

    const options = document.querySelectorAll('[role="option"]');
    for (const opt of options) {
        if (opt.textContent.trim().toLowerCase().includes(optionText.toLowerCase())) {
            humanClick(opt);
            await wait(400);
            fl('Combobox selected:', opt.textContent.trim());
            return true;
        }
    }

    // Fallback: Radix popper
    const popper = document.querySelector('[data-radix-popper-content-wrapper]');
    if (popper) {
        const items = popper.querySelectorAll('*');
        for (const item of items) {
            if (item.textContent?.trim().toLowerCase().includes(optionText.toLowerCase()) && item.children.length === 0) {
                humanClick(item);
                await wait(400);
                fl('Combobox selected (popper):', item.textContent.trim());
                return true;
            }
        }
    }

    fl('Option not found:', optionText);
    return false;
}

// ============================================================
// FLOW UI AUTOMATION — NEW FLOW (labs.google/fx)
// ============================================================

/**
 * กดปุ่ม "+" เพื่อเปิด Asset Panel
 * ปุ่ม: button ที่มี icon "add_2"
 */
async function openAssetPanel() {
    fl('Opening Asset Panel...');
    const addBtn = await waitFor(() => findByIcon('add_2'), 10000);
    if (!addBtn) {
        flErr('ปุ่ม + (add_2) ไม่เจอ');
        return false;
    }
    clickWithOverlay(addBtn);
    await wait(1000);

    // รอ asset panel เปิด
    const panel = await waitFor('[role="dialog"]', 5000);
    if (panel) {
        fl('Asset Panel opened');
        return true;
    }
    fl('Asset Panel did not open — retrying...');
    clickWithOverlay(addBtn);
    await wait(1500);
    return !!document.querySelector('[role="dialog"]');
}

/**
 * กดปุ่ม Upload ใน Asset Panel
 * ปุ่ม: button ที่มี icon "upload" (อยู่ข้างขวา Search for Assets)
 */
async function clickUploadButton() {
    fl('Looking for Upload button...');

    // หาจาก icon "upload"
    let uploadBtn = findByIcon('upload');
    if (!uploadBtn) {
        // หาจาก text
        uploadBtn = findByText('upload image') || findByText('upload');
    }
    if (uploadBtn) {
        humanClick(uploadBtn);
        fl('Clicked Upload button');
        await wait(1000);
        return true;
    }
    flErr('Upload button not found');
    return false;
}

/**
 * อัพโหลดภาพผ่าน file input
 * @param {string} imageData — base64 data URL หรือ image URL
 * @param {string} filename — ชื่อไฟล์
 */
async function uploadImage(imageData, filename = 'image.png') {
    fl('Uploading image:', filename);

    let file;
    if (imageData.startsWith('data:')) {
        file = base64ToFile(imageData, filename);
    } else {
        // URL → fetch → File
        try {
            const resp = await fetch(imageData);
            const blob = await resp.blob();
            file = new File([blob], filename, { type: blob.type || 'image/png' });
        } catch (e) {
            flErr('Failed to fetch image URL:', e.message);
            return false;
        }
    }

    // หา file input — retry
    let fileInput = null;
    for (let i = 0; i < 10; i++) {
        const inputs = document.querySelectorAll('input[type="file"]');
        if (inputs.length > 0) {
            fileInput = inputs[inputs.length - 1]; // เอาอันสุดท้าย
            break;
        }
        fl(`Waiting for file input... (${i + 1}/10)`);
        await wait(1000);
    }

    if (!fileInput) {
        flErr('File input not found');
        return false;
    }

    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fl('Image uploaded:', filename, `(${(file.size / 1024).toFixed(1)} KB)`);

    await wait(2000);
    return true;
}

/**
 * Full upload flow: เปิด Asset Panel → กด Upload → inject file
 */
async function fullUploadImage(imageData, filename = 'image.png') {
    // 1. เปิด Asset Panel
    const panelOpened = await openAssetPanel();
    if (!panelOpened) {
        flErr('Cannot open Asset Panel');
        return false;
    }
    await wait(500);

    // 2. กด Upload button
    const uploadClicked = await clickUploadButton();
    if (!uploadClicked) {
        flErr('Cannot click Upload button');
        return false;
    }
    await wait(500);

    // 3. inject file
    const uploaded = await uploadImage(imageData, filename);
    return uploaded;
}

/**
 * Handle Crop Dialog (ถ้าปรากฏ)
 */
async function handleCropDialog(isPortrait = true) {
    fl('Checking for Crop dialog...');

    const cropBtn = await waitFor(
        () => findByText('crop and save') || findByText('crop'),
        5000
    );

    if (!cropBtn) {
        fl('No Crop dialog — skipping');
        return;
    }

    fl('Crop dialog found');

    // เลือก Portrait/Landscape (ถ้ามี combobox)
    const targetMode = isPortrait ? 'portrait' : 'landscape';
    const cropCombobox = cropBtn.closest('[role="dialog"]')?.querySelector('button[role="combobox"]')
        || document.querySelector('button[role="combobox"]');

    if (cropCombobox) {
        const currentMode = cropCombobox.textContent?.trim().toLowerCase() || '';
        if (!currentMode.includes(targetMode)) {
            await selectCombobox(cropCombobox, targetMode);
            await wait(1000);
        }
    }

    // กด Crop and Save
    await wait(500);
    const saveBtn = findByText('crop and save') || findByText('save');
    if (saveBtn) {
        humanClick(saveBtn);
        fl('Clicked Crop and Save');
        await wait(3000);
    }
}

// ============================================================
// MODE SELECTION (Image / Video / Settings)
// ============================================================

/**
 * เลือก Image tab
 * UI ใหม่: button[role="tab"] / button[role="tab"], button[role="radio"] ที่มี icon "image"
 * Legacy: button[id*="trigger-IMAGE"]
 */
async function selectImageMode() {
    fl('Selecting IMAGE mode...');

    // วิธี 1 (UI ใหม่): tab/radio button ที่มี icon "image"
    const tabs = document.querySelectorAll('button[role="tab"], button[role="tab"], button[role="radio"]');
    for (const tab of tabs) {
        const icon = tab.querySelector('i.google-symbols, i.material-icons');
        if (icon && icon.textContent?.trim() === 'image') {
            const state = tab.getAttribute('data-state');
            if (state === 'active' || state === 'on') {
                fl('Already on Images tab');
                return true;
            }
            clickWithOverlay(tab);
            fl('IMAGE mode selected (tab)');
            await wait(1000);
            return true;
        }
    }
    // Tab text fallback
    for (const tab of tabs) {
        if (tab.textContent?.trim().toLowerCase().includes('images')) {
            clickWithOverlay(tab);
            fl('IMAGE mode selected (text match)');
            await wait(1000);
            return true;
        }
    }

    // วิธี 2 (Legacy): button[id*="trigger-IMAGE"]
    const btn = document.querySelector('button[id*="trigger-IMAGE"]');
    if (btn) {
        clickWithOverlay(btn);
        fl('IMAGE mode selected (trigger-IMAGE)');
        await wait(500);
        return true;
    }

    // วิธี 3 (combobox legacy)
    const modeBtn = await waitFor(() => {
        const cbs = document.querySelectorAll('button[role="combobox"]');
        for (const cb of cbs) {
            const t = cb.textContent.toLowerCase();
            if (t.includes('create image') || t.includes('frames to video') || t.includes('create video')) return cb;
        }
        return null;
    }, 3000);
    if (modeBtn) {
        return await selectCombobox(modeBtn, 'create image');
    }

    flErr('IMAGE tab not found');
    return false;
}

/**
 * เลือก Video/Frames tab
 * UI ใหม่: button[role="tab"] ที่มี text "Frames" หรือ icon "crop_free" / "videocam"
 * Legacy: button[id*="trigger-VIDEO"]
 */
async function selectVideoMode() {
    fl('Selecting VIDEO/Frames mode...');

    // วิธี 1 (UI ใหม่): tab "Frames" หรือ icon crop_free/videocam
    const tabs = document.querySelectorAll('button[role="tab"], button[role="tab"], button[role="radio"]');
    for (const tab of tabs) {
        const text = tab.textContent?.trim().toLowerCase() || '';
        const icon = tab.querySelector('i.google-symbols, i.material-icons');
        if (text.includes('frames') || icon?.textContent?.trim() === 'crop_free' || icon?.textContent?.trim() === 'videocam') {
            const state = tab.getAttribute('data-state');
            if (state === 'active' || state === 'on') {
                fl('Already on Frames/Video tab');
                return true;
            }
            clickWithOverlay(tab);
            fl('VIDEO/Frames tab selected');
            await wait(1000);
            return true;
        }
    }

    // วิธี 2 (Legacy): button[id*="trigger-VIDEO"]
    const btn = document.querySelector('button[id*="trigger-VIDEO"]');
    if (btn) {
        clickWithOverlay(btn);
        fl('VIDEO mode selected (trigger-VIDEO)');
        await wait(500);
        return true;
    }

    // วิธี 3 (combobox legacy)
    const modeBtn = await waitFor(() => {
        const cbs = document.querySelectorAll('button[role="combobox"]');
        for (const cb of cbs) {
            const t = cb.textContent.toLowerCase();
            if (t.includes('frames to video') || t.includes('text to video') || t.includes('create image')) return cb;
        }
        return null;
    }, 3000);
    if (modeBtn) {
        if (modeBtn.textContent.toLowerCase().includes('frames to video')) {
            fl('Already in Frames to Video mode (combobox)');
            return true;
        }
        return await selectCombobox(modeBtn, 'frames to video');
    }

    flErr('VIDEO/Frames tab not found');
    return false;
}

/**
 * เลือก Aspect Ratio
 * UI ใหม่: tab buttons with icon crop_9_16/crop_16_9 or text portrait/landscape
 * Legacy: button[id*="trigger-PORTRAIT"] / button[id*="trigger-LANDSCAPE"]
 */
async function selectAspectRatio(isPortrait = true) {
    const ratioText = isPortrait ? 'portrait' : 'landscape';
    const iconName = isPortrait ? 'crop_9_16' : 'crop_16_9';
    const idKey = isPortrait ? 'PORTRAIT' : 'LANDSCAPE';
    fl(`Selecting ${ratioText}...`);

    // วิธี 1 (UI ใหม่): tab buttons
    const tabs = document.querySelectorAll('button[role="tab"], button[role="tab"], button[role="radio"]');
    for (const tab of tabs) {
        const text = tab.textContent?.trim().toLowerCase() || '';
        const icon = tab.querySelector('i.google-symbols, i.material-icons');
        const tabId = tab.id || '';
        if (text.includes(ratioText) || icon?.textContent?.trim() === iconName || tabId.includes(idKey)) {
            const state = tab.getAttribute('data-state') || '';
            if (state === 'active' || state === 'on' || tab.getAttribute('aria-selected') === 'true') {
                fl(`Already set to ${ratioText} (tab)`);
                return true;
            }
            clickWithOverlay(tab);
            fl(`${ratioText} selected (tab)`);
            await wait(400);
            return true;
        }
    }

    // วิธี 2 (Legacy): button[id*="trigger-"]
    const btn = document.querySelector(`button[id*="trigger-${idKey}"]`);
    if (btn) {
        clickWithOverlay(btn);
        fl(`${ratioText} selected (trigger)`);
        await wait(300);
        return true;
    }

    // วิธี 3 (combobox fallback)
    return await selectCombobox('aspect ratio', ratioText);
}

/**
 * เลือก Model (ใน Settings panel)
 * UI ใหม่: button[aria-haspopup="menu"] ที่มี text "Banana"
 * Legacy: combobox
 */
async function selectModel(modelName = 'Nano Banana Pro') {
    fl('Selecting Model:', modelName);

    // เปิด Settings (icon "tune")
    const tuneBtn = findByIcon('tune');
    if (tuneBtn) {
        const state = tuneBtn.getAttribute('data-state') || tuneBtn.getAttribute('aria-expanded');
        if (state !== 'open' && state !== 'true') {
            clickWithOverlay(tuneBtn);
            await wait(800);
        }
    }

    let result = false;

    // วิธี 1 (UI ใหม่): button[aria-haspopup="menu"] ที่มี text "Banana"
    const menuBtns = document.querySelectorAll('button[aria-haspopup="menu"]');
    for (const btn of menuBtns) {
        if (btn.textContent?.includes('Banana')) {
            if (btn.textContent.toLowerCase().includes(modelName.toLowerCase())) {
                fl('Already selected:', modelName);
                result = true;
                break;
            }
            clickWithOverlay(btn);
            await wait(600);
            const items = document.querySelectorAll('[role="menuitem"], [role="option"]');
            for (const item of items) {
                if (item.textContent?.toLowerCase().includes(modelName.toLowerCase())) {
                    humanClick(item);
                    fl('Selected from menu:', modelName);
                    await wait(500);
                    result = true;
                    break;
                }
            }
            break;
        }
    }

    // วิธี 2 (Legacy combobox)
    if (!result) {
        result = await selectCombobox('model', modelName);
    }

    // ปิด Settings
    if (tuneBtn) {
        const state = tuneBtn.getAttribute('data-state') || tuneBtn.getAttribute('aria-expanded');
        if (state === 'open' || state === 'true') {
            clickWithOverlay(tuneBtn);
            await wait(500);
        }
    }

    return result;
}

/**
 * เลือก Output count (1-4)
 * UI ใหม่: tab buttons "x1"/"x2"/"x3"/"x4"
 * Legacy: button[id*="trigger-N"]
 */
async function selectOutputCount(count = 1) {
    fl('Selecting output count:', count);
    const targetText = `x${count}`;
    const targetId = `trigger-${count}`;

    // วิธี 1 (UI ใหม่): tab "x1"/"x2"/...
    const tabs = document.querySelectorAll('button[role="tab"], button[role="tab"], button[role="radio"]');
    for (const tab of tabs) {
        const text = tab.textContent?.trim() || '';
        const tabId = tab.id || '';
        if (text === targetText || tabId.includes(targetId)) {
            const st = tab.getAttribute('data-state') || '';
            if (st === 'active' || st === 'on' || tab.getAttribute('aria-selected') === 'true') {
                fl(`Already set to ${targetText} (tab)`);
                return true;
            }
            clickWithOverlay(tab);
            fl(`Output count = ${targetText} (tab)`);
            await wait(400);
            return true;
        }
    }

    // วิธี 2 (Legacy): button[id*="trigger-N"]
    const btn = document.querySelector(`button[id*="${targetId}"]`);
    if (btn) {
        clickWithOverlay(btn);
        fl(`Output count = ${count} (trigger)`);
        await wait(300);
        return true;
    }

    // วิธี 3 (combobox fallback)
    return await selectCombobox('output', String(count));
}

// ============================================================
// PROMPT + CREATE
// ============================================================

/**
 * พิมพ์ prompt ลง textbox
 * Element: div[role="textbox"] (contenteditable)
 */
async function enterPrompt(promptText) {
    fl('Entering prompt:', promptText?.substring(0, 80) + '...');

    // วิธี 1: div[role="textbox"] (contenteditable) — Flow ใหม่ใช้ตัวนี้
    const textbox = document.querySelector('div[role="textbox"]');
    if (textbox) {
        textbox.focus();
        // ล้างข้อความเดิม
        textbox.innerHTML = '';
        await wait(100);
        // พิมพ์ข้อความใหม่
        textbox.textContent = promptText;
        textbox.dispatchEvent(new Event('input', { bubbles: true }));
        textbox.dispatchEvent(new Event('change', { bubbles: true }));
        fl('Prompt entered (textbox)');
        await wait(300);
        return true;
    }

    // วิธี 2: textarea
    const textarea = document.querySelector('textarea');
    if (textarea) {
        textarea.focus();
        // React-compatible value setter
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        if (setter) setter.call(textarea, promptText);
        else textarea.value = promptText;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        fl('Prompt entered (textarea)');
        await wait(300);
        return true;
    }

    // วิธี 3: contenteditable
    const editable = document.querySelector('[contenteditable="true"]');
    if (editable) {
        editable.focus();
        editable.textContent = promptText;
        editable.dispatchEvent(new Event('input', { bubbles: true }));
        fl('Prompt entered (contenteditable)');
        await wait(300);
        return true;
    }

    flErr('Prompt input not found');
    return false;
}

/**
 * กดปุ่ม Create (arrow_forward icon)
 */
async function clickCreate() {
    fl('Clicking Create...');
    await wait(300);

    // วิธี 1: icon arrow_forward
    const btn = findByIcon('arrow_forward');
    if (btn) {
        clickWithOverlay(btn);
        fl('Create clicked (arrow_forward)');
        return true;
    }

    // วิธี 2: text "Create"
    const textBtn = findByText('create');
    if (textBtn) {
        clickWithOverlay(textBtn);
        fl('Create clicked (text)');
        return true;
    }

    flErr('Create button not found');
    return false;
}

// ============================================================
// GENERATION MONITORING
// ============================================================

/**
 * รอให้การสร้างเสร็จ (ดูจาก DOM)
 * เมื่อสร้างเสร็จ Flow จะแสดง output ใน gallery area
 * @param {number} timeout — ms สูงสุดที่จะรอ
 * @param {string} mode — 'image' or 'video'
 */
async function waitForGeneration(timeout = 120000, mode = 'image') {
    fl(`Waiting for ${mode} generation (timeout: ${timeout / 1000}s)...`);
    const start = Date.now();
    let lastClipCount = countOutputClips();

    while (Date.now() - start < timeout) {
        await wait(3000);

        // ตรวจสอบ loading state
        const isGenerating = !!document.querySelector('[class*="loading"], [class*="generating"], [class*="spinner"]');
        const currentClipCount = countOutputClips();

        fl(`Generation check: generating=${isGenerating}, clips=${currentClipCount} (was ${lastClipCount})`);

        // ถ้ามี output ใหม่ = เสร็จ
        if (currentClipCount > lastClipCount) {
            fl(`✅ ${mode} generation complete! New clips: ${currentClipCount - lastClipCount}`);
            await wait(2000); // รอ UI อัพเดท
            return { success: true, newClips: currentClipCount - lastClipCount };
        }

        // ตรวจสอบ error
        const errorEl = document.querySelector('[class*="error"], [class*="failed"]');
        if (errorEl && errorEl.offsetHeight > 0) {
            flErr(`${mode} generation failed`);
            return { success: false, error: 'generation_failed' };
        }

        // ตรวจสอบ stop requested
        try {
            const data = await chrome.storage.local.get('autopost_stop_requested');
            if (data.autopost_stop_requested) {
                fl('Stop requested — aborting wait');
                return { success: false, error: 'stopped' };
            }
        } catch (e) { /* ignore */ }
    }

    flErr(`${mode} generation timeout after ${timeout / 1000}s`);
    return { success: false, error: 'timeout' };
}

/**
 * นับจำนวน output clips/images ปัจจุบัน
 */
function countOutputClips() {
    // หา video elements
    const videos = document.querySelectorAll('video');
    // หารูปใน gallery area
    const galleryImages = document.querySelectorAll('[class*="gallery"] img, [class*="output"] img, [class*="result"] img');
    return videos.length + galleryImages.length;
}

// ============================================================
// DOWNLOAD / EXPORT
// ============================================================

/**
 * กดดาวน์โหลด output (ภาพ/วิดีโอ)
 */
async function downloadOutput() {
    fl('Looking for download button...');

    // หาจาก icon
    let dlBtn = findByIcon('download') || findByIcon('file_download') || findByIcon('save');

    // หาจาก text
    if (!dlBtn) {
        dlBtn = findByText('download') || findByText('save');
    }

    // หาจาก "more" menu (three dots)
    if (!dlBtn) {
        const moreBtn = findByIcon('more_vert') || findByIcon('more_horiz');
        if (moreBtn) {
            humanClick(moreBtn);
            await wait(800);
            dlBtn = findByText('download') || findByText('save');
        }
    }

    if (dlBtn) {
        humanClick(dlBtn);
        fl('Download clicked');
        await wait(3000);
        return true;
    }

    flErr('Download button not found');
    return false;
}

/**
 * ดึง URL ของ output (video/image) จาก DOM
 */
function getOutputUrl() {
    // Video
    const video = document.querySelector('video source, video');
    if (video) {
        const src = video.src || video.querySelector('source')?.src;
        if (src) return { type: 'video', url: src };
    }

    // Image — หาจาก gallery
    const galleryImgs = document.querySelectorAll('[class*="gallery"] img, [class*="output"] img, [class*="result"] img');
    if (galleryImgs.length > 0) {
        const lastImg = galleryImgs[galleryImgs.length - 1];
        if (lastImg.src) return { type: 'image', url: lastImg.src };
    }

    return null;
}

// ============================================================
// HIGH-LEVEL AUTOMATION FLOWS
// ============================================================

/**
 * สร้างภาพอัตโนมัติ (full flow)
 * @param {Object} config
 * @param {string} config.prompt — prompt สร้างภาพ
 * @param {string[]} config.images — ภาพ reference (base64 data URLs)
 * @param {string} config.aspectRatio — 'portrait' or 'landscape'
 * @param {string} config.model — ชื่อ model (e.g., 'Nano Banana Pro')
 */
async function createImage(config) {
    const { prompt, images = [], aspectRatio = 'portrait', model = 'Nano Banana Pro' } = config;
    fl('📸 Starting image creation...');
    const startClips = countOutputClips();

    try {
        // 1. เลือก Image mode
        await selectImageMode();
        await wait(500);

        // 1.5. เลือก Model (ถ้าไม่ใช่ default)
        if (model && model !== 'Nano Banana Pro') {
            fl('[NB2] เลือกโมเดล: ' + model);
            await selectModel(model);
            await wait(500);
        }

        // 2. เลือก Aspect Ratio
        await selectAspectRatio(aspectRatio === 'portrait' || aspectRatio === '9:16');
        await wait(300);

        // 3. เลือก Output count = 1
        await selectOutputCount(1);
        await wait(300);

        // 4. Upload reference images
        for (let i = 0; i < images.length; i++) {
            fl(`Uploading reference image ${i + 1}/${images.length}...`);
            const success = await fullUploadImage(images[i], `ref-${i + 1}.png`);
            if (!success) flErr(`Failed to upload image ${i + 1}`);
            await wait(1000);

            // Handle crop dialog
            await handleCropDialog(aspectRatio === 'portrait' || aspectRatio === '9:16');
        }

        // 5. พิมพ์ prompt
        await enterPrompt(prompt);
        await wait(500);

        // 6. กด Create
        const created = await clickCreate();
        if (!created) return { success: false, error: 'create_button_not_found' };

        // 7. รอเสร็จ
        const result = await waitForGeneration(120000, 'image');
        if (result.success) {
            const output = getOutputUrl();
            return { success: true, output };
        }
        return result;

    } catch (err) {
        flErr('Image creation error:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * สร้างวิดีโออัตโนมัติ (full flow)
 * @param {Object} config
 * @param {string} config.prompt — prompt สร้างวิดีโอ
 * @param {string} config.aspectRatio — 'portrait' or 'landscape'
 * @param {string} config.model — ชื่อ model (e.g., 'Veo 3.1 - Fast')
 */
async function createVideo(config) {
    const { prompt, aspectRatio = 'portrait', model = 'Veo 3.1 - Fast' } = config;
    fl('🎬 Starting video creation...');

    try {
        // 1. เลือก Video mode
        await selectVideoMode();
        await wait(500);

        // 2. เลือก Aspect Ratio
        await selectAspectRatio(aspectRatio === 'portrait' || aspectRatio === '9:16');
        await wait(300);

        // 3. พิมพ์ prompt
        await enterPrompt(prompt);
        await wait(500);

        // 4. กด Create
        const created = await clickCreate();
        if (!created) return { success: false, error: 'create_button_not_found' };

        // 5. รอเสร็จ (วิดีโอใช้เวลานานกว่า)
        const result = await waitForGeneration(300000, 'video'); // 5 นาที
        if (result.success) {
            const output = getOutputUrl();
            return { success: true, output };
        }
        return result;

    } catch (err) {
        flErr('Video creation error:', err.message);
        return { success: false, error: err.message };
    }
}

// ============================================================
// CLEAR REFERENCES
// ============================================================

/**
 * ลบ Reference images ทั้งหมด
 */
async function clearReferenceImages() {
    fl('Clearing reference images...');
    // หาปุ่ม X ใกล้ reference images
    const removeButtons = document.querySelectorAll(
        '[class*="reference"] button[class*="remove"], [class*="reference"] button[class*="close"], [class*="ingredient"] button[class*="remove"]'
    );
    for (const btn of removeButtons) {
        humanClick(btn);
        await wait(300);
    }

    // Fallback: หาจาก icon "close" หรือ "delete"
    const closeBtns = document.querySelectorAll('button');
    for (const btn of closeBtns) {
        const icon = btn.querySelector('i.google-symbols, i.material-icons');
        if (icon && (icon.textContent?.trim() === 'close' || icon.textContent?.trim() === 'delete')) {
            // ตรวจสอบว่าเป็นปุ่มลบ reference จริง (ไม่ใช่ปิด dialog)
            const parent = btn.closest('[class*="reference"], [class*="ingredient"], [class*="asset"]');
            if (parent) {
                humanClick(btn);
                await wait(300);
            }
        }
    }

    fl('Reference images cleared');
}

// ============================================================
// MESSAGE HANDLER
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // FLOW_PING — ตรวจสอบว่า script โหลดแล้ว
    if (message.type === 'FLOW_PING') {
        fl('🏓 PING received — script is loaded');
        sendResponse({ loaded: true, url: window.location.href });
        return;
    }

    // FLOW_UPLOAD_IMAGES — อัพโหลดภาพ
    if (message.type === 'FLOW_UPLOAD_IMAGES') {
        fl('📤 Upload images request:', message.images?.length, 'images');
        (async () => {
            try {
                const results = [];
                for (let i = 0; i < (message.images || []).length; i++) {
                    const img = message.images[i];
                    const success = await fullUploadImage(img.data, img.name || `image-${i + 1}.png`);
                    results.push({ index: i, success });

                    // Handle crop
                    if (success && message.isPortrait !== undefined) {
                        await handleCropDialog(message.isPortrait);
                    }
                    await wait(1000);
                }
                sendResponse({ success: true, results });
            } catch (err) {
                flErr('Upload error:', err.message);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true; // async response
    }

    // FLOW_CREATE_IMAGE — สร้างภาพ
    if (message.type === 'FLOW_CREATE_IMAGE') {
        fl('🖼️ Create image request');
        (async () => {
            try {
                /* Check Nano Banana 2 toggle */
                let imageModel = message.model || 'Nano Banana Pro';
                try {
                    const nb2Data = await chrome.storage.local.get('aaa_nano_banana2_mode');
                    if (nb2Data.aaa_nano_banana2_mode) {
                        imageModel = 'Nano Banana 2';
                        fl('[NB2] 🖼️ Nano Banana 2 mode ON — ใช้โมเดลใหม่');
                    }
                } catch (e) { /* ignore */ }
                const result = await createImage({
                    prompt: message.prompt,
                    images: message.images || [],
                    aspectRatio: message.aspectRatio || 'portrait',
                    model: imageModel,
                });
                sendResponse(result);
            } catch (err) {
                flErr('Create image error:', err.message);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true; // async response
    }

    // FLOW_CREATE_VIDEO — สร้างวิดีโอ
    if (message.type === 'FLOW_CREATE_VIDEO') {
        fl('🎬 Create video request');
        (async () => {
            try {
                const result = await createVideo({
                    prompt: message.prompt,
                    aspectRatio: message.aspectRatio || 'portrait',
                    model: message.model || 'Veo 3.1 - Fast',
                });
                sendResponse(result);
            } catch (err) {
                flErr('Create video error:', err.message);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true; // async response
    }

    // FLOW_DOWNLOAD — ดาวน์โหลด
    if (message.type === 'FLOW_DOWNLOAD') {
        fl('💾 Download request');
        (async () => {
            try {
                const output = getOutputUrl();
                const downloaded = await downloadOutput();
                sendResponse({ success: downloaded, output });
            } catch (err) {
                flErr('Download error:', err.message);
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true; // async response
    }

    // FLOW_CLEAR_REFS — ลบ reference images
    if (message.type === 'FLOW_CLEAR_REFS') {
        fl('🗑️ Clear references request');
        (async () => {
            try {
                await clearReferenceImages();
                sendResponse({ success: true });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // FLOW_SELECT_MODE — เลือก mode
    if (message.type === 'FLOW_SELECT_MODE') {
        fl('🔄 Select mode:', message.mode);
        (async () => {
            try {
                let result;
                if (message.mode === 'image') {
                    result = await selectImageMode();
                } else if (message.mode === 'video') {
                    result = await selectVideoMode();
                }
                sendResponse({ success: result });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // FLOW_ENTER_PROMPT — พิมพ์ prompt อย่างเดียว
    if (message.type === 'FLOW_ENTER_PROMPT') {
        fl('✍️ Enter prompt');
        (async () => {
            try {
                const result = await enterPrompt(message.prompt);
                sendResponse({ success: result });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // FLOW_CLICK_CREATE — กด Create อย่างเดียว
    if (message.type === 'FLOW_CLICK_CREATE') {
        fl('▶️ Click Create');
        (async () => {
            try {
                const result = await clickCreate();
                sendResponse({ success: result });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // FLOW_WAIT_GENERATION — รอ generation เสร็จ
    if (message.type === 'FLOW_WAIT_GENERATION') {
        fl('⏳ Wait for generation...');
        (async () => {
            try {
                const result = await waitForGeneration(
                    message.timeout || 120000,
                    message.mode || 'image'
                );
                sendResponse(result);
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // FLOW_GET_OUTPUT — ดึง output URL
    if (message.type === 'FLOW_GET_OUTPUT') {
        const output = getOutputUrl();
        sendResponse({ success: !!output, output });
        return;
    }
});

// ============================================================
// INIT
// ============================================================

fl('✅ Flow Content Script loaded');
fl('📍 URL:', window.location.href);
fl('📋 Ready for messages from background.js');
