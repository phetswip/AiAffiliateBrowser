/**
 * Story Mode - Content Script (Google Flow DOM Automation)
 * Extracted from PD AUTO FLOW v15.1.6
 *
 * รันบน Google Flow (labs.google.com) เพื่อกดปุ่ม/กรอกข้อมูลอัตโนมัติ
 * ต้องลงทะเบียนใน manifest.json เป็น content_script
 */

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

const delay = ms => new Promise(r => setTimeout(r, ms));

function showBotOverlay(title, subtitle) {
  console.log(`[StoryBot] ${title} | ${subtitle}`);
  // สร้าง overlay UI ที่นี่ (optional)
}

function updateBotOverlay(title, subtitle) {
  console.log(`[StoryBot] ${title} | ${subtitle}`);
}

function hideBotOverlay() {
  // ซ่อน overlay
}

function updateStatus(text) {
  console.log(`[StoryStatus] ${text}`);
}

async function isStopRequested() {
  try {
    const data = await chrome.storage.local.get('story_stop_requested');
    return !!data.story_stop_requested;
  } catch(e) { return false; }
}

// ============================================================
// ปิด Changelog Dialog อัตโนมัติ
// ============================================================

function dismissChangelogDialog() {
  const dialog = document.querySelector('div[role="dialog"][data-state="open"]');
  if (!dialog) return;
  const heading = dialog.querySelector('h2');
  if (!heading || !heading.textContent.includes('Latest Flow Update')) return;
  const btn = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent.trim() === 'Get started');
  if (btn) {
    btn.click();
    console.log('[StoryBot] ✅ Auto-dismissed changelog dialog (clicked "Get started")');
  }
}
dismissChangelogDialog();
setTimeout(dismissChangelogDialog, 2000);
setTimeout(dismissChangelogDialog, 5000);

// ============================================================
// STATE
// ============================================================

let clipCountBeforeGenerate = 0;
let failedCountBeforeGenerate = 0;
let currentBatchId = 0;
let retryCount = 0;

// ============================================================
// DOM HELPERS
// ============================================================

/**
 * หาปุ่มจาก text content
 */
function findButtonByText(text, container = document) {
  const buttons = container.querySelectorAll('button');
  for (const btn of buttons) {
    if (btn.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
      return btn;
    }
  }
  return null;
}

/**
 * หาปุ่มจาก material icon หรือ google-symbols icon
 */
function findButtonByIcon(iconName) {
  const icons = document.querySelectorAll('i.material-icons, i.material-icons-outlined, i.google-symbols');
  for (const icon of icons) {
    if (icon.textContent.trim() === iconName) {
      return icon.closest('button');
    }
  }
  return null;
}

/**
 * หา combobox (button[role="combobox"]) จาก text ที่แสดง
 */
function findComboboxByLabel(labelText) {
  const comboboxes = document.querySelectorAll('button[role="combobox"]');
  for (const cb of comboboxes) {
    if (cb.textContent.toLowerCase().includes(labelText.toLowerCase())) {
      return cb;
    }
  }
  return null;
}

/**
 * คลิก combobox เพื่อเปิด dropdown แล้วเลือก option
 */
async function selectFromCombobox(comboboxBtn, optionText) {
  clickWithOverlay(comboboxBtn);
  await delay(600);

  const options = document.querySelectorAll('[role="option"]');
  for (const opt of options) {
    if (opt.textContent.trim().toLowerCase().includes(optionText.toLowerCase())) {
      simulateClick(opt);
      await delay(400);
      console.log('[Combobox] Selected:', opt.textContent.trim());
      return true;
    }
  }
  console.log('[Combobox] Option not found:', optionText);
  return false;
}

/**
 * หา element จาก selector แบบ retry
 */
async function waitForElement(selectorOrFinder, timeout = 10000, interval = 500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = typeof selectorOrFinder === 'function' ? selectorOrFinder() : document.querySelector(selectorOrFinder);
    if (el) return el;
    await delay(interval);
  }
  return null;
}

/**
 * Click element ด้วย mouse event simulation
 */
function simulateClick(element) {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  ['mousedown', 'mouseup', 'click'].forEach(type => {
    element.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y
    }));
  });
}

/**
 * Human-like click — เหมือน Sora mode (aistudio-content-script.js)
 * ส่งครบ: mouseenter → mouseover → mousemove → mousedown → mouseup → click
 */
function humanClick(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const mouseEvents = ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'];
  mouseEvents.forEach(eventType => {
    element.dispatchEvent(new MouseEvent(eventType, {
      view: window, bubbles: true, cancelable: true, clientX: x, clientY: y
    }));
  });
  return true;
}

/**
 * กดปุ่ม Videos tab — ส่งไป background script ให้ inject เข้า MAIN world
 * (MAIN world = context เดียวกับ React → event ถูก handle แน่นอน)
 */
async function clickVideosTabDirectly() {
  console.log('[Story v16] clickVideosTabDirectly: Sending to background for MAIN world execution...');

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CLICK_VIDEOS_TAB' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Story v16] clickVideosTabDirectly error:', chrome.runtime.lastError.message);
        resolve(false);
        return;
      }
      const success = response && response.success;
      console.log(`[Story v16] clickVideosTabDirectly result: ${success}`);
      resolve(success);
    });
  });
}

/**
 * Click button ที่มี data-type="button-overlay" บัง
 * ใช้ event sequence เดียวกับ humanClick ของ Mode 16s ที่ทำงานได้จริง:
 * mouseenter → mouseover → mousemove → mousedown → mouseup → click
 * ส่งไปที่ overlay ก่อน (เหมือน user click จริง) แล้ว button ด้วย
 */
function clickWithOverlay(btn) {
  const overlay = btn.querySelector('[data-type="button-overlay"]');

  const rect = btn.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const evtOpts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };

  // Human-like event sequence (เหมือน humanClick ใน aistudio-content-script.js)
  const eventTypes = ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'];

  // 1. ส่ง event ไปที่ overlay ก่อน (real user click โดน overlay ก่อน → bubble ขึ้น button)
  if (overlay) {
    eventTypes.forEach(type => {
      overlay.dispatchEvent(new MouseEvent(type, evtOpts));
    });
  }

  // 2. ส่ง event ที่ button ด้วย
  eventTypes.forEach(type => {
    btn.dispatchEvent(new MouseEvent(type, evtOpts));
  });
  btn.click();
}

/**
 * กรอกข้อความใน input/textarea
 */
function fillInput(element, text) {
  element.focus();
  element.value = text;

  // React-compatible value setting
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement?.prototype || window.HTMLInputElement.prototype, 'value'
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(element, text);
  }

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * ตรวจสอบว่าอยู่ใน Scene Builder หรือไม่
 */
function isInScenebuilderPage() {
  // Scene Builder มีลักษณะเฉพาะของ timeline UI
  const timeline = document.querySelector('[class*="timeline"], [class*="scene-builder"]');
  return !!timeline;
}

// ============================================================
// STEP FUNCTIONS (Google Flow UI Automation)
// ============================================================

/**
 * Step 0.5: กดปุ่ม Images tab (radio button)
 * UI: button[role="tab"] หรือ button[role="radio"] ที่มี icon "image" + text "Images"
 */
async function step0_ClickImagesTab() {
  console.log('[Step0.5] Clicking Images tab...');
  await delay(500);

  // หา tab/radio button ที่มี icon "image"
  const allRadios = document.querySelectorAll('button[role="tab"], button[role="radio"]');
  for (const btn of allRadios) {
    const icon = btn.querySelector('i.google-symbols');
    if (icon && icon.textContent?.trim() === 'image') {
      // กดทุกครั้ง (ไม่ skip แม้ active อยู่แล้ว)
      clickWithOverlay(btn);
      console.log('[Step0.5] Clicked Images tab');
      await delay(1000);
      return;
    }
  }

  // Fallback: หาจาก text "Images"
  for (const btn of allRadios) {
    if (btn.textContent?.trim().toLowerCase().includes('images')) {
      // กดทุกครั้ง (ไม่ skip)
      clickWithOverlay(btn);
      console.log('[Step0.5] Clicked Images tab (text match)');
      await delay(1000);
      return;
    }
  }

  console.log('[Step0.5] Images tab not found — skipping');
}

/**
 * Step 1: เลือกแท็บ Frames — สำหรับ video mode
 * UI ใหม่: button[role="tab"] ที่มี text "Frames" หรือ icon "crop_free"
 */
async function step1_SelectMode() {
  console.log('[Step1] Selecting Frames tab...');
  await delay(500);

  // วิธี 1: หาจาก button[role="tab"] ที่มี text "Frames" หรือ icon "crop_free"
  const tabs = document.querySelectorAll('button[role="tab"], button[role="radio"]');
  for (const tab of tabs) {
    const text = tab.textContent?.trim().toLowerCase() || '';
    const icon = tab.querySelector('i.google-symbols, i.material-icons');
    if (text.includes('frames') || icon?.textContent?.trim() === 'crop_free') {
      const state = tab.getAttribute('data-state');
      if (state === 'active' || state === 'on') {
        console.log('[Step1] Already on Frames tab');
        return;
      }
      clickWithOverlay(tab);
      console.log('[Step1] Clicked Frames tab');
      await delay(1000);
      return;
    }
  }

  // วิธี 2 (legacy): combobox dropdown
  const modeBtn = findComboboxByLabel('frames to video') || findComboboxByLabel('text to video') || findComboboxByLabel('create image');
  if (modeBtn) {
    if (modeBtn.textContent.toLowerCase().includes('frames to video')) {
      console.log('[Step1] Already in Frames to Video mode (legacy)');
      return;
    }
    await selectFromCombobox(modeBtn, 'frames to video');
    console.log('[Step1] Selected Frames to Video (legacy)');
    return;
  }

  console.log('[Step1] Frames tab not found');
  await delay(1000);
}

/**
 * Step 1: เลือกโหมด Create Image
 * UI: button[role="combobox"] ที่แสดง "Create Image"
 */
async function step1_SelectImageMode() {
  console.log('[Step1] Selecting Create Image mode...');
  await delay(500);

  // หา combobox โหมดปัจจุบัน — บังคับกดทุกครั้ง (ไม่ skip)
  const modeBtn = findComboboxByLabel('create image') || findComboboxByLabel('frames to video') || findComboboxByLabel('create video');
  if (modeBtn) {
    await selectFromCombobox(modeBtn, 'create image');
    console.log('[Step1] Selected Create Image');
    return;
  }

  console.log('[Step1] Mode combobox not found');
  await delay(1000);
}

/**
 * Step 2: เปิด Settings panel
 * UI: button ที่มี icon "tune" (material-icons)
 */
async function step2_OpenSettings() {
  console.log('[Step2] Opening Config Dropdown...');

  // ใช้ waitForElement รอ page render (fresh tab อาจยัง render ไม่เสร็จ)
  const configBtn = await waitForElement(() => {
    const menuBtns = document.querySelectorAll('button[aria-haspopup="menu"]');
    // วิธี 1: หา button ที่มี aspect ratio icon (crop_9_16 / crop_16_9)
    for (const btn of menuBtns) {
      const icon = btn.querySelector('i.google-symbols, i.material-icons');
      const iconText = icon?.textContent?.trim() || '';
      if (iconText === 'crop_9_16' || iconText === 'crop_16_9') return btn;
    }
    // วิธี 2: หา button ที่มี xN text
    for (const btn of menuBtns) {
      if (/x[1-4]/.test(btn.textContent || '')) return btn;
    }
    // วิธี 3: หา sibling ของ Create button (arrow_forward)
    const createBtn = findButtonByIcon('arrow_forward');
    if (createBtn) {
      const sibling = createBtn.previousElementSibling;
      if (sibling?.tagName === 'BUTTON' && sibling.getAttribute('aria-haspopup') === 'menu') return sibling;
    }
    return null;
  }, 15000);

  if (!configBtn) { console.log('[Step2] Config dropdown not found'); return false; }

  const state = configBtn.getAttribute('data-state') || '';
  const expanded = configBtn.getAttribute('aria-expanded');
  if (state === 'open' || expanded === 'true') {
    console.log('[Step2] Config dropdown already open');
    return true;
  }

  // MAIN world click (bypass CSP/React isolation)
  try {
    const result = await Promise.race([
      new Promise(resolve => chrome.runtime.sendMessage({ type: 'CLICK_CONFIG_DROPDOWN' }, resolve)),
      new Promise(r => setTimeout(() => r({ success: false, timeout: true }), 5000))
    ]);
    if (!result?.success) humanClick(configBtn);
  } catch (e) { humanClick(configBtn); }

  await delay(800);
  console.log('[Step2] Config dropdown opened');
  return true;
}

/**
 * Step 2.1: เลือก Model
 * UI ใหม่: button[aria-haspopup="menu"] ที่มี text "Banana"
 * Legacy: combobox ที่มี label "Model"
 */
async function step2_SelectModel(modelName) {
  console.log('[Step2.1] Selecting Model:', modelName);

  // หา dropdown Model (3 วิธีเหมือน aistudio)
  let modelDropdown = null;
  const menuBtns = document.querySelectorAll('button[aria-haspopup="menu"]');

  // วิธี 1: icon arrow_drop_down
  for (const btn of menuBtns) {
    const icon = btn.querySelector('i.google-symbols, i.material-icons');
    if (icon?.textContent?.trim() === 'arrow_drop_down') { modelDropdown = btn; break; }
  }
  // วิธี 2: text มี model name
  if (!modelDropdown) {
    for (const btn of menuBtns) {
      const text = btn.textContent || '';
      if (text.includes('Banana') || text.includes('Imagen') || text.includes('Veo')) { modelDropdown = btn; break; }
    }
  }
  // วิธี 3: legacy combobox
  if (!modelDropdown) {
    modelDropdown = findComboboxByLabel('model');
  }

  if (!modelDropdown) { console.log('[Step2.1] Model selector not found'); return false; }

  // เช็คว่าเลือกอยู่แล้ว
  if (modelDropdown.textContent?.toLowerCase().includes(modelName.toLowerCase())) {
    console.log('[Step2.1] Already selected:', modelName);
    return true;
  }

  // MAIN world click เปิด dropdown
  try {
    const result = await Promise.race([
      new Promise(resolve => chrome.runtime.sendMessage({ type: 'CLICK_MODEL_DROPDOWN' }, resolve)),
      new Promise(r => setTimeout(() => r({ success: false, timeout: true }), 5000))
    ]);
    if (!result?.success) humanClick(modelDropdown);
  } catch (e) { humanClick(modelDropdown); }
  await delay(1000);

  // หา option (เพิ่ม data-radix-collection-item)
  const options = document.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-collection-item]');
  for (const item of options) {
    if (item.textContent?.toLowerCase().includes(modelName.toLowerCase())) {
      humanClick(item);
      console.log('[Step2.1] Selected:', modelName);
      await delay(500);
      return true;
    }
  }
  console.log('[Step2.1] Model option not found');
  return false;
}

/**
 * Step 2.2: เลือก Aspect Ratio
 * UI: combobox ที่มี label "Aspect Ratio"
 */
async function step2_SelectAspectRatio(isPortrait) {
  const ratioText = isPortrait ? 'portrait' : 'landscape';
  const iconName = isPortrait ? 'crop_9_16' : 'crop_16_9';
  const idKey = isPortrait ? 'PORTRAIT' : 'LANDSCAPE';
  console.log('[Step2.2] Selecting Aspect Ratio:', ratioText);

  // === วิธีใหม่: หา tab (button[role="tab"]) ===
  const tabs = document.querySelectorAll('button[role="tab"], button[role="radio"]');
  for (const tab of tabs) {
    const text = tab.textContent?.trim().toLowerCase() || '';
    const icon = tab.querySelector('i.google-symbols, i.material-icons');
    const tabId = tab.id || '';
    if (text.includes(ratioText) || icon?.textContent?.trim() === iconName || tabId.includes(idKey)) {
      const state = tab.getAttribute('data-state') || '';
      if (state === 'active' || state === 'on' || tab.getAttribute('aria-selected') === 'true') {
        console.log('[Step2.2] Already set to', ratioText, '(tab)');
        return true;
      }
      humanClick(tab);
      await delay(400);
      console.log('[Step2.2] Selected', ratioText, 'tab');
      return true;
    }
  }

  // === Fallback: combobox dropdown ===
  const ratioBtn = findComboboxByLabel('aspect ratio');
  if (ratioBtn) {
    if (ratioBtn.textContent.toLowerCase().includes(ratioText)) {
      console.log('[Step2.2] Already set to', ratioText);
      return true;
    }
    return await selectFromCombobox(ratioBtn, ratioText);
  }
  console.log('[Step2.2] Aspect Ratio tab/combobox not found');
  return false;
}

// Legacy wrapper
async function setAspectRatioForImageMode(isPortrait) {
  return step2_SelectAspectRatio(isPortrait);
}
async function setAspectRatio(ratio) {
  return step2_SelectAspectRatio(ratio === '9:16');
}

/**
 * Step 2.3: เลือก Outputs per Prompt
 * UI: combobox ที่มี label "Outputs per prompt"
 */
async function step2_SelectOutputCount(count) {
  console.log('[Step2.3] Selecting Outputs per Prompt:', count);
  const targetText = `x${count}`;
  const targetId = `trigger-${count}`;

  // === วิธีใหม่: หา tab "x1"/"x2"/... ===
  const tabs = document.querySelectorAll('button[role="tab"], button[role="radio"]');
  for (const tab of tabs) {
    const text = tab.textContent?.trim() || '';
    const tabId = tab.id || '';
    if (text === targetText || tabId.includes(targetId)) {
      const st = tab.getAttribute('data-state') || '';
      if (st === 'active' || st === 'on' || tab.getAttribute('aria-selected') === 'true') {
        console.log('[Step2.3] Already set to', targetText, '(tab)');
        return true;
      }
      humanClick(tab);
      await delay(400);
      console.log('[Step2.3] Selected', targetText, 'tab');
      return true;
    }
  }

  // === Fallback: combobox dropdown ===
  console.log('[Step2.3] Tab not found, trying combobox fallback');
  let outputsBtn = null;
  const comboboxes = document.querySelectorAll('button[role="combobox"]');
  for (const btn of comboboxes) {
    const text = (btn.textContent || '').toLowerCase();
    if (text.includes('outputs per prompt') || text.includes('output')) {
      outputsBtn = btn;
      break;
    }
  }
  if (!outputsBtn) {
    for (const btn of comboboxes) {
      if (/^[1-4]$/.test(btn.textContent.trim())) {
        outputsBtn = btn;
        break;
      }
    }
  }
  if (!outputsBtn) {
    console.log('[Step2.3] Outputs combobox not found');
    return false;
  }

  const currentNum = parseInt(outputsBtn.textContent.trim().replace(/\D/g, ''));
  if (currentNum === count) {
    console.log('[Step2.3] Already set to', count);
    return true;
  }

  humanClick(outputsBtn);
  await delay(800);

  let clicked = false;
  const options = document.querySelectorAll('[role="option"]');
  for (const opt of options) {
    if (opt.textContent.trim() === String(count)) {
      humanClick(opt);
      clicked = true;
      console.log('[Step2.3] Clicked role=option:', count);
      break;
    }
  }

  await delay(500);
  console.log('[Step2.3] Output count selection done');
  return clicked;
}

/**
 * Step 2.4: ปิด Settings panel
 * UI: button ที่มี icon "tune" + data-state="open"
 */
async function step2_CloseSettings() {
  console.log('[Step2.4] Closing Config Dropdown...');
  const menuBtns = document.querySelectorAll('button[aria-haspopup="menu"]');
  let configBtn = null;
  for (const btn of menuBtns) {
    const icon = btn.querySelector('i.google-symbols, i.material-icons');
    const iconText = icon?.textContent?.trim() || '';
    if (iconText === 'crop_9_16' || iconText === 'crop_16_9') { configBtn = btn; break; }
  }
  if (!configBtn) { console.log('[Step2.4] Config dropdown not found'); return false; }

  const state = configBtn.getAttribute('data-state') || '';
  const expanded = configBtn.getAttribute('aria-expanded');
  if (state === 'closed' || expanded === 'false' || (!state && !expanded)) {
    console.log('[Step2.4] Config already closed');
    return true;
  }

  // MAIN world click (bypass CSP/React isolation)
  try {
    const result = await Promise.race([
      new Promise(resolve => chrome.runtime.sendMessage({ type: 'CLICK_CONFIG_DROPDOWN' }, resolve)),
      new Promise(r => setTimeout(() => r({ success: false, timeout: true }), 5000))
    ]);
    if (!result?.success) humanClick(configBtn);
  } catch (e) { humanClick(configBtn); }

  await delay(500);
  console.log('[Step2.4] Config dropdown closed');
  return true;
}

// Legacy wrapper
async function step2_ConfigureSettings(config = {}) {
  const { clipCount = 1, aspectRatio, modelName = 'Nano Banana Pro' } = config;
  await step2_OpenSettings();
  await step2_SelectModel(modelName);
  if (aspectRatio) await step2_SelectAspectRatio(aspectRatio === '9:16');
  await step2_SelectOutputCount(clipCount);
  await step2_CloseSettings();
}

/**
 * Step 3: Upload รูปภาพ (Reference image)
 */
async function step3_UploadImage(base64DataUrl) {
  console.log('[Step3] Uploading image via Assets Panel...');
  await delay(500);

  // 1. หาปุ่ม Add (icon add_2) → เปิด Assets Panel
  let addBtn = null;
  const dialogBtns = document.querySelectorAll('button[aria-haspopup="dialog"]');
  for (const btn of dialogBtns) {
    const icon = btn.querySelector('i.google-symbols');
    if (icon && icon.textContent.trim() === 'add_2') { addBtn = btn; break; }
  }
  if (!addBtn) {
    // fallback: icon add_2 ใน button ใดๆ
    const allIcons = document.querySelectorAll('i.google-symbols');
    for (const icon of allIcons) {
      if (icon.textContent.trim() === 'add_2') { addBtn = icon.closest('button'); break; }
    }
  }

  if (addBtn) {
    humanClick(addBtn);
    console.log('[Step3] Clicked Add button');

    // รอ Assets Panel เปิด
    const panelOpened = await waitForElement(() => {
      const searchInput = document.querySelector('input[placeholder*="Search for Assets"]');
      if (searchInput) return searchInput;
      const spans = document.querySelectorAll('span');
      for (const span of spans) {
        if (span.textContent?.includes('Recently Used')) return span;
      }
      return null;
    }, 5000);

    if (panelOpened) {
      console.log('[Step3] Assets Panel opened');
      await delay(500);

      // หาปุ่ม Upload ใน Assets Panel
      const uploadBtn = await waitForElement(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          const span = btn.querySelector('span');
          if (span && span.textContent.trim() === 'Upload image') return btn;
        }
        for (const btn of btns) {
          const icon = btn.querySelector('i.google-symbols');
          if (icon && (icon.textContent.trim() === 'upload' || icon.textContent.trim() === 'file_upload')) return btn;
        }
        return null;
      }, 3000);

      if (uploadBtn) {
        humanClick(uploadBtn);
        console.log('[Step3] Clicked Upload button in Assets Panel');
        await delay(1000);
      }
    }
  } else {
    // Legacy fallback: หาปุ่ม upload ตรงๆ (เหมือนโค้ดเดิม)
    console.log('[Step3] No Add button found, trying legacy upload...');
    let uploadBtn = null;
    for (let i = 0; i < 15; i++) {
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const icon = btn.querySelector('i.google-symbols, i.material-icons, i.material-icons-outlined');
        if (icon && (icon.textContent?.trim() === 'upload' || icon.textContent?.trim() === 'file_upload')) {
          uploadBtn = btn;
          break;
        }
      }
      if (!uploadBtn) {
        for (const btn of allBtns) {
          const text = btn.textContent?.trim().toLowerCase() || '';
          if (text === 'upload' || text.includes('upload')) { uploadBtn = btn; break; }
        }
      }
      if (uploadBtn) break;
      console.log(`[Step3] Upload button not found, waiting... (${i + 1}/15)`);
      await delay(2000);
    }
    if (uploadBtn) {
      humanClick(uploadBtn);
      console.log('[Step3] Clicked Upload button (legacy)');
      await delay(2000);
    }
  }

  // 2. หา file input — retry 10 ครั้ง (เอาอันสุดท้าย)
  let fileInput = null;
  for (let i = 0; i < 10; i++) {
    const inputs = document.querySelectorAll('input[type="file"]');
    if (inputs.length > 0) {
      fileInput = inputs[inputs.length - 1];
      break;
    }
    console.log(`[Step3] File input not found, waiting... (${i + 1}/10)`);
    await delay(1000);
  }

  if (fileInput) {
    let file;
    try {
      if (base64DataUrl.startsWith('data:')) {
        file = base64ToFile(base64DataUrl, 'image.png');
      } else {
        console.log('[Step3] Image is URL, fetching...', base64DataUrl.substring(0, 60));
        const resp = await fetch(base64DataUrl);
        const blob = await resp.blob();
        file = new File([blob], 'image.png', { type: blob.type || 'image/png' });
      }
    } catch (convErr) {
      console.error('[Step3] Failed to convert image to file:', convErr);
      await pasteImageFromBase64(base64DataUrl);
      await delay(1500);
      return;
    }
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    console.log('[Step3] Uploaded via file input');
  } else {
    console.log('[Step3] No file input found, trying paste...');
    await pasteImageFromBase64(base64DataUrl);
  }

  await delay(1500);
}

/**
 * อัพโหลดรูปจาก File object ตรงๆ (เหมือน 16s: handleExtendUploadImage)
 * ไม่ต้องแปลง base64 — ใช้ File ที่ดาวน์โหลดมาจาก URL เลย
 */
async function step3_UploadImageFile(imageFile) {
  console.log(`[Step3] Uploading image file: ${imageFile.name} (${(imageFile.size / 1024).toFixed(1)} KB)`);
  await delay(500);

  // 1. หาปุ่ม Add (icon add_2) → เปิด Assets Panel
  let addBtn = null;
  const dialogBtns = document.querySelectorAll('button[aria-haspopup="dialog"]');
  for (const btn of dialogBtns) {
    const icon = btn.querySelector('i.google-symbols');
    if (icon && icon.textContent.trim() === 'add_2') { addBtn = btn; break; }
  }
  if (!addBtn) {
    const allIcons = document.querySelectorAll('i.google-symbols');
    for (const icon of allIcons) {
      if (icon.textContent.trim() === 'add_2') { addBtn = icon.closest('button'); break; }
    }
  }

  if (addBtn) {
    humanClick(addBtn);
    console.log('[Step3] Clicked Add button');

    const panelOpened = await waitForElement(() => {
      const searchInput = document.querySelector('input[placeholder*="Search for Assets"]');
      if (searchInput) return searchInput;
      const spans = document.querySelectorAll('span');
      for (const span of spans) {
        if (span.textContent?.includes('Recently Used')) return span;
      }
      return null;
    }, 5000);

    if (panelOpened) {
      console.log('[Step3] Assets Panel opened');
      await delay(500);

      const uploadBtn = await waitForElement(() => {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          const span = btn.querySelector('span');
          if (span && span.textContent.trim() === 'Upload image') return btn;
        }
        for (const btn of btns) {
          const icon = btn.querySelector('i.google-symbols');
          if (icon && (icon.textContent.trim() === 'upload' || icon.textContent.trim() === 'file_upload')) return btn;
        }
        return null;
      }, 3000);

      if (uploadBtn) {
        humanClick(uploadBtn);
        console.log('[Step3] Clicked Upload button in Assets Panel');
        await delay(1000);
      }
    }
  } else {
    // Legacy fallback
    console.log('[Step3] No Add button found, trying legacy upload...');
    let uploadBtn = null;
    for (let i = 0; i < 10; i++) {
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const icon = btn.querySelector('i.google-symbols, i.material-icons, i.material-icons-outlined');
        if (icon && (icon.textContent?.trim() === 'upload' || icon.textContent?.trim() === 'file_upload')) {
          uploadBtn = btn; break;
        }
        if (btn.textContent?.trim().toLowerCase() === 'upload' || btn.textContent?.includes('Upload')) {
          uploadBtn = btn; break;
        }
      }
      if (uploadBtn) break;
      console.log(`[Step3] Upload button not found (${i + 1}/10)`);
      await delay(1000);
    }
    if (uploadBtn) {
      humanClick(uploadBtn);
      console.log('[Step3] Clicked Upload button (legacy)');
      await delay(5000);
    }
  }

  // 2. หา file input (เอาอันสุดท้าย)
  let fileInput = null;
  for (let i = 0; i < 10; i++) {
    const inputs = document.querySelectorAll('input[type="file"]');
    if (inputs.length > 0) {
      fileInput = inputs[inputs.length - 1];
      break;
    }
    console.log(`[Step3] File input not found (${i + 1}/10)`);
    await delay(1000);
  }

  if (!fileInput) {
    throw new Error('หา file input ไม่เจอ');
  }

  // 3. Set file ลง input
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(imageFile);
  fileInput.files = dataTransfer.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  fileInput.dispatchEvent(new Event('input', { bubbles: true }));
  console.log('[Step3] File set on input — done');

  await delay(1500);
}

/**
 * Step 3 (Crop): จัดการ "Crop your ingredient" dialog
 * @param {boolean} isPortrait - true = เลือก Portrait, false = เลือก Landscape
 */
async function step3_HandleCropDialog(isPortrait) {
  console.log('[Step3 Crop] Waiting for Crop dialog...');

  // 1. รอ Crop dialog ปรากฏ (หาปุ่ม "Crop and Save")
  let cropDialogFound = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const cropSaveBtn = Array.from(document.querySelectorAll('button')).find(
      btn => btn.textContent?.includes('Crop and Save') || btn.textContent?.includes('Crop')
    );
    if (cropSaveBtn) {
      cropDialogFound = true;
      console.log('[Step3 Crop] Found Crop dialog');
      break;
    }
    console.log(`[Step3 Crop] Waiting for Crop dialog... (${attempt + 1}/10)`);
    await delay(1500);
  }

  if (!cropDialogFound) {
    console.log('[Step3 Crop] No Crop dialog found — skipping');
    return;
  }

  // 2. หา combobox ใน dialog (ปุ่ม Portrait/Landscape)
  const targetMode = isPortrait ? 'portrait' : 'landscape';
  console.log(`[Step3 Crop] Selecting ${targetMode}...`);

  let cropCombobox = null;
  const cropSaveBtnForScope = Array.from(document.querySelectorAll('button')).find(
    btn => btn.textContent?.includes('Crop and Save')
  );
  if (cropSaveBtnForScope) {
    const dialogContainer = cropSaveBtnForScope.closest('[role="dialog"]')
      || cropSaveBtnForScope.closest('mat-dialog-container')
      || cropSaveBtnForScope.closest('.cdk-overlay-pane')
      || cropSaveBtnForScope.parentElement?.parentElement?.parentElement?.parentElement;
    if (dialogContainer) {
      cropCombobox = dialogContainer.querySelector('button[role="combobox"]');
    }
  }
  if (!cropCombobox) {
    cropCombobox = document.querySelector('button[role="combobox"]');
  }

  if (cropCombobox) {
    const currentMode = cropCombobox.textContent?.trim().toLowerCase() || '';
    if (!currentMode.includes(targetMode)) {
      // กด combobox เปิด dropdown
      const rect = cropCombobox.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const evtOpts = { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y };
      ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'].forEach(type => {
        cropCombobox.dispatchEvent(new MouseEvent(type, evtOpts));
      });
      await delay(1000);

      // หา option ที่ตรงกับ targetMode
      const options = document.querySelectorAll('[role="option"], [role="menuitem"], [role="listbox"] [role="option"]');
      let targetOption = null;
      for (const opt of options) {
        if (opt.textContent?.trim().toLowerCase().includes(targetMode)) {
          targetOption = opt;
          break;
        }
      }
      if (targetOption) {
        const optRect = targetOption.getBoundingClientRect();
        const optX = optRect.left + optRect.width / 2;
        const optY = optRect.top + optRect.height / 2;
        const optEvt = { view: window, bubbles: true, cancelable: true, clientX: optX, clientY: optY };
        ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'].forEach(type => {
          targetOption.dispatchEvent(new MouseEvent(type, optEvt));
        });
        console.log(`[Step3 Crop] Selected "${targetMode}"`);
        await delay(2000);
      } else {
        console.log(`[Step3 Crop] "${targetMode}" option not found — using current`);
      }
    } else {
      console.log(`[Step3 Crop] Already in ${targetMode} mode`);
    }
  } else {
    console.log('[Step3 Crop] Combobox not found — skipping aspect ratio selection');
  }

  // 3. กด "Crop and Save"
  await delay(500);
  let cropSaveBtn = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      if (btn.textContent?.includes('Crop and Save')) {
        cropSaveBtn = btn;
        break;
      }
    }
    if (cropSaveBtn) break;
    await delay(1000);
  }

  if (cropSaveBtn) {
    const rect = cropSaveBtn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const evtOpts = { view: window, bubbles: true, cancelable: true, clientX: x, clientY: y };
    ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'].forEach(type => {
      cropSaveBtn.dispatchEvent(new MouseEvent(type, evtOpts));
    });
    console.log('[Step3 Crop] Clicked "Crop and Save"');
    await delay(3000);
  } else {
    console.log('[Step3 Crop] "Crop and Save" button not found');
  }
}

/**
 * Step 3: เพิ่มรูปเพิ่มเติม (Reference images)
 */
async function step3_AddAdditionalImage(base64DataUrl, index) {
  console.log('[Step3] Adding additional image', index);

  const addBtn = findButtonByText('+') || findButtonByIcon('add') || document.querySelector('[class*="add-image"]');
  if (addBtn) {
    simulateClick(addBtn);
    await delay(500);
  }

  await step3_UploadImage(base64DataUrl);
}

/**
 * Step 4: จัดการ Crop
 */
async function step4_HandleCrop(config = {}) {
  console.log('[Step4] Handling crop...');
  await delay(500);

  const doneBtn = findButtonByText('done') || findButtonByText('apply') || findButtonByText('confirm');
  if (doneBtn) {
    simulateClick(doneBtn);
    console.log('[Step4] Clicked done/apply');
    await delay(500);
  }

  if (config.aspectRatio) {
    const isPortrait = config.aspectRatio === '9:16';
    const ratioBtn = findButtonByText(isPortrait ? 'portrait' : 'landscape')
      || findButtonByText(isPortrait ? '9:16' : '16:9');
    if (ratioBtn) {
      simulateClick(ratioBtn);
      await delay(300);
    }
  }

  await delay(300);
}

/**
 * Step 5: กรอก Prompt
 */
async function step5_EnterPrompt(promptText) {
  console.log('[Step5] Entering prompt:', promptText?.substring(0, 50) + '...');
  await delay(300);

  // วิธี 1 (UI ใหม่): Slate editor
  const slateEditor = document.querySelector('div[role="textbox"][data-slate-editor="true"]');
  if (slateEditor) {
    // คลิก editor ให้ active
    humanClick(slateEditor);
    await delay(500);
    slateEditor.focus();
    await delay(300);

    // ใส่ prompt ผ่าน MAIN world (เหมือน aistudio)
    const promptHolder = document.createElement('div');
    promptHolder.id = '__fill_prompt_data';
    promptHolder.setAttribute('data-prompt', promptText);
    promptHolder.style.display = 'none';
    document.body.appendChild(promptHolder);

    try {
      const fillResult = await Promise.race([
        new Promise(resolve => chrome.runtime.sendMessage({ type: 'FILL_PROMPT_MAIN' }, resolve)),
        new Promise(r => setTimeout(() => r({ success: false, timeout: true }), 5000))
      ]);
      const leftover = document.getElementById('__fill_prompt_data');
      if (leftover) leftover.remove();

      if (fillResult?.success) {
        console.log('[Step5] Filled prompt via MAIN world');
        await delay(500);
        return;
      }
    } catch (e) {
      const leftover = document.getElementById('__fill_prompt_data');
      if (leftover) leftover.remove();
    }

    // Fallback: execCommand (isolated world)
    slateEditor.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, promptText);
    console.log('[Step5] Filled prompt via execCommand fallback');
    await delay(500);
    return;
  }

  // วิธี 2 (legacy): textarea
  const textarea = document.querySelector(
    'textarea[placeholder*="prompt"], textarea[placeholder*="describe"], textarea'
  );
  if (textarea) {
    fillInput(textarea, promptText);
    console.log('[Step5] Filled prompt in textarea');
    await delay(500);
    return;
  }

  // วิธี 3 (legacy): contenteditable
  const editable = document.querySelector('[contenteditable="true"]');
  if (editable) {
    editable.focus();
    editable.textContent = promptText;
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    console.log('[Step5] Filled prompt in contenteditable');
    await delay(500);
  }
}

/**
 * Step 6: กด Generate
 * UI: button ที่มี icon "arrow_forward" (google-symbols) + text "Create"
 */
async function step6_Generate() {
  console.log('[Step6] Clicking Generate...');
  await delay(300);

  // วิธี 1: หาจาก icon arrow_forward
  const btnByIcon = findButtonByIcon('arrow_forward');
  if (btnByIcon) {
    humanClick(btnByIcon);
    console.log('[Step6] Generate clicked (arrow_forward icon)');
    return true;
  }

  // วิธี 2: หาจาก text
  const btnByText = findButtonByText('create') || findButtonByText('generate') || findButtonByText('สร้าง');
  if (btnByText) {
    humanClick(btnByText);
    console.log('[Step6] Generate clicked (text)');
    return true;
  }

  console.log('[Step6] Generate button not found');
  return false;
}

// ============================================================
// STORY-SPECIFIC FUNCTIONS
// ============================================================

/**
 * สร้างรูปสำหรับ 1 ฉาก
 */
async function createStorySceneImage(imagePrompt, aspectRatio, sceneNumber, referenceImages = []) {
  console.log(`[Story] === Creating image for scene ${sceneNumber} ===`);
  console.log(`[Story] Aspect Ratio: ${aspectRatio}`);

  try {
    if (isInScenebuilderPage()) {
      throw new Error('อยู่ใน Scene Builder - ต้องกลับหน้าหลักก่อน');
    }

    showBotOverlay(`สร้างรูปฉาก ${sceneNumber}...`, 'เตรียมความพร้อม');

    const imagesBefore = countAllGeneratedImages();
    console.log(`[Story] Images before: ${imagesBefore}`);

    // 0.5 กดปุ่ม Images tab ก่อน
    updateBotOverlay('กดปุ่ม Images...', `ฉาก ${sceneNumber}`);
    await step0_ClickImagesTab();
    await delay(1000);

    // 1. เลือกโหมด Create Image
    updateBotOverlay('เลือกโหมด Create Image...', `ฉาก ${sceneNumber}`);
    await step1_SelectImageMode();
    await delay(1500);

    // 2. เปิด Settings
    updateBotOverlay('เปิด Settings...', `ฉาก ${sceneNumber}`);
    await step2_OpenSettings();
    await delay(1000);

    // 3. เลือก Model = Nano Banana Pro
    updateBotOverlay('เลือก Model...', `ฉาก ${sceneNumber}`);
    await step2_SelectModel('Nano Banana Pro');
    await delay(1000);

    // 4. เลือก Aspect Ratio
    updateBotOverlay('ตั้งค่า Aspect Ratio...', `ฉาก ${sceneNumber}`);
    const isPortrait = aspectRatio === '9:16';
    await step2_SelectAspectRatio(isPortrait);
    await delay(1000);

    // 5. เลือก Outputs per Prompt = 1
    updateBotOverlay('ตั้งค่า Output = 1...', `ฉาก ${sceneNumber}`);
    await step2_SelectOutputCount(1);
    await delay(800);

    // 6. ปิด Settings
    await step2_CloseSettings();
    await delay(1000);

    // Upload reference images (ถ้ามี)
    if (sceneNumber > 1) {
      await clearReferenceImages();
      await delay(500);
    }
    if (referenceImages.length > 0) {
      updateBotOverlay('อัพโหลดรูป Reference...', `ฉาก ${sceneNumber}`);
      for (let i = 0; i < referenceImages.length; i++) {
        const refImg = referenceImages[i];
        if (refImg.base64) {
          console.log(`[Story] Uploading reference image ${i + 1}: ${refImg.name || refImg.type}`);
          // ทุกรูปต้องกด + ก่อน แล้วค่อย Upload (หน้า Flow ไม่มีปุ่ม Upload ตรง)
          await step3_AddAdditionalImage(refImg.base64, i);
          await step3_HandleCropDialog(aspectRatio === '9:16');
          await delay(500);
        }
      }
      // รอให้ ref image thumbnail โหลดเสร็จก่อนไปขั้นตอนถัดไป
      updateBotOverlay('รอรูป Reference โหลด...', `ฉาก ${sceneNumber}`);
      await waitForRefImageReady(referenceImages.filter(r => r.base64).length);
    }

    // 7. กรอก Image Prompt
    updateBotOverlay('กรอก Prompt...', `ฉาก ${sceneNumber}`);
    await step5_EnterPrompt(imagePrompt);

    // 8. กด Generate
    updateBotOverlay('กด Generate...', `ฉาก ${sceneNumber}`);
    clipCountBeforeGenerate = countAllClipElements();
    failedCountBeforeGenerate = countAllFailedGenerations();
    currentBatchId++;
    retryCount = 0;

    const generated = await step6_Generate();
    if (!generated) throw new Error('ไม่พบปุ่ม Generate');

    // 9. รอจนรูปเสร็จ
    updateBotOverlay('รอสร้างรูป...', `ฉาก ${sceneNumber}`);
    const newImages = await monitorStoryImageProgress(1, imagesBefore, sceneNumber);
    if (!newImages || newImages.length === 0) throw new Error('สร้างรูปไม่สำเร็จ');

    const img = newImages[0];
    const imageUrl = img?.src || null;

    // 10. เก็บรูปที่ได้
    let imageBase64 = null;
    if (img) {
      try {
        imageBase64 = await convertImageToBase64(img);
        console.log(`[Story] Image base64 length: ${imageBase64?.length || 0}`);
      } catch (e) {
        console.log('[Story] Could not convert to base64:', e.message);
      }
    }

    hideBotOverlay();
    console.log(`[Story] Scene ${sceneNumber} image created:`, imageUrl?.substring(0, 50));
    return { success: true, imageUrl, imageBase64, sceneNumber };

  } catch (err) {
    hideBotOverlay();
    console.error(`[Story] Scene ${sceneNumber} image error:`, err);
    return { success: false, error: err.message, sceneNumber };
  }
}

/**
 * สร้างวิดีโอสำหรับ 1 ฉาก (จากหน้าหลัก)
 */
async function createStorySceneVideo(videoPrompt, sceneNumber, mode = 'frames_to_video') {
  console.log(`[Story v14] === Creating video for scene ${sceneNumber} ===`);
  console.log(`[Story v14] Mode: ${mode}`);

  try {
    showBotOverlay(`Story Mode: สร้างวิดีโอฉาก ${sceneNumber}...`, 'เตรียมความพร้อม');
    updateStatus(`Story Mode: กำลังสร้างวิดีโอฉากที่ ${sceneNumber}...`);

    await closeAnyOpenPanels();
    await clickGridViewButton();

    // Step 1: Select video mode
    updateBotOverlay('กำลังเลือกโหมด...', `ฉาก ${sceneNumber}`);
    await step1_SelectMode();

    // Step 2: Configure (เลือก Veo model ตาม toggle)
    updateBotOverlay('กำลังตั้งค่า...', `ฉาก ${sceneNumber}`);
    let veoModelName = 'Veo 3.1 - Fast';
    try {
      const { useVeoLowerPriority } = await chrome.storage.local.get('useVeoLowerPriority');
      if (useVeoLowerPriority) veoModelName = 'Veo 3.1 - Lower Priority';
    } catch(e) {}
    await step2_ConfigureSettings({ clipCount: 1, modelName: veoModelName });

    // Find latest generated image
    updateBotOverlay('กำลังหารูป...', `ฉาก ${sceneNumber}`);
    const images = findGeneratedImagesDirectly();
    if (images.length === 0) throw new Error('ไม่พบรูปในหน้า - กรุณาสร้างรูปก่อน');

    const latestImage = images[images.length - 1];
    console.log(`[Story v14] Using latest image:`, latestImage.src?.substring(0, 50));

    updateBotOverlay('กำลังใช้รูป...', `ฉาก ${sceneNumber}`);
    const used = await useGeneratedImageForVideo(latestImage);
    if (!used) throw new Error('ไม่สามารถใช้รูปได้');

    // Crop + Prompt
    await step3_HandleCropDialog(true);
    updateBotOverlay('กำลังกรอก Prompt...', `ฉาก ${sceneNumber}`);
    await step5_EnterPrompt(videoPrompt);

    // Generate
    updateBotOverlay('กำลังสร้างวิดีโอ...', `ฉาก ${sceneNumber}`);
    clipCountBeforeGenerate = countAllClipElements();
    failedCountBeforeGenerate = countAllFailedGenerations();
    currentBatchId++;
    retryCount = 0;

    const generated = await step6_Generate();
    if (!generated) throw new Error('ไม่พบปุ่ม Generate');

    updateBotOverlay('รอการสร้างวิดีโอ...', `ฉาก ${sceneNumber}`);
    await monitorStoryVideoProgress(1, sceneNumber);

    hideBotOverlay();
    console.log(`[Story v14] Scene ${sceneNumber} video created successfully`);
    return { success: true, sceneNumber };

  } catch (err) {
    hideBotOverlay();
    console.error(`[Story v14] Scene ${sceneNumber} video error:`, err);
    return { success: false, error: err.message, sceneNumber };
  }
}

/**
 * สร้างวิดีโอบน Flow Page โดยตรง (ไม่ต้องไป Scenebuilder)
 */
async function createStoryVideoOnFlowPage(videoPrompt, sceneNumber, sceneIndex, aspectRatio, imageUrl, imageBase64) {
  console.log(`[Story v16] === Creating video on Flow page for scene ${sceneNumber} ===`);
  console.log(`[Story v16] Has imageUrl: ${!!imageUrl}, Has imageBase64: ${!!imageBase64}`);

  try {
    if (!imageBase64 && !imageUrl) throw new Error(`ไม่พบรูปสำหรับฉากที่ ${sceneNumber}`);

    showBotOverlay(`Story Mode: สร้างคลิปฉาก ${sceneNumber}...`, 'บน Flow Page');
    updateStatus(`Story Mode: กำลังสร้างคลิปฉากที่ ${sceneNumber} บน Flow Page...`);

    // Helper: ส่ง log ไป Activity Log ใน side panel
    function logToPanel(text, type) {
      try { chrome.runtime.sendMessage({ action: 'storyLog', text, type: type || 'info', sceneNumber }); } catch(e) {}
    }

    const isPortrait = aspectRatio === '9:16';

    // Step A: เตรียมหน้า (Videos tab ถูกกดจาก pipeline Step 2 แล้ว)
    logToPanel('เตรียมหน้า...', 'step');
    updateBotOverlay('เตรียมหน้า...', `ฉาก ${sceneNumber}`);
    await closeAnyOpenPanels();
    await delay(800);
    await clickGridViewButton();
    await delay(1000);
    if (await isStopRequested()) throw new Error('หยุดโดยผู้ใช้');

    // Step B: เลือกโหมด Frames to Video
    logToPanel('เลือกโหมด Frames to Video...', 'step');
    updateBotOverlay('เลือกโหมด Frames to Video...', `ฉาก ${sceneNumber}`);
    await step1_SelectMode();
    await delay(1500);
    if (await isStopRequested()) throw new Error('หยุดโดยผู้ใช้');

    // Step C: ตั้งค่า (aspect ratio + outputs = 1 + เลือก Veo model)
    logToPanel('ตั้งค่า...', 'step');
    updateBotOverlay('ตั้งค่า...', `ฉาก ${sceneNumber}`);
    let veoModel = 'Veo 3.1 - Fast';
    try {
      const { useVeoLowerPriority } = await chrome.storage.local.get('useVeoLowerPriority');
      if (useVeoLowerPriority) veoModel = 'Veo 3.1 - Lower Priority';
    } catch(e) {}
    await step2_ConfigureSettings({ clipCount: 1, aspectRatio: aspectRatio, modelName: veoModel });
    await delay(1000);
    if (await isStopRequested()) throw new Error('หยุดโดยผู้ใช้');

    // D0: ดาวน์โหลดรูปจาก URL ก่อน (เหมือน 16s: imageToFile)
    let imageUsed = false;
    let imageFile = null;
    const urlId = imageUrl ? imageUrl.split('/').pop()?.substring(0, 20) : 'null';

    if (imageUrl) {
      logToPanel(`📥 ดาวน์โหลดรูปจาก URL ...${urlId}`, 'info');
      updateBotOverlay('ดาวน์โหลดรูป...', `ฉาก ${sceneNumber}`);
      try {
        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        imageFile = new File([blob], 'scene_image.png', { type: blob.type || 'image/png' });
        console.log(`[Story v16] Scene ${sceneNumber}: Downloaded ${(imageFile.size / 1024).toFixed(1)} KB`);
        logToPanel(`✅ ดาวน์โหลดรูปสำเร็จ (${(imageFile.size / 1024).toFixed(1)} KB)`, 'success');
      } catch (e) {
        console.error(`[Story v16] Scene ${sceneNumber} download failed:`, e);
        logToPanel(`❌ ดาวน์โหลดรูปล้มเหลว: ${e.message}`, 'error');
      }
      await delay(500);
    }

    // D1: กด "+" ด้วย humanClick (เหมือน 16s mode ที่ทำงานได้)
    logToPanel('กดปุ่ม +...', 'step');
    updateBotOverlay('กดปุ่ม +...', `ฉาก ${sceneNumber}`);
    {
      const addBtn = findButtonByIcon('add');
      if (addBtn) {
        humanClick(addBtn);
        console.log('[Story v16] Clicked + button (humanClick)');
        logToPanel('✅ กดปุ่ม +', 'success');
      } else {
        logToPanel('⚠️ หาปุ่ม + ไม่เจอ', 'warning');
      }
    }
    await delay(5000);

    // D1.5 Safety net: ถ้ายังเจอ auto-fill → ลบ reference → กด + อีกครั้ง
    {
      let hasFirstFrame = false;
      document.querySelectorAll('span').forEach(sp => {
        if (sp.textContent?.trim() === 'First Frame') hasFirstFrame = true;
      });

      if (hasFirstFrame) {
        console.log('[Story v16] Auto-fill detected — clearing references...');
        logToPanel('🔄 Auto-fill detected → ลบ reference เก่า...', 'info');
        await clearReferenceImages();
        await delay(1500);

        // กด + อีกครั้ง (หลังลบ reference แล้ว)
        const addBtn2 = findButtonByIcon('add');
        if (addBtn2) {
          humanClick(addBtn2);
          console.log('[Story v16] Clicked + button again after clearing references');
          logToPanel('✅ กดปุ่ม + อีกครั้ง', 'success');
        }
        await delay(5000);
      }
    }

    // D2: กด Upload + อัพโหลดรูปที่ดาวน์โหลดไว้แล้ว
    if (imageFile && !imageUsed) {
      logToPanel('กด Upload + อัพโหลดรูป...', 'step');
      updateBotOverlay('อัพโหลดรูป...', `ฉาก ${sceneNumber}`);
      try {
        await step3_UploadImageFile(imageFile);
        imageUsed = true;
        logToPanel('✅ อัพโหลดรูปสำเร็จ', 'success');
      } catch (e) {
        console.error(`[Story v16] Scene ${sceneNumber} upload failed:`, e);
        logToPanel(`❌ อัพโหลดล้มเหลว: ${e.message}`, 'error');
      }
    }

    // Fallback: ใช้ base64 จาก pipeline
    if (!imageUsed && imageBase64) {
      logToPanel('🔄 Fallback: ใช้ base64...', 'info');
      try {
        await step3_UploadImage(imageBase64);
        imageUsed = true;
        logToPanel('✅ อัพโหลด (base64) สำเร็จ', 'success');
      } catch (e) {
        logToPanel('❌ อัพโหลด base64 ล้มเหลว: ' + e.message, 'error');
      }
    }

    if (!imageUsed) throw new Error(`ไม่สามารถใช้รูปฉากที่ ${sceneNumber} ได้`);
    await delay(1000);
    if (await isStopRequested()) throw new Error('หยุดโดยผู้ใช้');

    // Step E: จัดการ Crop dialog
    logToPanel('จัดการ Crop...', 'step');
    updateBotOverlay('จัดการ Crop...', `ฉาก ${sceneNumber}`);
    await step3_HandleCropDialog(isPortrait);
    await delay(1200); // รอหลัง crop เหมือนคนดูผลลัพธ์
    if (await isStopRequested()) throw new Error('หยุดโดยผู้ใช้');

    // Step E2: รอรูป Reference โหลดเสร็จ (แบบ 16s: เช็ค img.complete + naturalWidth + ไม่มี spinner)
    logToPanel('รอรูป Reference โหลด...', 'step');
    updateBotOverlay('รอรูป Reference โหลด...', `ฉาก ${sceneNumber}`);
    console.log('[Story v16] Step E2: Waiting for reference image to load (16s pattern)...');
    {
      const waitStart = Date.now();
      const maxWait = 30000;
      let imageReady = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        await delay(2000);
        if (await isStopRequested()) throw new Error('หยุดโดยผู้ใช้');
        const elapsed = Math.round((Date.now() - waitStart) / 1000);
        if (elapsed > maxWait / 1000) break;

        // เช็ค img ที่โหลดเสร็จจริง (เหมือน 16s: img.complete && naturalWidth > 50)
        const allImgs = document.querySelectorAll('img');
        const fullyLoadedImgs = Array.from(allImgs).filter(
          img => img.src && img.src.length > 50 && img.complete && img.naturalWidth > 50
        );

        // เช็ค loading indicator (เหมือน 16s)
        const loadingSpinners = document.querySelectorAll(
          'mat-spinner, mat-progress-spinner, [role="progressbar"], .loading'
        );
        const hasLoading = loadingSpinners.length > 0;

        // เช็ค First Frame button (= reference image พร้อม)
        let hasFirstFrame = false;
        const spans = document.querySelectorAll('span');
        for (const sp of spans) {
          if (sp.textContent?.trim() === 'First Frame') { hasFirstFrame = true; break; }
        }

        console.log(`[Story v16] E2 check #${attempt + 1}: imgs=${fullyLoadedImgs.length}, loading=${hasLoading}, firstFrame=${hasFirstFrame}`);

        if (hasFirstFrame && fullyLoadedImgs.length > 0 && !hasLoading) {
          imageReady = true;
          logToPanel(`✅ รูป Reference โหลดเสร็จ (${elapsed}s)`, 'success');
          console.log(`[Story v16] Reference image ready after ${elapsed}s`);
          break;
        }
        logToPanel(`รอรูปโหลด... (${elapsed}s)`, 'info');
      }
      if (!imageReady) {
        logToPanel('⚠️ รอรูปโหลดนาน — ดำเนินการต่อ', 'warning');
        console.warn('[Story v16] Reference image wait timeout, continuing');
      }
      await delay(1500); // buffer เหมือน 16s — รอรูปเซ็ตตัวเต็ม
    }
    if (await isStopRequested()) throw new Error('หยุดโดยผู้ใช้');

    // Step F: กรอก Prompt
    logToPanel('กรอก Prompt...', 'step');
    updateBotOverlay('กรอก Prompt...', `ฉาก ${sceneNumber}`);
    await step5_EnterPrompt(videoPrompt);
    await delay(1500); // รอหลังกรอก prompt เหมือนคนตรวจทาน
    if (await isStopRequested()) throw new Error('หยุดโดยผู้ใช้');

    // Step G: จำ existing video URLs ก่อน generate
    const existingVideoUrls = new Set();
    document.querySelectorAll('video[src*="storage.googleapis.com/ai-sandbox-videofx/video"]').forEach(function(v) {
      if (v.src) existingVideoUrls.add(v.src);
    });
    console.log(`[Story v16] Existing video URLs before generate: ${existingVideoUrls.size}`);

    clipCountBeforeGenerate = countAllClipElements();
    failedCountBeforeGenerate = countAllFailedGenerations();
    currentBatchId++;
    retryCount = 0;

    // Step H: กด Generate (เช็ค stop ก่อน — ยังไม่เสีย credit)
    if (await isStopRequested()) throw new Error('หยุดโดยผู้ใช้');
    await delay(1000); // หยุดคิดก่อนกด Generate
    logToPanel('กด Generate...', 'step');
    updateBotOverlay('กด Generate...', `ฉาก ${sceneNumber}`);
    const generated = await step6_Generate();
    if (!generated) throw new Error('ไม่พบปุ่ม Generate');
    await delay(800); // รอหลังกด Generate
    logToPanel('✅ กด Generate แล้ว — รอสร้างวิดีโอ...', 'success');

    // Step I: รอวิดีโอเสร็จ + จับ URL
    logToPanel('รอสร้างวิดีโอ...', 'step');
    updateBotOverlay('รอสร้างวิดีโอ...', `ฉาก ${sceneNumber}`);
    const monitorResult = await monitorFlowPageVideoProgress(sceneNumber, existingVideoUrls);

    hideBotOverlay();

    if (monitorResult && monitorResult.success) {
      console.log(`[Story v16] Scene ${sceneNumber}: Video created! URL: ${monitorResult.videoUrl ? monitorResult.videoUrl.substring(0, 80) + '...' : 'none'}`);
      return { success: true, sceneNumber, videoUrl: monitorResult.videoUrl };
    } else {
      return { success: false, error: 'สร้างวิดีโอไม่สำเร็จ', sceneNumber };
    }

  } catch (err) {
    hideBotOverlay();
    console.error(`[Story v16] Scene ${sceneNumber} video error:`, err);
    return { success: false, error: err.message, sceneNumber };
  }
}

/**
 * สร้างวิดีโอใน Scene Builder
 */
async function createStoryVideoInSceneBuilder(videoPrompt, sceneNumber, sceneIndex, aspectRatio, imageUrl, imageBase64) {
  console.log(`[Story v15] === Creating video in Scene Builder for scene ${sceneNumber} ===`);
  console.log(`[Story v15] Scene Index: ${sceneIndex}`);
  console.log(`[Story v15] Has imageBase64: ${!!imageBase64}, length: ${imageBase64?.length || 0}`);

  try {
    if (!imageBase64 && !imageUrl) throw new Error(`ไม่พบรูปสำหรับฉากที่ ${sceneNumber}`);

    showBotOverlay(`Story Mode: สร้างคลิปฉาก ${sceneNumber}...`, 'ใน Scene Builder');
    updateStatus(`Story Mode: กำลังสร้างคลิปฉากที่ ${sceneNumber} ใน Scene Builder...`);

    const isPortrait = aspectRatio === '9:16';

    // ==============================
    // Step 3.1: กดแท็บ Frames (UI ใหม่ใช้ tab แทน combobox)
    // ==============================
    updateBotOverlay('กดแท็บ Frames...', `ฉาก ${sceneNumber}`);
    console.log('[Story v15] Step 3.1: Selecting Frames tab...');

    let framesTabFound = false;
    // วิธี 1: หาจาก button[role="tab"] ที่มี text "Frames" หรือ icon "crop_free"
    const frameTabs = document.querySelectorAll('button[role="tab"], button[role="radio"]');
    for (const tab of frameTabs) {
      const text = tab.textContent?.trim().toLowerCase() || '';
      const icon = tab.querySelector('i.google-symbols, i.material-icons');
      if (text.includes('frames') || icon?.textContent?.trim() === 'crop_free') {
        const state = tab.getAttribute('data-state');
        if (state === 'active' || state === 'on') {
          console.log('[Story v15] Already on Frames tab');
        } else {
          clickWithOverlay(tab);
          console.log('[Story v15] Clicked Frames tab');
        }
        framesTabFound = true;
        break;
      }
    }
    // วิธี 2 (legacy): combobox dropdown
    if (!framesTabFound) {
      const modeBtn = findComboboxByLabel('frames to video')
        || findComboboxByLabel('text to video')
        || findComboboxByLabel('ingredients to video')
        || findComboboxByLabel('create image');
      if (modeBtn) {
        const overlay = modeBtn.querySelector('[data-type="button-overlay"]');
        if (overlay) overlay.style.pointerEvents = 'none';
        if (!modeBtn.textContent.toLowerCase().includes('frames to video')) {
          await selectFromCombobox(modeBtn, 'frames to video');
          console.log('[Story v15] Selected Frames to Video (legacy)');
        } else {
          console.log('[Story v15] Already in Frames to Video mode (legacy)');
        }
      } else {
        console.log('[Story v15] ⚠️ Frames tab / mode combobox not found!');
      }
    }
    await delay(1000);

    // ==============================
    // Step 3.2: กดปุ่ม + (icon "add" + overlay)
    // ==============================
    updateBotOverlay('กดปุ่ม + เพิ่มฉาก...', `ฉาก ${sceneNumber}`);
    console.log('[Story v15] Step 3.2: Clicking + button...');

    const maxRetries = 20;
    let plusResult = null;
    for (let i = 0; i <= maxRetries; i++) {
      plusResult = findPlusButtonInTimeline();
      if (plusResult.success) {
        console.log(`[Story v15] ✅ Found + button (attempt ${i}/${maxRetries})`);
        break;
      }
      console.log(`[Story v15] ⏳ + button not found, waiting... (${i}/${maxRetries})`);
      updateBotOverlay('หาปุ่ม +...', `ฉาก ${sceneNumber} (รอ ${i}/${maxRetries})`);
      await delay(1000);
    }
    if (!plusResult?.success) throw new Error('ไม่พบปุ่ม + ใน Timeline หลังรอ 20 วินาที');
    await delay(2000);

    // ==============================
    // Step 3.3: กดปุ่ม Upload + อัพโหลดรูป
    // ==============================
    updateBotOverlay(`อัพโหลดรูปฉากที่ ${sceneNumber}...`, 'จาก base64');
    console.log(`[Story v15] Step 3.3: Uploading image for scene ${sceneNumber}...`);

    let uploaded = false;
    if (imageBase64) {
      uploaded = await uploadImageFromBase64(imageBase64, sceneNumber);
    }
    if (!uploaded && imageUrl) {
      console.log('[Story v15] Base64 upload failed, trying URL fallback...');
      uploaded = await uploadImageFromUrl(imageUrl, sceneNumber);
    }
    if (!uploaded) throw new Error(`ไม่สามารถอัพโหลดรูปฉากที่ ${sceneNumber} ได้`);
    console.log(`[Story v15] Image uploaded successfully for scene ${sceneNumber}`);
    await delay(1500);

    // ==============================
    // Step 3.3.5: จัดการ Crop dialog (ถ้ามี)
    // ==============================
    updateBotOverlay('จัดการ Crop...', `ฉาก ${sceneNumber}`);
    console.log('[Story v15] Step 3.3.5: Handling Crop dialog...');
    await step3_HandleCropDialog(isPortrait);

    // ==============================
    // Step 3.4: เปิด Settings (icon "tune")
    // ==============================
    updateBotOverlay('เปิด Settings...', `ฉาก ${sceneNumber}`);
    console.log('[Story v15] Step 3.4: Opening Settings...');
    await step2_OpenSettings();
    await delay(800);

    // ==============================
    // Step 3.5: เลือก Aspect Ratio
    // ==============================
    updateBotOverlay('เลือก Aspect Ratio...', `ฉาก ${sceneNumber}`);
    console.log('[Story v15] Step 3.5: Setting Aspect Ratio...');
    await step2_SelectAspectRatio(isPortrait);
    await delay(500);

    // ==============================
    // Step 3.6: เลือก Outputs per prompt = 1
    // ==============================
    updateBotOverlay('เลือก Outputs per prompt...', `ฉาก ${sceneNumber}`);
    console.log('[Story v15] Step 3.6: Setting Outputs per prompt = 1...');
    await step2_SelectOutputCount(1);
    await delay(500);

    // ==============================
    // Step 3.7: ปิด Settings
    // ==============================
    console.log('[Story v15] Step 3.7: Closing Settings...');
    await step2_CloseSettings();
    await delay(500);

    // ==============================
    // Step 3.8: ใส่ Video Prompt (textarea#PINHOLE_TEXT_AREA_ELEMENT_ID)
    // ==============================
    updateBotOverlay('กรอก Prompt...', `ฉาก ${sceneNumber}`);
    console.log('[Story v15] Step 3.8: Entering video prompt...');

    // ลองหาจาก ID เฉพาะก่อน
    const promptTextarea = document.getElementById('PINHOLE_TEXT_AREA_ELEMENT_ID')
      || document.querySelector('textarea[placeholder*="Generate a video"]')
      || document.querySelector('textarea');
    if (promptTextarea) {
      fillInput(promptTextarea, videoPrompt);
      console.log('[Story v15] Filled prompt in textarea');
    } else {
      // Fallback: contenteditable
      const editable = document.querySelector('[contenteditable="true"]');
      if (editable) {
        editable.focus();
        editable.textContent = videoPrompt;
        editable.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('[Story v15] Filled prompt in contenteditable');
      }
    }
    await delay(500);

    // ==============================
    // Step 3.9: กด Generate (icon "arrow_forward" + overlay) — กดครั้งเดียว
    // ==============================
    updateBotOverlay('กด Generate...', `ฉาก ${sceneNumber}`);
    console.log('[Story v15] Step 3.9: Clicking Generate...');

    const beforeSeconds = getTotalSecondsInScenebuilder();
    let videoCreated = false;

    // Generate — หาปุ่มที่มี icon "arrow_forward" + span "Create" + overlay
    let genBtn = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      // หาจาก icon arrow_forward ที่อยู่ใน button ที่มี span "Create"
      const icons = document.querySelectorAll('i.google-symbols');
      for (const icon of icons) {
        if (icon.textContent.trim() === 'arrow_forward') {
          const btn = icon.closest('button');
          if (btn) {
            const span = btn.querySelector('span');
            if (span && span.textContent.trim().toLowerCase() === 'create') {
              genBtn = btn;
              break;
            }
          }
        }
      }
      // Fallback: findButtonByIcon ปกติ
      if (!genBtn) genBtn = findButtonByIcon('arrow_forward');
      if (genBtn) break;
      console.log(`[Story v15] Generate button not found, waiting... (${attempt}/15)`);
      await delay(1000);
    }

    if (genBtn) {
      // รอจนปุ่มไม่ disabled
      for (let w = 0; w < 10; w++) {
        if (!genBtn.disabled) break;
        console.log(`[Story v15] Generate button disabled, waiting... (${w}/10)`);
        await delay(1000);
      }
      clickWithOverlay(genBtn);
      console.log('[Story v15] Generate clicked (arrow_forward + Create)');
    } else {
      // Fallback: หาจาก text
      const genByText = findButtonByText('create') || findButtonByText('generate');
      if (genByText) {
        clickWithOverlay(genByText);
        console.log('[Story v15] Generate clicked (text fallback)');
      } else {
        console.log('[Story v15] Generate button not found after 15 retries');
      }
    }

    // ==============================
    // Step 3.10: รอวิดีโอเสร็จ
    // ==============================
    let videoUrl = null;
    try {
      const result = await monitorSceneBuilderVideoProgress(sceneNumber, beforeSeconds);
      if (result && result.success) {
        videoCreated = true;
        videoUrl = result.videoUrl || null;
      } else if (result === true) {
        // backward compat
        videoCreated = true;
      }
    } catch (e) {
      console.log(`[Story v15] Scene ${sceneNumber}: Monitor error:`, e.message);
    }

    hideBotOverlay();

    if (videoCreated) {
      console.log(`[Story v15] Scene ${sceneNumber}: Video creation complete! URL: ${videoUrl ? videoUrl.substring(0, 80) + '...' : 'none'}`);
      return { success: true, sceneNumber, videoUrl };
    } else {
      return { success: false, error: 'Monitor returned false', sceneNumber };
    }

  } catch (err) {
    hideBotOverlay();
    console.error(`[Story v15] Scene ${sceneNumber} video error:`, err);
    return { success: false, error: err.message, sceneNumber };
  }
}

// ============================================================
// MONITORING FUNCTIONS
// ============================================================

/**
 * Monitor image creation progress (MutationObserver + Polling)
 */
async function monitorStoryImageProgress(target, beforeCount, sceneNumber) {
  console.log(`[Story v14] Monitoring image progress for scene ${sceneNumber}, target: ${target}`);

  const timeout = 150 * 1000; // 150 seconds
  const startTime = Date.now();
  const existingUrls = new Set();
  const existingElements = new WeakSet(); // จำ element เก่าด้วย ป้องกัน re-render ของรูปเก่าถูกจับเป็น "ใหม่"

  // Record existing Flow image URLs + elements
  document.querySelectorAll('img').forEach(img => {
    existingElements.add(img);
    if (img.src && img.src.includes('ai-sandbox-videofx/image')) {
      existingUrls.add(img.src);
    }
  });
  console.log(`[Story v14] Scene ${sceneNumber}: Existing Flow image URLs: ${existingUrls.size}`);

  let foundUrl = null;
  let foundElement = null;

  // MutationObserver
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (node.nodeName === 'IMG') checkImage(node, false);
        else if (node.querySelectorAll) {
          node.querySelectorAll('img').forEach(img => checkImage(img, false));
        }
      });
      if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
        checkImage(mutation.target, true);
      }
    }
  });

  function checkImage(img, isAttributeChange) {
    if (!img.src) return;
    if (!img.src.includes('ai-sandbox-videofx/image')) return;
    if (existingUrls.has(img.src)) return;
    // ถ้าเป็น attribute change ของ element เก่า — ยอมรับถ้า URL ใหม่จริงๆ (Flow อาจ recycle element)
    if (isAttributeChange && existingElements.has(img)) {
      console.log(`[Story v14] Scene ${sceneNumber}: Existing element got new URL: ${img.src.substring(0, 50)}... — accepting as new image`);
    }
    console.log(`[Story v14] Scene ${sceneNumber}: 🎉 NEW IMAGE DETECTED via Observer!`);
    console.log(`[Story v14] Scene ${sceneNumber}: URL: ${img.src.substring(0, 50)}...`);
    foundUrl = img.src;
    foundElement = img;
  }

  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  try {
    while (Date.now() - startTime < timeout) {
      await delay(2000);
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      updateBotOverlay(`รอสร้างรูป... ${elapsed}s`, `ฉาก ${sceneNumber}`);

      // Check observer result
      if (foundElement && foundUrl) {
        console.log(`[Story v14] Scene ${sceneNumber}: Image detected by Observer, waiting for stable...`);
        await delay(2000);
        if (foundElement.src === foundUrl) {
          console.log(`[Story v14] Scene ${sceneNumber}: ✅ Image creation complete!`);
          observer.disconnect();
          return [foundElement];
        }
      }

      // Polling fallback — ข้าม element เก่าที่ URL เปลี่ยน (re-render)
      const flowImages = document.querySelectorAll('img[src*="ai-sandbox-videofx/image"]');
      console.log(`[Story v14] Scene ${sceneNumber}: Polling - found ${flowImages.length} Flow images, elapsed: ${elapsed}s`);

      for (const img of flowImages) {
        if (!existingUrls.has(img.src)) {
          console.log(`[Story v14] Scene ${sceneNumber}: 🎉 NEW IMAGE FOUND via Polling! (new URL)`);
          await delay(1000);
          observer.disconnect();
          return [img];
        }
      }

      // Check for failed generation
      if (countAllFailedGenerations() > failedCountBeforeGenerate) {
        console.log(`[Story v14] Scene ${sceneNumber}: Detected failed generation`);
      }
    }
  } finally {
    observer.disconnect();
  }

  // Last resort: check if any new images appeared — ใช้ element ใหม่เท่านั้น
  const allImages = findGeneratedImagesDirectly();
  const totalNow = countAllGeneratedImages();
  if (totalNow > beforeCount && allImages.length > 0) {
    // หา element ใหม่ (ไม่อยู่ใน existingElements)
    const newOnly = allImages.filter(img => !existingElements.has(img));
    if (newOnly.length > 0) {
      console.log(`[Story v14] Scene ${sceneNumber}: Timeout - using new element (${newOnly.length} new)`);
      return [newOnly[0]]; // เอาอันแรก (ใหม่สุดใน DOM = อยู่บนสุด)
    }
    // Fallback: ถ้าไม่มี new element ใช้อันที่ URL ไม่ซ้ำ
    const newUrlOnly = allImages.filter(img => !existingUrls.has(img.src));
    if (newUrlOnly.length > 0) {
      console.log(`[Story v14] Scene ${sceneNumber}: Timeout - using image with new URL`);
      return [newUrlOnly[0]];
    }
    console.log(`[Story v14] Scene ${sceneNumber}: Timeout - no new elements/URLs, using first image`);
    return [allImages[0]]; // เอาอันแรก (ใหม่สุดบน Flow = อยู่บนสุด)
  }

  console.log(`[Story v14] Scene ${sceneNumber}: Timeout waiting for image`);
  throw new Error('หมดเวลารอสร้างรูป');
}

/**
 * Monitor video creation progress
 */
async function monitorStoryVideoProgress(target, sceneNumber) {
  console.log(`[Story v14] Monitoring video progress for scene ${sceneNumber}`);

  const timeout = 300 * 1000; // 5 minutes
  const startTime = Date.now();
  const clipsBefore = countAllClipElements();
  let stableCount = 0;
  let lastClipCount = clipsBefore;

  while (Date.now() - startTime < timeout) {
    await delay(5000);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    updateBotOverlay(`รอสร้างวิดีโอ... ${elapsed}s`, `ฉาก ${sceneNumber}`);

    // Check generating indicator
    const generating = document.querySelector('.generating-indicator, [data-generating="true"], .loading-spinner');
    if (generating) {
      console.log(`[Story v14] Scene ${sceneNumber}: Still generating video...`);
      stableCount = 0;
      continue;
    }

    const currentClips = countAllClipElements();
    const newClips = currentClips - clipsBefore;
    console.log(`[Story v14] Scene ${sceneNumber}: ${newClips} new clips`);

    if (newClips >= target) {
      if (currentClips === lastClipCount) {
        stableCount++;
        if (stableCount >= 2) {
          console.log(`[Story v14] Scene ${sceneNumber}: Video creation complete!`);
          return true;
        }
      } else {
        stableCount = 0;
      }
      lastClipCount = currentClips;
    }

    // Check failed
    if (countAllFailedGenerations() > failedCountBeforeGenerate) {
      console.log(`[Story v14] Scene ${sceneNumber}: Detected failed video generation`);
      throw new Error('การสร้างวิดีโอล้มเหลว');
    }
  }

  console.log(`[Story v14] Scene ${sceneNumber}: Timeout waiting for video`);
  throw new Error('หมดเวลารอสร้างวิดีโอ');
}

/**
 * Monitor video progress on Flow page (hybrid: clip count + progress % + video URL capture)
 */
async function monitorFlowPageVideoProgress(sceneNumber, existingVideoUrls) {
  console.log(`[Story v16] Monitoring Flow page video for scene ${sceneNumber}`);

  const timeout = 300 * 1000; // 5 นาที
  const startTime = Date.now();
  const clipsBefore = countAllClipElements();
  let stableCount = 0;
  let lastClipCount = clipsBefore;
  let progressAppeared = false;

  while (Date.now() - startTime < timeout) {
    await delay(5000);

    if (await isStopRequested()) {
      console.log(`[Story v16] Scene ${sceneNumber}: Stop requested by user`);
      throw new Error('หยุดโดยผู้ใช้');
    }

    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    // ตรวจ progress % (อาจปรากฏบน Flow page เหมือน Scenebuilder)
    const progressText = getProgressPercentText();
    if (progressText) {
      progressAppeared = true;
      updateBotOverlay(`สร้างวิดีโอ... ${progressText}`, `ฉาก ${sceneNumber}`);
    } else {
      updateBotOverlay(`รอสร้างวิดีโอ... ${elapsed}s`, `ฉาก ${sceneNumber}`);
    }

    // ถ้า progress % เคยปรากฏแล้วหายไป = เสร็จ
    if (progressAppeared && !hasProgressPercent()) {
      await delay(2000);
      if (!hasProgressPercent()) {
        const videoUrl = findNewVideoUrl(existingVideoUrls);
        console.log(`[Story v16] Scene ${sceneNumber}: Progress gone — done! (${elapsed}s) URL: ${videoUrl ? videoUrl.substring(0, 80) : 'none'}`);
        return { success: true, videoUrl: videoUrl };
      }
    }

    // ตรวจ generating indicator
    const generating = document.querySelector('.generating-indicator, [data-generating="true"], .loading-spinner');
    if (generating) {
      console.log(`[Story v16] Scene ${sceneNumber}: Still generating...`);
      stableCount = 0;
      continue;
    }

    // ตรวจจำนวน clip เพิ่ม
    const currentClips = countAllClipElements();
    const newClips = currentClips - clipsBefore;

    if (newClips >= 1) {
      if (currentClips === lastClipCount) {
        stableCount++;
        if (stableCount >= 2) {
          const videoUrl = findNewVideoUrl(existingVideoUrls);
          console.log(`[Story v16] Scene ${sceneNumber}: Video done (clips)! URL: ${videoUrl ? videoUrl.substring(0, 80) : 'none'}`);
          return { success: true, videoUrl: videoUrl };
        }
      } else {
        stableCount = 0;
      }
      lastClipCount = currentClips;
    }

    // ตรวจ failed
    if (countAllFailedGenerations() > failedCountBeforeGenerate) {
      console.log(`[Story v16] Scene ${sceneNumber}: Failed generation detected`);
      throw new Error('การสร้างวิดีโอล้มเหลว');
    }

    // Log ทุก 30 วินาที
    if (elapsed % 30 === 0 && elapsed > 0) {
      console.log(`[Story v16] Scene ${sceneNumber}: Waiting... ${elapsed}s, clips=${currentClips}, progress=${progressText || 'none'}`);
    }
  }

  console.log(`[Story v16] Scene ${sceneNumber}: Timeout after 5 minutes`);
  throw new Error('หมดเวลารอสร้างวิดีโอ');
}

/**
 * Monitor video progress in Scene Builder (by checking timeline duration)
 */
async function monitorSceneBuilderVideoProgress(sceneNumber, beforeSeconds) {
  const timeout = 180 * 1000; // 3 นาที
  const startTime = Date.now();

  // จำ video URLs ก่อน generate เพื่อหา URL ใหม่ทีหลัง
  const existingVideoUrls = new Set();
  document.querySelectorAll('video[src*="storage.googleapis.com/ai-sandbox-videofx/video"]').forEach(v => {
    if (v.src) existingVideoUrls.add(v.src);
  });

  // รอให้ % progress ปรากฏก่อน (แสดงว่า generate เริ่มแล้ว)
  let progressAppeared = false;
  for (let i = 0; i < 30; i++) { // รอสูงสุด 30 วิ
    await delay(1000);
    if (hasProgressPercent()) {
      progressAppeared = true;
      console.log(`[Story v15] Scene ${sceneNumber}: Progress % appeared — generation started`);
      break;
    }
  }

  if (!progressAppeared) {
    console.log(`[Story v15] Scene ${sceneNumber}: No progress % found after 30s — checking timeline fallback`);
  }

  // วนรอจน % หายไป = เสร็จ
  while (Date.now() - startTime < timeout) {
    await delay(3000);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    const progressText = getProgressPercentText();
    if (progressText) {
      updateBotOverlay(`สร้างวิดีโอ... ${progressText}`, `ฉาก ${sceneNumber}`);
    } else {
      updateBotOverlay(`รอสร้างวิดีโอ... ${elapsed}s`, `ฉาก ${sceneNumber}`);
    }

    // ถ้าเคยเห็น % แล้วตอนนี้หายไป = เสร็จ
    if (progressAppeared && !hasProgressPercent()) {
      // รอเพิ่ม 2 วิ แล้วเช็คอีกครั้ง (กัน false positive)
      await delay(2000);
      if (!hasProgressPercent()) {
        const videoUrl = findNewVideoUrl(existingVideoUrls);
        console.log(`[Story v15] Scene ${sceneNumber}: Progress % gone — video complete! (${elapsed}s) URL: ${videoUrl ? videoUrl.substring(0, 80) + '...' : 'none'}`);
        return { success: true, videoUrl };
      }
    }

    // Fallback: ตรวจ timeline duration เหมือนเดิม
    const currentSeconds = getTotalSecondsInScenebuilder();
    const added = currentSeconds - beforeSeconds;
    if (added >= 6) {
      const videoUrl = findNewVideoUrl(existingVideoUrls);
      console.log(`[Story v15] Scene ${sceneNumber}: Video created (timeline)! ${currentSeconds}s (+${added}s) URL: ${videoUrl ? videoUrl.substring(0, 80) + '...' : 'none'}`);
      return { success: true, videoUrl };
    }

    // Log progress
    if (elapsed % 30 === 0) {
      console.log(`[Story v15] Scene ${sceneNumber}: Still waiting... ${elapsed}s, progress=${progressText || 'none'}, timeline=${currentSeconds}s`);
    }
  }

  console.log(`[Story v15] Scene ${sceneNumber}: Timeout after 300s`);
  return false;
}

/**
 * หา video URL ใหม่ที่ไม่เคยมีมาก่อน
 */
function findNewVideoUrl(existingVideoUrls) {
  const videos = document.querySelectorAll('video[src*="storage.googleapis.com/ai-sandbox-videofx/video"]');
  for (const v of videos) {
    if (v.src && !existingVideoUrls.has(v.src)) {
      return v.src;
    }
  }
  // Fallback: คืน URL ตัวสุดท้าย
  if (videos.length > 0) {
    return videos[videos.length - 1].src;
  }
  return null;
}

function hasProgressPercent() {
  // ตรวจหา element ที่แสดง % ใน timeline (เช่น <div class="sc-b546f8b9-4 hQLkNR">42%</div>)
  const allEls = document.querySelectorAll('div, span');
  for (const el of allEls) {
    const text = (el.textContent || '').trim();
    if (/^\d{1,3}%$/.test(text) && el.offsetWidth > 0 && el.offsetHeight > 0) {
      return true;
    }
  }
  return false;
}

function getProgressPercentText() {
  const allEls = document.querySelectorAll('div, span');
  for (const el of allEls) {
    const text = (el.textContent || '').trim();
    if (/^\d{1,3}%$/.test(text) && el.offsetWidth > 0 && el.offsetHeight > 0) {
      return text;
    }
  }
  return null;
}

// ============================================================
// HELPER FUNCTIONS (Google Flow specific)
// ============================================================

function closeAnyOpenPanels() {
  // Close any open side panels or modals
  const closeButtons = document.querySelectorAll('[aria-label="Close"], button[class*="close"]');
  closeButtons.forEach(btn => {
    try { btn.click(); } catch (e) { }
  });
  return delay(200);
}

function clickGridViewButton() {
  const gridBtn = document.querySelector('[aria-label="Grid view"], [class*="grid-view"]');
  if (gridBtn) gridBtn.click();
  return delay(200);
}

function countAllGeneratedImages() {
  return document.querySelectorAll('img[src*="ai-sandbox-videofx/image"]').length;
}

function countAllClipElements() {
  return document.querySelectorAll('[class*="clip"], [class*="video-card"]').length;
}

function countAllFailedGenerations() {
  let count = 0;
  document.querySelectorAll('span, div, p').forEach(el => {
    const text = (el.textContent || '').toLowerCase();
    if (text.includes('failed') || text.includes('error') || text.includes('ล้มเหลว')) {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) count++;
    }
  });
  return count;
}

function findGeneratedImagesDirectly() {
  return Array.from(document.querySelectorAll('img[src*="ai-sandbox-videofx/image"]'));
}

async function useGeneratedImageForVideo(imgElement) {
  if (!imgElement) return false;
  try {
    simulateClick(imgElement);
    await delay(500);
    return true;
  } catch (e) {
    return false;
  }
}

// รอให้ ref image thumbnail โหลดเสร็จ (ตรวจจาก "This is your ingredient" element)
async function waitForRefImageReady(expectedCount, maxWaitMs = 20000) {
  console.log(`[Story] Waiting for ${expectedCount} ingredient(s) to be ready...`);
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    // นับ ingredient ที่โหลดเสร็จแล้ว — มี span ข้อความ "ingredient" อยู่ข้างใน
    const allSpans = document.querySelectorAll('span');
    let ingredientCount = 0;
    for (const span of allSpans) {
      if (span.textContent?.toLowerCase().includes('this is your ingredient')) {
        ingredientCount++;
      }
    }
    if (ingredientCount >= expectedCount) {
      console.log(`[Story] All ${ingredientCount} ingredient(s) ready`);
      return;
    }
    console.log(`[Story] Ingredients: ${ingredientCount}/${expectedCount} — waiting...`);
    await delay(1500);
  }
  console.log('[Story] Ingredient wait timeout — proceeding anyway');
}

async function clearReferenceImages() {
  // แบบ 16s: ลบวนลูปจนไม่เหลือ (2 รอบ)
  let totalRemoved = 0;

  for (let round = 0; round < 2; round++) {
    let removedThisRound = 0;

    // วิธี 1: หาปุ่มที่มี icon "close" + <span>First Frame</span>
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const span = btn.querySelector('span');
      if (span && span.textContent?.trim() === 'First Frame') {
        const closeIcon = btn.querySelector('i.google-symbols');
        if (closeIcon && closeIcon.textContent?.trim() === 'close') {
          console.log('[Story] Removing reference via First Frame close button');
          simulateClick(btn);
          removedThisRound++;
          await delay(800); // รอ UI อัพเดท (เหมือน 16s)
        }
      }
    }

    // วิธี 2: หาปุ่ม delete icon (เหมือน 16s: deleteAllClipsInSceneBuilder)
    while (true) {
      const deleteBtn = findButtonByIcon('delete');
      if (!deleteBtn) break;
      simulateClick(deleteBtn);
      removedThisRound++;
      console.log('[Story] Removed clip via delete icon');
      await delay(800);
    }

    // วิธี 3: หาปุ่มที่มี class "remove" หรือ aria-label "Remove"
    const removeButtons = document.querySelectorAll('[class*="remove"], [aria-label*="Remove"]');
    removeButtons.forEach(btn => { try { btn.click(); removedThisRound++; } catch (e) { } });

    totalRemoved += removedThisRound;
    if (removedThisRound === 0) break;
    await delay(1000); // รอ UI settle ก่อนรอบถัดไป
  }

  console.log(`[Story] clearReferenceImages: removed ${totalRemoved} items`);
  await delay(500);
}

function findPlusButtonInTimeline() {
  // วิธีเดียวกับ Mode 16s (handleVideo8sAddImage) ที่ทำงานได้จริง
  let addBtn = null;

  // 1. หาทุกปุ่มที่มี icon "add" → sort ตำแหน่ง → เอาอันซ้ายสุด
  const addBtns = [];
  const allBtns = document.querySelectorAll('button');
  for (const btn of allBtns) {
    const icon = btn.querySelector('i.google-symbols, i.material-icons');
    if (icon && icon.textContent?.trim() === 'add') {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        addBtns.push(btn);
      }
    }
  }
  if (addBtns.length > 0) {
    addBtns.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    addBtn = addBtns[0];
  }

  // 2. Fallback: #PINHOLE_ADD_CLIP_CARD_ID
  if (!addBtn) {
    addBtn = document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID');
  }

  if (!addBtn) return { success: false };

  // 3. กดใน MAIN world ผ่าน <script> tag (React จะรับ click event ได้)
  const script = document.createElement('script');
  script.textContent = `(function(){
    var btns = document.querySelectorAll('button');
    var addBtns = [];
    for (var i = 0; i < btns.length; i++) {
      var icon = btns[i].querySelector('i.google-symbols, i.material-icons');
      if (icon && icon.textContent.trim() === 'add') {
        var rect = btns[i].getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) addBtns.push(btns[i]);
      }
    }
    if (addBtns.length > 0) {
      addBtns.sort(function(a,b){ return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
      addBtns[0].click();
    }
  })();`;
  document.documentElement.appendChild(script);
  script.remove();

  console.log('[Story] Clicked + button (MAIN world)');
  return { success: true };
}

function getTotalSecondsInScenebuilder() {
  // Look for timeline duration display (format: "0:05 / 0:24")
  const timeElements = document.querySelectorAll('[class*="duration"], [class*="time"]');
  for (const el of timeElements) {
    const text = (el.textContent || '').trim();
    // จับค่ารวม (ค่าหลัง /) จาก format "0:05 / 0:24"
    const slashMatch = text.match(/\d+:\d+\s*\/\s*(\d+):(\d+)/);
    if (slashMatch) {
      return parseInt(slashMatch[1]) * 60 + parseInt(slashMatch[2]);
    }
    const match = text.match(/(\d+):(\d+)/);
    if (match) {
      return parseInt(match[1]) * 60 + parseInt(match[2]);
    }
    const secMatch = text.match(/(\d+)\s*s/);
    if (secMatch) return parseInt(secMatch[1]);
  }
  return 0;
}

function getSceneVideoDuration() {
  return getTotalSecondsInScenebuilder();
}

function hasSceneLoading() {
  return !!document.querySelector('[class*="loading"], [class*="progress"], [class*="spinner"]');
}

function getSceneLoadingPercentage() {
  const progressBars = document.querySelectorAll('[class*="progress"]');
  for (const bar of progressBars) {
    const style = bar.style.width;
    if (style) {
      const match = style.match(/(\d+)/);
      if (match) return parseInt(match[1]);
    }
  }
  return 0;
}

// ============================================================
// IMAGE UPLOAD HELPERS
// ============================================================

function base64ToFile(dataUrl, filename = 'image.png') {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

async function pasteImageFromBase64(base64DataUrl) {
  try {
    const file = base64ToFile(base64DataUrl);
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      clipboardData: dataTransfer
    });

    document.activeElement.dispatchEvent(pasteEvent);
    console.log('[Story v14] Pasted from clipboard');
    return true;
  } catch (e) {
    console.log('[Story v14] Clipboard paste failed:', e.message);
    return false;
  }
}

async function uploadImageFromBase64(base64DataUrl, sceneNumber) {
  console.log(`[Story v14] Uploading image from base64 for scene ${sceneNumber}...`);
  try {
    await step3_UploadImage(base64DataUrl);
    return true;
  } catch (e) {
    console.error('[Story v14] Upload from base64 error:', e);
    return false;
  }
}

async function uploadImageFromUrl(url, sceneNumber) {
  console.log(`[Story v14] Uploading image from URL for scene ${sceneNumber}...`);
  try {
    // Fetch image and convert to base64
    const response = await fetch(url);
    const blob = await response.blob();
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return await uploadImageFromBase64(base64, sceneNumber);
  } catch (e) {
    console.error('[Story v14] Upload from URL error:', e);
    return false;
  }
}

async function convertImageToBase64(imgElement) {
  try {
    const response = await fetch(imgElement.src);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // คืน full data URL (data:image/jpeg;base64,...) เพื่อรักษา MIME type ที่ถูกต้อง
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.log('[Story v14] convertImageToBase64 error:', e.message);
    return null;
  }
}

// ============================================================
// EXPORT & DOWNLOAD ACTIONS
// ============================================================

/**
 * Step 4.1: กดปุ่ม Download (ปุ่ม BLURPLE ที่มี icon "download")
 * HTML: <button color="BLURPLE"><i class="google-symbols">download</i></button>
 */
async function clickDownloadButton() {
  console.log('[Export] Step 4.1: Looking for Download button (BLURPLE)...');
  let btn = null;

  // วิธี 1: หาปุ่ม BLURPLE ที่มี icon download โดยเฉพาะ
  const blurpleButtons = document.querySelectorAll('button[color="BLURPLE"]');
  for (const b of blurpleButtons) {
    const icon = b.querySelector('i.google-symbols');
    if (icon && icon.textContent.trim() === 'download') {
      btn = b;
      console.log('[Export] Found BLURPLE download button');
      break;
    }
  }

  // วิธี 2: หาจาก icon download ที่อยู่ล่างขวาสุด (ปุ่ม export ใน scenebuilder)
  if (!btn) {
    const icons = document.querySelectorAll('i.google-symbols');
    const downloadBtns = [];
    for (const icon of icons) {
      if (icon.textContent.trim() === 'download') {
        const b = icon.closest('button');
        if (b) downloadBtns.push(b);
      }
    }
    if (downloadBtns.length > 0) {
      // เอาอันขวาสุด-ล่างสุด (ปุ่ม export มักอยู่มุมขวาล่าง)
      downloadBtns.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return (rb.right + rb.bottom) - (ra.right + ra.bottom);
      });
      btn = downloadBtns[0];
      console.log('[Export] Found download button by icon position');
    }
  }

  // วิธี 3: Fallback หาจาก text
  if (!btn) {
    btn = findButtonByText('download');
  }

  if (btn) {
    console.log('[Export] Clicking Download button...', btn.className, btn.getAttribute('color'));
    clickWithOverlay(btn);
    await delay(500);
    // กด click เพิ่มอีกรอบเผื่อ overlay บัง
    btn.click();
    console.log('[Export] Clicked Download button (BLURPLE)');
    return { success: true };
  }
  console.log('[Export] Download button not found');
  return { success: false, error: 'Download button not found' };
}

/**
 * Step 4.2 + 4.3: รอ Export toast เสร็จ แล้วกด Download ใน toast
 * - รอ toast "Exporting…" หมุนเสร็จ
 * - พอ toast เปลี่ยนเป็น "Video exported!" → กด Download link ใน toast
 */
async function waitForExportToastComplete(timeout = 120000, captureForTiktok = false) {
  console.log('[Export] Step 4.2: Waiting for export toast...');
  if (captureForTiktok) console.log('[Export] Will capture video for TikTok posting');
  const start = Date.now();

  while (Date.now() - start < timeout) {
    await delay(2000);
    const elapsed = Math.floor((Date.now() - start) / 1000);

    // หา toast ทั้งหมด
    const toasts = document.querySelectorAll('[data-sonner-toast]');

    for (const toast of toasts) {
      const toastText = (toast.textContent || '').toLowerCase();

      // เช็ค "Video exported!" (เสร็จแล้ว)
      if (toastText.includes('video exported')) {
        console.log('[Export] Step 4.3: Found "Video exported!" toast');

        // หา Download link ใน toast
        let foundLink = null;
        const downloadLink = toast.querySelector('a');
        if (downloadLink && downloadLink.textContent.trim().toLowerCase().includes('download')) {
          foundLink = downloadLink;
        }
        // Fallback: หา link ใน toast ทุกตัว
        if (!foundLink) {
          const allLinks = toast.querySelectorAll('a');
          for (const link of allLinks) {
            if (link.textContent.trim().toLowerCase().includes('download')) {
              foundLink = link;
              break;
            }
          }
        }

        if (!foundLink) {
          console.log('[Export] "Video exported!" toast found but no Download link');
          return { success: true, noDownloadLink: true };
        }

        // Post TikTok mode → ไม่กด Download เลย
        // background.js จะจับ URL จาก chrome.downloads.onCreated แทน
        if (captureForTiktok) {
          console.log('[Export] Post TikTok mode — skipping download click (background.js will capture URL)');
          return { success: true, videoCaptured: true };
        }

        // โหมดปกติ → กด download
        foundLink.click();
        console.log('[Export] Clicked Download link in toast');
        await delay(1000);
        return { success: true };
      }

      // เช็ค "Exporting" (กำลังหมุน)
      if (toastText.includes('exporting')) {
        if (elapsed % 10 === 0) {
          console.log(`[Export] Still exporting... ${elapsed}s`);
        }
      }
    }

    // เช็ค failure
    for (const toast of toasts) {
      const toastText = (toast.textContent || '').toLowerCase();
      if (toastText.includes('export failed') || toastText.includes('error')) {
        console.log('[Export] Export failed toast detected');
        return { success: false, failed: true, error: 'Export failed' };
      }
    }

    if (elapsed % 30 === 0 && elapsed > 0) {
      console.log(`[Export] Waiting for export... ${elapsed}s`);
    }
  }

  console.log('[Export] Export timeout');
  return { success: false, error: 'Export timeout' };
}

async function goBackToFlow() {
  // Navigate back from Scene Builder
  const backBtn = findButtonByText('back') || document.querySelector('[aria-label*="Back"]');
  if (backBtn) { simulateClick(backBtn); return { success: true }; }
  return { success: false };
}

// ============================================================
// MESSAGE LISTENER
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  const handlers = {
    'createStoryImage': async () => {
      const result = await createStorySceneImage(
        message.imagePrompt, message.aspectRatio, message.sceneNumber, message.referenceImages || []
      );
      // Save to storage
      const key = `storyImageResult_${message.sceneNumber}`;
      await chrome.storage.local.set({ [key]: result });
      // Notify popup
      try {
        chrome.runtime.sendMessage({
          action: 'storyImageComplete',
          sceneNumber: message.sceneNumber,
          success: result.success,
          imageUrl: result.imageUrl,
          imageBase64: result.imageBase64
        });
      } catch (e) { }
      sendResponse(result);
    },

    'createStoryVideo': async () => {
      const result = await createStorySceneVideo(
        message.videoPrompt, message.sceneNumber, message.mode || 'frames_to_video'
      );
      sendResponse(result);
    },

    'createStoryVideoInSceneBuilder': async () => {
      const result = await createStoryVideoInSceneBuilder(
        message.videoPrompt, message.sceneNumber, message.sceneIndex,
        message.aspectRatio, message.imageUrl, message.imageBase64
      );
      sendResponse(result);
    },

    'createStoryVideoOnFlowPage': async () => {
      const result = await createStoryVideoOnFlowPage(
        message.videoPrompt, message.sceneNumber, message.sceneIndex,
        message.aspectRatio, message.imageUrl, message.imageBase64
      );
      sendResponse(result);
    },

    'clickNewProject': async () => {
      console.log('[StoryMode] Looking for New project button...');
      let btn = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        // วิธี 1: หาจาก icon add_2 (google-symbols)
        btn = findButtonByIcon('add_2');
        // วิธี 2: หาจาก text "New project"
        if (!btn) btn = findButtonByText('New project');
        // วิธี 3: หาจาก text ภาษาไทย
        if (!btn) btn = findButtonByText('โปรเจ็กต์ใหม่');
        if (btn) break;
        console.log(`[StoryMode] New project not found yet (${attempt + 1}/15)...`);
        await delay(1000);
      }
      if (btn) {
        // ลบ overlay div ที่บังปุ่มก่อน click
        const overlay = btn.querySelector('[data-type="button-overlay"]');
        if (overlay) overlay.style.pointerEvents = 'none';
        btn.click();
        simulateClick(btn);
        console.log('[StoryMode] Clicked New project button');
        await delay(3000);
        sendResponse({ success: true });
      } else {
        console.log('[StoryMode] New project button not found after 15 attempts');
        sendResponse({ success: false, error: 'New project button not found' });
      }
    },

    'ensureCleanProject': async () => {
      // ตรวจสอบว่า project ว่างหรือไม่
      const clips = countAllClipElements();
      if (clips > 0 || isInScenebuilderPage()) {
        sendResponse({ success: true, needsRefresh: true, action: 'had_content_created_new' });
      } else {
        sendResponse({ success: true, action: 'ready' });
      }
    },

    'goToScenebuilder': async () => {
      // Legacy — redirect to clickVideosTab
      const handler = handlers['clickVideosTab'];
      if (handler) return handler();
      sendResponse({ success: false, error: 'clickVideosTab not found' });
    },

    'clickVideosTab': async () => {
      // กดปุ่ม tab "Videos" — button[role="tab"] หรือ button[role="radio"] ที่มี icon videocam
      console.log('[StoryMode] clickVideosTab: Checking current state...');

      // เช็คว่า Videos tab active อยู่แล้วหรือไม่
      let alreadyActive = false;
      for (const btn of document.querySelectorAll('button[role="tab"], button[role="radio"]')) {
        const icon = btn.querySelector('i');
        if (icon && icon.textContent.trim() === 'videocam') {
          const state = btn.getAttribute('data-state');
          if (state === 'on' || state === 'active') {
            alreadyActive = true;
          }
          break;
        }
      }
      if (alreadyActive) {
        console.log('[StoryMode] clickVideosTab: Already on Videos tab');
        sendResponse({ success: true });
        return;
      }

      // Inject <script> tag เพื่อรันใน MAIN world โดยตรง (React จะรับ click event ได้)
      console.log('[StoryMode] clickVideosTab: Injecting MAIN world script...');
      const script = document.createElement('script');
      script.textContent = `(function(){
        var btns = document.querySelectorAll('button[role="tab"], button[role="radio"]');
        for (var i = 0; i < btns.length; i++) {
          var icon = btns[i].querySelector('i');
          if (icon && icon.textContent.trim() === 'videocam') { btns[i].click(); break; }
        }
      })();`;
      document.documentElement.appendChild(script);
      script.remove();
      await delay(2000);

      // Verify ว่ากดสำเร็จจาก DOM state
      let success = false;
      for (const btn of document.querySelectorAll('button[role="tab"], button[role="radio"]')) {
        const icon = btn.querySelector('i');
        if (icon && icon.textContent.trim() === 'videocam') {
          const state = btn.getAttribute('data-state');
          success = state === 'on' || state === 'active';
          console.log(`[StoryMode] clickVideosTab: After click — data-state: ${state}`);
          break;
        }
      }

      if (success) {
        console.log('[StoryMode] clickVideosTab: ✅ Videos tab clicked successfully');
      } else {
        console.log('[StoryMode] clickVideosTab: ⚠️ Videos tab may not have been clicked');
      }
      sendResponse({ success });
    },

    'clickImagesTab': async () => {
      // กดปุ่ม tab "Images" — button[role="tab"] หรือ button[role="radio"] ที่มี icon image
      console.log('[StoryMode] clickImagesTab: Checking current state...');

      let alreadyActive = false;
      for (const btn of document.querySelectorAll('button[role="tab"], button[role="radio"]')) {
        const icon = btn.querySelector('i');
        if (icon && icon.textContent.trim() === 'image') {
          const state = btn.getAttribute('data-state');
          if (state === 'on' || state === 'active') {
            alreadyActive = true;
          }
          break;
        }
      }
      if (alreadyActive) {
        console.log('[StoryMode] clickImagesTab: Already on Images tab');
        sendResponse({ success: true });
        return;
      }

      // Inject <script> tag เพื่อรันใน MAIN world โดยตรง (React จะรับ click event ได้)
      console.log('[StoryMode] clickImagesTab: Injecting MAIN world script...');
      const script = document.createElement('script');
      script.textContent = `(function(){
        var btns = document.querySelectorAll('button[role="tab"], button[role="radio"]');
        for (var i = 0; i < btns.length; i++) {
          var icon = btns[i].querySelector('i');
          if (icon && icon.textContent.trim() === 'image') { btns[i].click(); break; }
        }
      })();`;
      document.documentElement.appendChild(script);
      script.remove();
      await delay(2000);

      // Verify จาก DOM state
      let success = false;
      for (const btn of document.querySelectorAll('button[role="tab"], button[role="radio"]')) {
        const icon = btn.querySelector('i');
        if (icon && icon.textContent.trim() === 'image') {
          const state = btn.getAttribute('data-state');
          success = state === 'on' || state === 'active';
          console.log(`[StoryMode] clickImagesTab: After click — data-state: ${state}`);
          break;
        }
      }

      if (success) {
        console.log('[StoryMode] clickImagesTab: ✅ Images tab clicked successfully');
      } else {
        console.log('[StoryMode] clickImagesTab: ⚠️ Images tab may not have been clicked');
      }
      sendResponse({ success });
    },

    'clickPlayButton': async () => {
      const btn = findButtonByText('play') || document.querySelector('[aria-label="Play"]');
      if (btn) { simulateClick(btn); sendResponse({ success: true }); }
      else sendResponse({ success: false });
    },

    'clickDownloadButton': async () => {
      const result = await clickDownloadButton();
      sendResponse(result);
    },

    'waitExportToastComplete': async () => {
      const result = await waitForExportToastComplete(message.timeout || 120000, message.captureForTiktok || false);
      sendResponse(result);
    },

    'checkAndCleanupScenebuilder': async () => {
      sendResponse({ isInScenebuilder: isInScenebuilderPage() });
    },

    'refreshPage': () => {
      sendResponse({ success: true });
      setTimeout(() => window.location.reload(), 500);
    },

    'clearUsedImageUrls': async () => {
      sendResponse({ success: true });
    },

    'getSceneBuilderVideoUrls': async () => {
      console.log('[StoryMode] Getting video URLs from Scene Builder...');
      const urls = [];

      // หา video elements ที่มี storage.googleapis.com URL (Scene Builder clips)
      const storageVideos = document.querySelectorAll('video[src*="storage.googleapis.com/ai-sandbox-videofx/video"]');
      console.log(`[StoryMode] Found ${storageVideos.length} storage video elements`);
      for (const v of storageVideos) {
        if (v.src && !urls.includes(v.src)) {
          urls.push(v.src);
        }
      }

      // Fallback: หา blob URL videos (Scene Builder อาจใช้ blob URL)
      if (urls.length === 0) {
        const blobVideos = document.querySelectorAll('video[src^="blob:"]');
        console.log(`[StoryMode] Found ${blobVideos.length} blob video elements`);
        for (const v of blobVideos) {
          if (v.src && !urls.includes(v.src)) {
            urls.push(v.src);
          }
        }
      }

      console.log(`[StoryMode] Total video URLs found: ${urls.length}`);
      if (urls.length > 0) {
        console.log('[StoryMode] First URL:', urls[0].substring(0, 80) + '...');
      }
      sendResponse({ success: urls.length > 0, urls });
    }
  };

  if (handlers[action]) {
    handlers[action]();
    return true; // Keep sendResponse alive for async
  }
});

console.log('[StoryMode Content Script] Loaded and ready');
