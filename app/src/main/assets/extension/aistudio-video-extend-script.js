// ========================================
// Google Flow Video + Extend Script
// Step 3: GEN วิดีโอ + Step 4: Extend Video
// แยกจาก aistudio-content-script.js
// ========================================

(function () {
  'use strict';

  // ป้องกันการ execute ซ้ำ (เกิดจาก background.js re-inject)
  if (window._videoExtendScriptLoaded) {
    console.log('🔄 aistudio-video-extend-script.js already loaded, skipping...');
    return;
  }
  window._videoExtendScriptLoaded = true;

  // รอ main script initialize ก่อน
  const ctx = window.__flowCtx;
  if (!ctx) {
    console.error('[Video+Extend] __flowCtx not found - main script must load first');
    return;
  }

  // ดึง utilities จาก shared context
  const STATES = ctx.STATES;
  // Patch STATES — กรณี main script เป็นเวอร์ชันเก่า (ถูก skip โดย duplicate-load guard)
  if (!STATES.VIDEO_8S_ADD_IMAGE) {
    STATES.VIDEO_8S_ADD_IMAGE = 'VIDEO_8S_ADD_IMAGE';
  }
  const DELAYS = ctx.DELAYS;
  const TRANSLATIONS = ctx.TRANSLATIONS;
  const log = ctx.log;
  const delay = ctx.delay;
  const waitForElement = ctx.waitForElement;
  const humanClick = ctx.humanClick;
  const findElementByText = ctx.findElementByText;
  const findButtonByIcon = ctx.findButtonByIcon;
  const detectGenerationError = ctx.detectGenerationError;
  const snapshotExistingErrors = ctx.snapshotExistingErrors;
  const checkDailyLimit = ctx.checkDailyLimit;
  const showDailyLimitPopup = ctx.showDailyLimitPopup;
  const matchesAny = ctx.matchesAny;
  const extractVideoId = ctx.extractVideoId;
  const fetchImageAsFile = ctx.fetchImageAsFile;
  const uploadFileToInput = ctx.uploadFileToInput;
  const base64ToFile = ctx.base64ToFile;
  const isUrl = ctx.isUrl;
  const urlToFile = ctx.urlToFile;
  const imageToFile = ctx.imageToFile;
  const findGeneratedImage = ctx.findGeneratedImage;
  const clearFlowCache = ctx.clearFlowCache;
  const selectFirstImageInPanel = ctx.selectFirstImageInPanel;
  const selectImageInPanel = ctx.selectImageInPanel;
  const isAlreadyInCreateImageMode = ctx.isAlreadyInCreateImageMode;
  const STUCK_99_TIMEOUT = ctx.STUCK_99_TIMEOUT || 10000;
  const handleStuckAt99 = ctx.handleStuckAt99 || (async () => { log('⚠️ handleStuckAt99 not available', 'warning'); });
  // deleteAllClipsInSceneBuilder — defined locally below (line ~3850)

  // Shared state accessor (shorthand)
  const S = ctx.state;

  // Helper: ส่งสถานะขั้นตอนไปแสดงใน Activity Log (Viral mode / side panel)
  function sendStepStatus(message, logType) {
    try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId || S.automationData?.rowId, message: message, logType: logType || 'info' } }); } catch(e) {}
  }

  // Local state for this script
  let stuckAt99StartTime = null; // เวลาที่เริ่มค้างที่ 99%

  // ========== Step 3: Video GEN Handlers ==========
  // ========== Step 4: Extend Video Handlers ==========

  // ========== Step 3: Video GEN Handlers ==========

  async function handleVideoSelectMode() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Video Step 1/8: เลือกโหมด Videos', 'step');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // หาปุ่ม Videos (icon: videocam)
    let videosButton = null;

    // วิธี 1: หาจาก icon videocam
    const icons = document.querySelectorAll('i.google-symbols, i.material-icons');
    for (const icon of icons) {
      if (icon.textContent.trim() === 'videocam') {
        const btn = icon.closest('button[role="tab"]') || icon.closest('button[role="radio"]');
        if (btn) {
          videosButton = btn;
          break;
        }
      }
    }

    // วิธี 2: หาจาก text "Videos"
    if (!videosButton) {
      videosButton = findElementByText('button[role="tab"], button[role="radio"]', 'Videos');
    }

    // วิธี 3: หาจาก tab/radio buttons ที่มี text Videos
    if (!videosButton) {
      const radioButtons = document.querySelectorAll('button[role="tab"], button[role="radio"]');
      for (const btn of radioButtons) {
        if (btn.textContent.includes('Videos')) {
          videosButton = btn;
          break;
        }
      }
    }

    if (!videosButton) {
      log('ไม่พบปุ่ม Videos', 'error');
      return STATES.ERROR;
    }

    humanClick(videosButton);
    log('กดปุ่ม Videos แล้ว', 'success');

    await delay(DELAYS.AFTER_CLICK);
    return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
  }

  // ===== กดปุ่ม Images ก่อนเริ่ม flow =====
  async function handleVideoClickImage() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📸 Video Step 1: กดปุ่ม Images ก่อนเริ่ม', 'step');

    // ✅ ถ้าเป็น retry (retryCount > 0) ให้ซ่อน error elements ก่อน
    if (window._step3RetryCount > 0) {
      log('[Step3] 🧹 กำลังซ่อน error elements เก่าก่อน retry...', 'info');
      try {
        const errorLabels = document.querySelectorAll('*');
        let hiddenCount = 0;
        for (const el of errorLabels) {
          const directText = Array.from(el.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent.trim())
            .join(' ');

          if (directText && (directText.includes('Failed Generation') || directText.includes('generation failed'))) {
            el.style.display = 'none';
            el.style.visibility = 'hidden';
            hiddenCount++;
          }
        }
        if (hiddenCount > 0) {
          log(`[Step3] 🧹 ซ่อน error elements ${hiddenCount} อัน`, 'info');
        }
      } catch (cleanupError) {
        log('[Step3] ⚠️ ซ่อน error elements ไม่สำเร็จ (ไม่เป็นไร)', 'warning');
      }
    }

    log(`⏱️ รอ 2000ms ให้หน้าโหลด...`, 'info');
    await delay(2000); // รอให้หน้าโหลด

    // หา Images button (role="tab" หรือ role="radio") - text อาจเป็น "imageImages" เพราะมี <i>image</i> ข้างใน
    const buttons = document.querySelectorAll('button[role="tab"], button[role="radio"]');
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || '';
      log(`🔍 ตรวจสอบปุ่ม: "${text}"`, 'info');
      if (text.includes('Images')) {
        log('✅ พบปุ่ม Images - กำลังกด...', 'success');
        humanClick(btn);
        await delay(1500);
        log('✅ กดปุ่ม Images แล้ว - อยู่ที่ Images tab', 'success');
        return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
      }
    }

    log('⚠️ ไม่พบปุ่ม Images - ข้ามไป', 'warning');
    return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
  }

  async function handleVideoSelectFramesToVideo() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Video Step 2/8: เลือก Frames to Video จาก dropdown', 'step');
    sendStepStatus('เลือก Frames to Video', 'info');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // ========== Safety net: ลบ "Failed Generation" ที่ค้างอยู่ (กรณีมาจาก extend retry) ==========
    let deletedFailedInFTV = 0;
    const failedDivsFTV = [];
    const allDivsFTV = document.querySelectorAll('div');
    for (const div of allDivsFTV) {
      if (div.textContent?.trim().includes('Failed') && div.textContent?.trim().includes('Generation') && !div.querySelector('div')) {
        failedDivsFTV.push(div);
      }
    }
    for (const div of failedDivsFTV) {
      log(`🗑️ [Safety] พบ "Failed Generation" (${deletedFailedInFTV + 1}) - กำลังลบ...`, 'warning');
      // หา container ที่มีปุ่ม more_vert — ไล่ขึ้นไปทีละ parent (สูงสุด 10 ชั้น)
      let containerFTV = null;
      let moreBtnFTV = null;
      let nodeFTV = div;
      for (let up = 0; up < 10; up++) {
        nodeFTV = nodeFTV.parentElement;
        if (!nodeFTV) break;
        moreBtnFTV = Array.from(nodeFTV.querySelectorAll('button')).find(btn => {
          const icon = btn.querySelector('i');
          return icon && (icon.textContent?.trim() === 'more_vert' || icon.textContent?.trim() === 'more_horiz');
        });
        if (moreBtnFTV) {
          containerFTV = nodeFTV;
          break;
        }
      }
      if (!containerFTV || !moreBtnFTV) {
        log(`⚠️ [Safety] หา container/ปุ่ม more_vert ไม่เจอ — ข้ามไป`, 'warning');
        continue;
      }
      humanClick(moreBtnFTV);
      await delay(1000);
      const menuItemsFTV = document.querySelectorAll('div[role="menuitem"], li[role="menuitem"], [role="menu"] button');
      let deletedFTV = false;
      for (const item of menuItemsFTV) {
        if (item.textContent?.includes('Delete') || item.textContent?.includes('delete')) {
          humanClick(item);
          deletedFailedInFTV++;
          deletedFTV = true;
          log(`✅ [Safety] ลบ Failed Generation สำเร็จ (${deletedFailedInFTV})`, 'success');
          await delay(1500);
          break;
        }
      }
      if (!deletedFTV) {
        log(`⚠️ [Safety] กดปุ่ม more_vert แล้ว แต่หา Delete ไม่เจอ (พบ ${menuItemsFTV.length} items)`, 'warning');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await delay(500);
      }
    }
    if (deletedFailedInFTV > 0) {
      log(`🗑️ [Safety] ลบ Failed Generation ทั้งหมด ${deletedFailedInFTV} รายการก่อนสร้างวิดีโอใหม่`, 'info');
      await delay(1000);
    }

    // หาแท็บ "Frames" (UI ใหม่ใช้ button[role="tab"] แทน combobox dropdown)
    let framesTab = null;
    for (let attempt = 1; attempt <= 10; attempt++) {
      // วิธี 1: หาจาก button[role="tab"] ที่มี text "Frames" หรือ icon "crop_free"
      const tabs = document.querySelectorAll('button[role="tab"], button[role="radio"]');
      for (const tab of tabs) {
        const text = tab.textContent?.trim().toLowerCase() || '';
        const icon = tab.querySelector('i.google-symbols, i.material-icons');
        if (text.includes('frames') || icon?.textContent?.trim() === 'crop_free') {
          framesTab = tab;
          break;
        }
      }
      if (framesTab) {
        log('✅ พบแท็บ Frames', 'info');
        break;
      }

      // วิธี 2 (legacy): หาจาก combobox dropdown
      const dropdown = document.querySelector('button[role="combobox"]');
      if (dropdown) {
        log('✅ พบ dropdown แบบ combobox (legacy)', 'info');
        humanClick(dropdown);
        await delay(DELAYS.AFTER_CLICK + DELAYS.WAIT_FOR_DROPDOWN);
        const allElements = document.querySelectorAll('div, span, button');
        for (const el of allElements) {
          if (TRANSLATIONS.framesToVideo.includes(el.textContent?.trim())) {
            const parent = el.closest('[role="option"], [role="menuitem"], [data-radix-collection-item]');
            framesTab = parent || el;
            break;
          }
        }
        if (framesTab) break;
      }

      log(`⏳ รอแท็บ Frames... (${attempt}/10)`, 'info');
      await delay(1000);
    }

    if (framesTab) {
      const state = framesTab.getAttribute('data-state');
      if (state === 'active' || state === 'on') {
        log('✅ อยู่ที่แท็บ Frames อยู่แล้ว', 'info');
      } else {
        humanClick(framesTab);
        log('✅ กดแท็บ Frames แล้ว', 'success');
      }
    } else {
      log('⚠️ ไม่พบแท็บ Frames', 'warning');
    }

    await delay(DELAYS.AFTER_CLICK);

    return STATES.VIDEO_ADD_TO_PROMPT;
  }

  // ===== Mode 8s: เพิ่มรูปโดยไม่ใช้ Scenebuilder =====
  async function handleVideo8sAddImage() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    const isExtend = !!window._isExtendMode;
    const frameCount = isExtend ? 2 : 1;
    const frameLabels = ['Start Frame', 'End Frame'];
    if (isExtend) {
      log('📍 Video 8s Step: เพิ่มรูป Start Frame + End Frame (Upload × 2)', 'step');
    } else {
      log('📍 Video 8s Step 3/8: เพิ่มรูป (กด + → Upload)', 'step');
    }
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // ===== ดาวน์โหลดรูปจาก URL (ทำครั้งเดียว ใช้ซ้ำทุก frame) =====
    const imageUrl = ctx.lastPictureUrl || window._lastPictureUrl || S.automationData?.pictureUrl || S.automationData?.productImageUrl;
    if (!imageUrl) {
      log('❌ ไม่มี pictureUrl — ไม่สามารถ upload รูปได้', 'error');
      return STATES.ERROR;
    }
    // Save สำหรับ Step 4 (กรณี ctx/S เปลี่ยน)
    window._lastPictureUrl = imageUrl;
    ctx.lastPictureUrl = imageUrl;
    log(`📥 กำลังดาวน์โหลดรูปจาก: ${imageUrl.substring(0, 80)}...`, 'info');
    let imageFile = null;
    try {
      imageFile = await imageToFile(imageUrl, 'generated_image.png');
      if (!imageFile) throw new Error('imageToFile returned null');
      log(`✅ ดาวน์โหลดรูปสำเร็จ — ขนาด: ${(imageFile.size / 1024).toFixed(1)} KB`, 'success');
    } catch (err) {
      log(`❌ ดาวน์โหลดรูปไม่สำเร็จ: ${err.message}`, 'error');
      return STATES.ERROR;
    }

    // ===== Loop: Upload รูปสำหรับแต่ละ frame =====
    for (let frameIdx = 0; frameIdx < frameCount; frameIdx++) {
    if (isExtend) log(`━━━ 📌 ${frameLabels[frameIdx]} (${frameIdx + 1}/${frameCount}) ━━━`, 'step');

    // ===== 1. กดปุ่ม + (add) =====
    log('🔍 หาปุ่ม + (add) ...', 'info');
    let addBtn = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const icon = btn.querySelector('i.google-symbols, i.material-icons');
        if (icon && icon.textContent?.trim() === 'add') {
          addBtn = btn;
          break;
        }
      }
      if (!addBtn) {
        addBtn = document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID');
      }
      if (addBtn) break;
      log(`⏳ หาปุ่ม + ไม่เจอ (attempt ${attempt + 1}/10)`, 'info');
      await delay(1500);
    }

    if (!addBtn) {
      log('❌ หาปุ่ม + ไม่เจอ', 'error');
      return STATES.VIDEO_ADD_TO_PROMPT;
    }

    log('✅ พบปุ่ม + — กดเลย', 'success');
    humanClick(addBtn);

    // รอ dialog/menu ขึ้นมาก่อน
    log('⏳ รอ dialog ขึ้นมา...', 'info');
    await delay(5000);

    // ===== 2. กดปุ่ม Upload ใน dialog ที่เปิดขึ้นมา =====
    log('🔍 หาปุ่ม Upload ใน dialog ...', 'info');
    let uploadBtn = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      // หาปุ่ม Upload จากข้อความ
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        if (text === 'upload' || text.includes('upload')) {
          uploadBtn = btn;
          break;
        }
      }
      // หาจาก icon upload
      if (!uploadBtn) {
        for (const btn of allBtns) {
          const icon = btn.querySelector('i.google-symbols, i.material-icons');
          if (icon && (icon.textContent?.trim() === 'upload' || icon.textContent?.trim() === 'cloud_upload' || icon.textContent?.trim() === 'file_upload')) {
            uploadBtn = btn;
            break;
          }
        }
      }
      if (uploadBtn) break;
      log(`⏳ หาปุ่ม Upload ไม่เจอ (attempt ${attempt + 1}/15)`, 'info');
      await delay(2000);
    }

    if (!uploadBtn) {
      log('❌ ไม่พบปุ่ม Upload ใน dialog', 'error');
      return STATES.VIDEO_ADD_TO_PROMPT;
    }

    log('✅ พบปุ่ม Upload — กดเลย', 'success');
    humanClick(uploadBtn);

    // รอ file input area โหลดเสร็จ
    log('⏳ รอ Upload area พร้อม...', 'info');
    await delay(5000);

    // ===== 3. Set ไฟล์รูปใน file input (ใช้รูปที่ดาวน์โหลดไว้แล้ว) =====
    // หา file input
    log('🔍 หา file input ...', 'info');
    let fileInput = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const inputs = document.querySelectorAll('input[type="file"]');
      if (inputs.length > 0) {
        fileInput = inputs[inputs.length - 1];
        break;
      }
      log(`⏳ หา file input ไม่เจอ (attempt ${attempt + 1}/10)`, 'info');
      await delay(1000);
    }

    if (!fileInput) {
      log('❌ หา file input ไม่เจอ', 'error');
      return STATES.VIDEO_ADD_TO_PROMPT;
    }

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(imageFile);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    log('✅ Set ไฟล์รูปใน file input แล้ว', 'success');

    await delay(3000);

    // ===== 3. จัดการ "Crop your ingredient" dialog (ถ้ามี) =====
    let cropDialogFound = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const cropSaveBtn = Array.from(document.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('Crop and Save') || btn.textContent?.includes('Crop')
      );
      if (cropSaveBtn) {
        cropDialogFound = true;
        log('✅ พบ Crop dialog', 'success');
        break;
      }
      log(`⏳ รอ Crop dialog... (attempt ${attempt + 1}/10)`, 'info');
      await delay(1500);
    }

    if (cropDialogFound) {
      // เลือก Portrait จาก combobox
      log('🔍 เลือก Portrait ...', 'info');
      let cropCombobox = null;
      const cropSaveBtnForScope = Array.from(document.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('Crop and Save')
      );
      if (cropSaveBtnForScope) {
        let dialogContainer = cropSaveBtnForScope.closest('[role="dialog"]')
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
        const currentCropMode = cropCombobox.textContent?.trim().toLowerCase() || '';
        if (!currentCropMode.includes('portrait')) {
          humanClick(cropCombobox);
          await delay(1500);

          let portraitItem = null;
          const menuItems2 = document.querySelectorAll('div[role="menuitem"], div[role="option"], li[role="option"], [data-radix-collection-item]');
          for (const item of menuItems2) {
            if (item.textContent?.toLowerCase().includes('portrait')) {
              portraitItem = item;
              break;
            }
          }
          if (!portraitItem) {
            const allEls = document.querySelectorAll('div, li, button, span');
            for (const el of allEls) {
              if (el.children.length <= 2 && el.textContent?.trim() === 'Portrait') {
                portraitItem = el;
                break;
              }
            }
          }
          if (portraitItem) {
            humanClick(portraitItem);
            log('✅ เลือก "Portrait" แล้ว', 'success');
            await delay(2000);
          }
        } else {
          log('✅ อยู่ Portrait อยู่แล้ว', 'info');
        }
      }

      // กด "Crop and Save"
      let cropSaveBtn2 = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.textContent?.includes('Crop and Save')) {
            cropSaveBtn2 = btn;
            break;
          }
        }
        if (cropSaveBtn2) break;
        await delay(1000);
      }
      if (cropSaveBtn2) {
        humanClick(cropSaveBtn2);
        log('✅ กด "Crop and Save" แล้ว', 'success');
        await delay(5000);
      }
    } else {
      log('⚠️ ไม่พบ Crop dialog — อาจไม่ต้อง crop', 'warning');
    }

    // ===== 4. ตรวจสอบว่ารูปถูกเพิ่มเข้า timeline สำเร็จ =====
    log('⏳ ตรวจสอบว่ารูปถูกเพิ่มเข้า timeline...', 'info');
    let imageAdded = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      // วิธี 1: มี img ที่โหลดเสร็จใน area ใกล้ปุ่ม + (thumbnail ของ clip)
      const addCard = document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID');
      if (addCard) {
        const container = addCard.parentElement;
        if (container) {
          const clipImgs = container.querySelectorAll('img');
          const loaded = Array.from(clipImgs).filter(
            img => img.complete && img.naturalWidth > 30 && img.src && !img.src.startsWith('data:image/svg')
          );
          if (loaded.length > 0) {
            imageAdded = true;
            log(`✅ พบ thumbnail ใน timeline (${loaded.length} imgs)`, 'success');
            break;
          }
        }
      }

      // วิธี 2: Fallback — ตรวจ spinner หายไป + มี img loaded ในหน้า
      const spinners = document.querySelectorAll(
        'mat-spinner, mat-progress-spinner, [role="progressbar"]'
      );
      if (spinners.length === 0 && attempt >= 5) {
        const allImgs = document.querySelectorAll('img');
        const recentLoaded = Array.from(allImgs).filter(
          img => img.src && (img.src.startsWith('blob:') || img.src.includes('storage.googleapis'))
            && img.complete && img.naturalWidth > 50
        );
        if (recentLoaded.length > 0) {
          imageAdded = true;
          log(`✅ Fallback: พบรูป blob/storage loaded (${recentLoaded.length} imgs)`, 'success');
          break;
        }
      }

      log(`⏳ รอรูปเข้า timeline... (attempt ${attempt + 1}/20)`, 'info');
      await delay(2000);
    }

    if (!imageAdded) {
      log('⚠️ ตรวจไม่พบรูปใน timeline — รอเพิ่ม 10 วินาทีแล้วลองต่อ', 'warning');
      await delay(10000);
    }

    await delay(3000);

    if (isExtend && frameIdx === 0) {
      log(`✅ ${frameLabels[0]} เสร็จแล้ว — ไปต่อ ${frameLabels[1]}`, 'success');
    }
    } // end for frameIdx loop

    log('🎬 รูปพร้อมแล้ว — ไปใส่ Video Prompt', 'success');
    return STATES.VIDEO_FILL_PROMPT;
  }

  async function handleVideoAddToPrompt() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Video Step 3/8: ดาวน์โหลดรูป + Upload', 'step');
    sendStepStatus('ดาวน์โหลดรูป + Upload', 'info');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // ===== 0. Mode 16s only: กดแท็บ Videos + เปลี่ยนโหมด =====
    if (S.automationData.extendedMode) {
      // ===== 0. กดแท็บ "Videos" =====
      log('🔍 หาแท็บ "Videos" ...', 'info');
      let videosTab = null;

      // วิธี 1: button[role="tab"] หรือ button[role="radio"] ที่มีข้อความ "Videos"
      const radioBtns = document.querySelectorAll('button[role="tab"], button[role="radio"]');
      for (const btn of radioBtns) {
        if (btn.textContent?.trim().includes('Videos')) {
          videosTab = btn;
          log('พบแท็บจาก button[role="tab/radio"] + text "Videos"', 'info');
          break;
        }
      }

      // วิธี 2: class pattern sc-61287434
      if (!videosTab) {
        const classBtns = document.querySelectorAll('button[class*="sc-61287434"]');
        for (const btn of classBtns) {
          if (btn.textContent?.trim().includes('Videos')) {
            videosTab = btn;
            log('พบแท็บจาก class sc-61287434', 'info');
            break;
          }
        }
      }

      // วิธี 3: icon videocam
      if (!videosTab) {
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
          const icon = btn.querySelector('i.google-symbols');
          if (icon && icon.textContent?.trim() === 'videocam') {
            videosTab = btn;
            log('พบแท็บจาก icon videocam', 'info');
            break;
          }
        }
      }

      // วิธี 4: text exact match "Videos"
      if (!videosTab) {
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
          if (btn.textContent?.trim() === 'Videos' || btn.textContent?.trim().endsWith('Videos')) {
            videosTab = btn;
            log('พบแท็บจาก text exact match', 'info');
            break;
          }
        }
      }

      if (videosTab) {
        log('✅ พบแท็บ "Videos" — กดเลย', 'success');
        humanClick(videosTab);
        await delay(3000);
      } else {
        log('⚠️ หาแท็บ "Videos" ไม่เจอ — ลองต่อไป', 'warning');
      }

      // ===== 0.7. กดแท็บ "Frames" =====
      log('🔍 กดแท็บ "Frames" ...', 'info');
      let framesTab = null;
      // วิธี 1: หาจาก button[role="tab"] ที่มี text "Frames" หรือ icon "crop_free"
      const ftTabs = document.querySelectorAll('button[role="tab"], button[role="radio"]');
      for (const tab of ftTabs) {
        const text = tab.textContent?.trim().toLowerCase() || '';
        const icon = tab.querySelector('i.google-symbols, i.material-icons');
        if (text.includes('frames') || icon?.textContent?.trim() === 'crop_free') {
          framesTab = tab;
          break;
        }
      }
      // วิธี 2 (legacy): หาจาก combobox dropdown
      if (!framesTab) {
        const modeDropdown = document.querySelector('button[role="combobox"]');
        if (modeDropdown) {
          const currentModeText = modeDropdown.textContent?.trim().toLowerCase() || '';
          if (!currentModeText.includes('frames to video')) {
            humanClick(modeDropdown);
            await delay(2000);
            const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="option"], li[role="option"], [data-radix-collection-item]');
            for (const item of menuItems) {
              if (item.textContent?.toLowerCase().includes('frames to video')) {
                framesTab = item;
                break;
              }
            }
          } else {
            log('✅ อยู่โหมด "Frames to Video" อยู่แล้ว', 'info');
          }
        }
      }
      if (framesTab) {
        const state = framesTab.getAttribute('data-state');
        if (state === 'active' || state === 'on') {
          log('✅ อยู่ที่แท็บ Frames อยู่แล้ว', 'info');
        } else {
          humanClick(framesTab);
          log('✅ กดแท็บ Frames แล้ว', 'success');
          await delay(3000);
        }
      } else {
        log('⚠️ หาแท็บ Frames ไม่เจอ — ลองต่อไป', 'warning');
      }
    } else {
      log('📍 Mode 8s — ข้าม Scenebuilder/Arrange/Delete/Mode switch', 'info');
    }

    // ===== 1. ดาวน์โหลดรูปจาก pictureUrl (ใช้ Step 2 URL โดยตรงถ้ามี) =====
    const imageUrl = ctx.lastPictureUrl || window._lastPictureUrl || S.automationData?.pictureUrl || S.automationData?.productImageUrl;
    if (!imageUrl) {
      log('❌ ไม่มี pictureUrl — ไม่สามารถ upload รูปได้', 'error');
      return STATES.ERROR;
    }
    // Save สำหรับ Step 4 (กรณี ctx/S เปลี่ยน)
    window._lastPictureUrl = imageUrl;
    ctx.lastPictureUrl = imageUrl;

    log(`📥 กำลังดาวน์โหลดรูปจาก: ${imageUrl.substring(0, 80)}...`, 'info');
    let imageFile = null;
    try {
      imageFile = await imageToFile(imageUrl, 'generated_image.png');
      if (!imageFile) throw new Error('imageToFile returned null');
      log(`✅ ดาวน์โหลดรูปสำเร็จ — ขนาด: ${(imageFile.size / 1024).toFixed(1)} KB`, 'success');
    } catch (err) {
      log(`❌ ดาวน์โหลดรูปไม่สำเร็จ: ${err.message}`, 'error');
      return STATES.ERROR;
    }

    // ===== Loop: Upload รูปสำหรับแต่ละ frame (16s/Extend = 2 ครั้ง, 8s ปกติ = 1 ครั้ง) =====
    // Step 3 ของ 16s: S.automationData.extendedMode = true แต่ window._isExtendMode ยังไม่ set
    // Step 4 extend: window._isExtendMode = true
    const isExtendUpload = !!window._isExtendMode || !!S.automationData?.extendedMode;
    const uploadFrameCount = isExtendUpload ? 2 : 1;
    const uploadFrameLabels = ['Start Frame', 'End Frame'];
    if (isExtendUpload) {
      log('📌 Extend Mode: จะ upload รูป 2 ครั้ง (Start Frame + End Frame)', 'step');
    }

    for (let frameIdx = 0; frameIdx < uploadFrameCount; frameIdx++) {
    if (isExtendUpload) log(`━━━ 📌 ${uploadFrameLabels[frameIdx]} (${frameIdx + 1}/${uploadFrameCount}) ━━━`, 'step');

    // ===== 2. กดปุ่ม + (Add clip) =====
    log(`🔍 หาปุ่ม + (add) สำหรับ ${isExtendUpload ? uploadFrameLabels[frameIdx] : 'frame'} ...`, 'info');
    let addBtn = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      // วิธี 1: หา #PINHOLE_ADD_CLIP_CARD_ID (specific add clip card — ตรงเป้าที่สุด)
      addBtn = document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID');
      if (addBtn) {
        log('พบปุ่ม + จาก #PINHOLE_ADD_CLIP_CARD_ID', 'info');
        break;
      }

      // วิธี 2 (End Frame): หาจาก Swap button (swap_horiz) → End Frame + อยู่ถัดไป
      // DOM: [Start Frame +] [Swap ↔] [End Frame +]
      if (isExtendUpload && frameIdx > 0) {
        const swapBtns = document.querySelectorAll('button');
        for (const btn of swapBtns) {
          const icon = btn.querySelector('i.google-symbols, i.material-icons');
          if (icon && icon.textContent?.trim() === 'swap_horiz') {
            // End Frame + อยู่ใน nextElementSibling ของ Swap button
            const endFrameDiv = btn.nextElementSibling;
            if (endFrameDiv) {
              const endBtn = endFrameDiv.querySelector('button');
              if (endBtn) {
                addBtn = endBtn;
                log('พบปุ่ม End Frame + จาก swap_horiz landmark', 'info');
                break;
              }
            }
            // Fallback: หาปุ่ม add ใน parent container ที่มี swap_horiz
            const container = btn.parentElement;
            if (container) {
              const frameDivs = container.children;
              // End Frame = ตัวสุดท้ายใน container
              for (let ci = frameDivs.length - 1; ci >= 0; ci--) {
                const child = frameDivs[ci];
                if (child === btn) continue; // ข้าม Swap button
                const childBtn = child.querySelector ? child.querySelector('button') : null;
                const childIcon = childBtn?.querySelector('i.google-symbols, i.material-icons');
                if (childIcon && childIcon.textContent?.trim() === 'add') {
                  addBtn = childBtn;
                  log('พบปุ่ม End Frame + จาก container (last child)', 'info');
                  break;
                }
              }
            }
            break;
          }
        }
        if (addBtn) break;
      }

      // วิธี 3 (Start Frame / fallback): หาปุ่มที่มี icon "add"
      if (!addBtn) {
        // Start Frame: หาจาก Swap button → Start Frame + อยู่ก่อน Swap
        if (isExtendUpload && frameIdx === 0) {
          const swapBtns = document.querySelectorAll('button');
          for (const btn of swapBtns) {
            const icon = btn.querySelector('i.google-symbols, i.material-icons');
            if (icon && icon.textContent?.trim() === 'swap_horiz') {
              const startFrameDiv = btn.previousElementSibling;
              if (startFrameDiv) {
                const startBtn = startFrameDiv.querySelector('button');
                if (startBtn) {
                  addBtn = startBtn;
                  log('พบปุ่ม Start Frame + จาก swap_horiz landmark', 'info');
                  break;
                }
              }
              break;
            }
          }
          if (addBtn) break;
        }

        // Fallback: หาปุ่ม add ทั้งหมดแล้วเลือกตาม position
        const addBtns = [];
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
          const icon = btn.querySelector('i.google-symbols, i.material-icons');
          if (icon && icon.textContent?.trim() === 'add') {
            addBtns.push(btn);
          }
        }
        if (addBtns.length > 0) {
          addBtns.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
          if (isExtendUpload && frameIdx > 0 && addBtns.length > 1) {
            addBtn = addBtns[0]; // rightmost = End Frame
            log(`End Frame (fallback): เลือกปุ่มขวาสุดจาก ${addBtns.length} ปุ่ม`, 'info');
          } else {
            addBtn = addBtns[addBtns.length - 1]; // leftmost = Start Frame
            log(`Start Frame (fallback): เลือกปุ่มซ้ายสุดจาก ${addBtns.length} ปุ่ม`, 'info');
          }
          break;
        }
      }

      if (addBtn) break;
      log(`⏳ หาปุ่ม + ไม่เจอ (attempt ${attempt + 1}/15)`, 'info');
      await delay(1500);
    }

    if (!addBtn) {
      log('❌ หาปุ่ม + ไม่เจอ', 'error');
      return STATES.ERROR;
    }

    const btnRect = addBtn.getBoundingClientRect();
    log(`✅ พบปุ่ม + — กดเลย (position: left=${Math.round(btnRect.left)}, top=${Math.round(btnRect.top)})`, 'success');
    // กดหลายวิธีเผื่อ overlay div ดักคลิก
    humanClick(addBtn);
    const overlay = addBtn.querySelector('[data-type="button-overlay"]');
    if (overlay) humanClick(overlay);
    const iconEl = addBtn.querySelector('i');
    if (iconEl) humanClick(iconEl);
    addBtn.click();
    await delay(3000);

    // ===== 3. กดปุ่ม Upload =====
    // End Frame: Google AI Studio อาจใส่รูปให้อัตโนมัติหลังกด + (ไม่ต้อง Upload ซ้ำ)
    // ดังนั้น End Frame ลองหา Upload แค่ 3 รอบ — ถ้าไม่เจอ = รูปใส่ให้แล้ว → ข้ามไปเลย
    const isEndFrame = isExtendUpload && frameIdx > 0;
    const maxUploadAttempts = isEndFrame ? 3 : 15;
    log(`🔍 หาปุ่ม Upload ... (${isEndFrame ? 'End Frame — max 3 attempts' : 'max 15 attempts'})`, 'info');
    let uploadBtn = null;
    for (let attempt = 0; attempt < maxUploadAttempts; attempt++) {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const icon = btn.querySelector('i.google-symbols, i.material-icons, i.material-icons-outlined');
        if (icon && (icon.textContent?.trim() === 'upload' || icon.textContent?.trim() === 'upload_file')) {
          uploadBtn = btn;
          break;
        }
        if (btn.textContent?.trim().toLowerCase() === 'upload' || btn.textContent?.includes('Upload')) {
          uploadBtn = btn;
          break;
        }
      }
      if (uploadBtn) break;

      // Start Frame only: ถ้ายังไม่เจอ Upload ลอง Escape แล้วกดปุ่ม + ใหม่ (attempt 5 & 10)
      if (!isEndFrame && (attempt === 5 || attempt === 10)) {
        log('⚠️ Upload ไม่เจอ — ลอง Escape แล้วกดปุ่ม + ใหม่', 'warning');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await delay(2000);

        let retryAddBtn = document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID');
        if (!retryAddBtn) {
          const retryBtns = [];
          const allRetryBtns = document.querySelectorAll('button');
          for (const btn of allRetryBtns) {
            const icon = btn.querySelector('i.google-symbols, i.material-icons');
            if (icon && icon.textContent?.trim() === 'add') retryBtns.push(btn);
          }
          if (retryBtns.length > 0) retryAddBtn = retryBtns[retryBtns.length > 1 ? retryBtns.length - 1 : 0];
        }
        if (retryAddBtn) {
          log('🔄 กดปุ่ม + ใหม่', 'info');
          humanClick(retryAddBtn);
          const retryOverlay = retryAddBtn.querySelector('[data-type="button-overlay"]');
          if (retryOverlay) humanClick(retryOverlay);
          const retryIcon = retryAddBtn.querySelector('i');
          if (retryIcon) humanClick(retryIcon);
          retryAddBtn.click();
          await delay(3000);
        }
      }

      log(`⏳ หาปุ่ม Upload ไม่เจอ (attempt ${attempt + 1}/${maxUploadAttempts})`, 'info');
      await delay(1000);
    }

    if (!uploadBtn) {
      if (isEndFrame) {
        // End Frame: รูปถูกใส่ให้อัตโนมัติแล้ว → ข้าม Upload/Crop ไปเลย
        log('✅ End Frame: รูปถูกใส่ให้อัตโนมัติแล้ว — ข้าม Upload', 'success');
        continue; // ข้ามไปรอบถัดไปของ for loop (หรือจบ loop)
      }
      log('❌ หาปุ่ม Upload ไม่เจอหลัง retry หลายครั้ง', 'error');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(500);
      return STATES.ERROR;
    }

    log('✅ พบปุ่ม Upload — กดเลย', 'success');
    humanClick(uploadBtn);
    await delay(2000);

    // ===== 4. หา file input แล้ว set ไฟล์รูป =====
    log('🔍 หา file input ...', 'info');
    let fileInput = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const inputs = document.querySelectorAll('input[type="file"]');
      if (inputs.length > 0) {
        fileInput = inputs[inputs.length - 1];
        break;
      }
      log(`⏳ หา file input ไม่เจอ (attempt ${attempt + 1}/10)`, 'info');
      await delay(1000);
    }

    if (!fileInput) {
      log('❌ หา file input ไม่เจอ', 'error');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(500);
      return STATES.ERROR;
    }

    log('✅ พบ file input — กำลัง set ไฟล์รูป', 'success');

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(imageFile);
    fileInput.files = dataTransfer.files;

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));

    log('✅ Set ไฟล์รูปใน file input แล้ว — รอ Crop dialog', 'success');
    await delay(5000);

    // ===== 5. จัดการ "Crop your ingredient" dialog =====
    let cropDialogFound = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const cropSaveBtn = Array.from(document.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('Crop and Save') || btn.textContent?.includes('Crop')
      );
      if (cropSaveBtn) {
        cropDialogFound = true;
        log('✅ พบ Crop dialog', 'success');
        break;
      }
      log(`⏳ รอ Crop dialog... (attempt ${attempt + 1}/10)`, 'info');
      await delay(1500);
    }

    if (cropDialogFound) {
      // 5a. เลือก Portrait จาก combobox (ถ้ายังไม่ใช่ Portrait)
      log('🔍 เลือก Portrait ...', 'info');
      let cropCombobox = null;
      const cropSaveBtnForScope = Array.from(document.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('Crop and Save')
      );
      if (cropSaveBtnForScope) {
        let dialogContainer = cropSaveBtnForScope.closest('[role="dialog"]')
          || cropSaveBtnForScope.closest('mat-dialog-container')
          || cropSaveBtnForScope.closest('.cdk-overlay-pane')
          || cropSaveBtnForScope.parentElement?.parentElement?.parentElement?.parentElement;
        if (dialogContainer) {
          cropCombobox = dialogContainer.querySelector('button[role="combobox"]');
          log(`📍 หา combobox ภายใน dialog container: ${cropCombobox ? 'เจอ' : 'ไม่เจอ'}`, 'info');
        }
      }
      if (!cropCombobox) {
        cropCombobox = document.querySelector('button[role="combobox"]');
        log(`📍 Fallback หา combobox จากทั้งหน้า: ${cropCombobox ? 'เจอ' : 'ไม่เจอ'}`, 'info');
      }
      if (cropCombobox) {
        const currentCropMode = cropCombobox.textContent?.trim().toLowerCase() || '';
        if (!currentCropMode.includes('portrait')) {
          log('📋 กดเปิด dropdown เลือก Portrait...', 'info');
          humanClick(cropCombobox);
          await delay(1500);

          let portraitItem = null;
          const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="option"], li[role="option"], [data-radix-collection-item]');
          for (const item of menuItems) {
            if (item.textContent?.toLowerCase().includes('portrait')) {
              portraitItem = item;
              break;
            }
          }
          if (!portraitItem) {
            const allEls = document.querySelectorAll('div, li, button, span');
            for (const el of allEls) {
              if (el.children.length <= 2 && el.textContent?.trim() === 'Portrait') {
                portraitItem = el;
                break;
              }
            }
          }
          if (portraitItem) {
            humanClick(portraitItem);
            log('✅ เลือก "Portrait" แล้ว', 'success');
            await delay(2000);
          } else {
            log('⚠️ หา "Portrait" ไม่เจอ — ใช้ค่าปัจจุบัน', 'warning');
          }
        } else {
          log('✅ อยู่ Portrait อยู่แล้ว', 'info');
        }
      } else {
        log('⚠️ หา crop combobox ไม่เจอ — ข้ามไป', 'warning');
      }

      // 5b. กด "Crop and Save"
      log('🔍 หาปุ่ม "Crop and Save" ...', 'info');
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
        humanClick(cropSaveBtn);
        log('✅ กด "Crop and Save" แล้ว', 'success');
        await delay(5000);
      } else {
        log('⚠️ หาปุ่ม "Crop and Save" ไม่เจอ — ลองต่อไป', 'warning');
      }
    } else {
      log('⚠️ ไม่พบ Crop dialog — อาจไม่ต้อง crop (ลองต่อไป)', 'warning');
    }

    // ===== 6. รอรูปปรากฏ + โหลดเสร็จ =====
    log('⏳ รอรูปปรากฏและโหลดเสร็จ...', 'info');
    let imageFullyLoaded = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const allImgs = document.querySelectorAll('img');
      const removeBtn = findButtonByIcon('remove');

      const fullyLoadedImgs = Array.from(allImgs).filter(
        img => img.src && img.src.length > 50 && img.complete && img.naturalWidth > 50
      );

      const loadingSpinners = document.querySelectorAll(
        'mat-spinner, mat-progress-spinner, [role="progressbar"], .loading, .spinner'
      );
      const hasLoadingIndicator = loadingSpinners.length > 0;

      if (fullyLoadedImgs.length > 0 && !hasLoadingIndicator) {
        imageFullyLoaded = true;
        log(`✅ รูปโหลดเสร็จแล้ว (loaded:${fullyLoadedImgs.length})`, 'success');
        break;
      }

      if (removeBtn) {
        imageFullyLoaded = true;
        log('✅ พบ remove button (clip อยู่ใน timeline แล้ว) — รูปพร้อม', 'success');
        break;
      }

      log(`⏳ รอรูป... (attempt ${attempt + 1}/30)`, 'info');
      await delay(2000);
    }

    if (!imageFullyLoaded) {
      log('⚠️ รูปยังโหลดไม่เสร็จ — รอเพิ่มอีก 30 วินาทีแล้วลองต่อ', 'warning');
      await delay(30000);
    }

    // รอเพิ่มอีก 5 วินาทีให้ process รูปเสร็จ
    log('⏳ รอ process รูป...', 'info');
    await delay(5000);

    if (isExtendUpload && frameIdx === 0) {
      log(`✅ ${uploadFrameLabels[0]} เสร็จแล้ว — รอ 5 วินาทีให้ UI อัปเดตก่อนไปต่อ ${uploadFrameLabels[1]}`, 'success');
      await delay(5000);
    }
    } // end for frameIdx loop

    log('🎬 รูปพร้อมแล้ว — ไปเปิด Settings', 'success');
    return STATES.VIDEO_OPEN_SETTINGS;
  }

  async function handleVideoOpenSettings() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Video Step 4/7: เปิด Settings', 'step');
    sendStepStatus('เปิด Settings', 'info');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // Debug: หา icons ทั้งหมด
    const allIcons = document.querySelectorAll('i.material-icons-outlined, i.google-symbols, i.material-icons');
    log(`พบ icons ทั้งหมด: ${allIcons.length} อัน`, 'info');

    // หาปุ่ม Settings
    let settingsButton = null;

    // วิธี 1: หาจาก icon tune โดยตรง
    for (const icon of allIcons) {
      const iconText = icon.textContent?.trim() || '';
      if (iconText === 'tune') {
        log(`พบ icon tune ใน <${icon.tagName}> class="${icon.className}"`, 'info');
        settingsButton = icon.closest('button') || icon.parentElement?.closest('button');
        if (settingsButton) {
          log(`พบ Settings button จาก icon`, 'success');
          break;
        }
      }
    }

    // วิธี 2: ใช้ selector ที่ผู้ใช้ให้มา
    if (!settingsButton) {
      settingsButton = document.querySelector('button.sc-e8425ea6-0.gLXNUV');
      if (settingsButton) log('พบ Settings button จาก selector', 'info');
    }

    // วิธี 3: ใช้ findButtonByIcon
    if (!settingsButton) {
      settingsButton = findButtonByIcon('tune');
      if (settingsButton) log('พบ Settings button จาก findButtonByIcon', 'info');
    }

    if (!settingsButton) {
      log('ไม่พบปุ่ม Settings - ข้าม step นี้', 'warning');
      // ไม่ return ERROR เพื่อให้ flow ทำงานต่อ
      return STATES.VIDEO_FILL_PROMPT;
    }

    humanClick(settingsButton);
    log('กดปุ่ม Settings แล้ว!', 'success');

    // รอ popup เปิดให้เสร็จก่อน
    await delay(DELAYS.AFTER_CLICK);
    await delay(2000); // รอเพิ่มอีก 2 วินาที ให้ popup render เสร็จ
    log('รอ popup Settings เปิดเสร็จแล้ว', 'info');

    return STATES.VIDEO_SET_ASPECT_RATIO;
  }

  async function handleVideoSetAspectRatio() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Video Step 5/7: ตั้งค่า Aspect Ratio → Portrait (9:16)', 'step');

    await delay(500);

    // === วิธีใหม่: หา Portrait tab ===
    let portraitTab = null;
    const tabs = document.querySelectorAll('button[role="tab"], button[role="radio"]');
    for (const tab of tabs) {
      const text = tab.textContent?.trim().toLowerCase() || '';
      const icon = tab.querySelector('i.google-symbols, i.material-icons');
      const tabId = tab.id || '';
      if (text.includes('portrait') || icon?.textContent?.trim() === 'crop_9_16' || tabId.includes('PORTRAIT')) {
        portraitTab = tab;
        break;
      }
    }

    if (portraitTab) {
      const state = portraitTab.getAttribute('data-state') || '';
      if (state === 'active' || state === 'on' || portraitTab.getAttribute('aria-selected') === 'true') {
        log('Portrait ถูกเลือกแล้ว - ข้ามขั้นตอนนี้', 'success');
        await delay(500);
        return STATES.VIDEO_SET_OUTPUT_COUNT;
      }
      humanClick(portraitTab);
      log('กด Portrait tab แล้ว', 'success');
      await delay(DELAYS.AFTER_CLICK);
      return STATES.VIDEO_SET_OUTPUT_COUNT;
    }

    // === Fallback: combobox dropdown ===
    log('ไม่พบ Portrait tab - ลอง combobox fallback', 'info');
    const comboboxes = document.querySelectorAll('button[role="combobox"]');
    for (const btn of comboboxes) {
      const text = btn.textContent || '';
      if (matchesAny(text, TRANSLATIONS.landscape) || matchesAny(text, TRANSLATIONS.portrait) || text.includes('16:9') || text.includes('9:16')) {
        if (matchesAny(text, TRANSLATIONS.portrait)) {
          log('Portrait ถูกเลือกแล้ว (combobox)', 'success');
          await delay(500);
          return STATES.VIDEO_SET_OUTPUT_COUNT;
        }
        humanClick(btn);
        log('กด Aspect Ratio dropdown', 'info');
        await delay(800);
        const options = document.querySelectorAll('[role="option"], [role="menuitem"], div[class*="option"]');
        for (const opt of options) {
          if (matchesAny(opt.textContent || '', TRANSLATIONS.portrait)) {
            humanClick(opt);
            log('เลือก Portrait แล้ว!', 'success');
            break;
          }
        }
        break;
      }
    }

    await delay(DELAYS.AFTER_CLICK);
    return STATES.VIDEO_SET_OUTPUT_COUNT;
  }

  async function handleVideoSetOutputCount() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Video Step 5b/7: ตั้งค่า Outputs per prompt → 1', 'step');

    await delay(500);

    // === วิธีใหม่: หา tab "x1" ===
    let outputSet = false;
    const tabs = document.querySelectorAll('button[role="tab"], button[role="radio"]');
    for (const tab of tabs) {
      const text = tab.textContent?.trim() || '';
      const tabId = tab.id || '';
      if (text === 'x1' || tabId.includes('trigger-1')) {
        const st = tab.getAttribute('data-state') || '';
        if (st === 'active' || st === 'on' || tab.getAttribute('aria-selected') === 'true') {
          log('Output x1 ถูกเลือกแล้ว', 'success');
        } else {
          humanClick(tab);
          log('กด tab x1 แล้ว', 'success');
        }
        outputSet = true;
        break;
      }
    }

    // === Fallback: combobox dropdown ===
    if (!outputSet) {
      log('ไม่พบ tab x1 - ลอง combobox fallback', 'info');
      const comboboxes = document.querySelectorAll('button[role="combobox"]');
      let outputsBtn = null;
      for (const btn of comboboxes) {
        const labelSpan = btn.querySelector('span');
        if (labelSpan && matchesAny(labelSpan.textContent || '', TRANSLATIONS.outputsPerPrompt)) {
          outputsBtn = btn;
          break;
        }
      }
      if (!outputsBtn && comboboxes.length >= 2) {
        outputsBtn = comboboxes[1];
      }
      if (outputsBtn) {
        humanClick(outputsBtn);
        await delay(800);
        const popperWrapper = document.querySelector('[data-radix-popper-content-wrapper]');
        if (popperWrapper) {
          const allEls = popperWrapper.querySelectorAll('*');
          for (const el of allEls) {
            if (el.innerText?.trim() === '1' && el.children.length === 0) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                humanClick(el);
                log('เลือก 1 แล้ว (combobox)', 'success');
                break;
              }
            }
          }
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await delay(200);
      }
    }

    await delay(DELAYS.AFTER_CLICK);
    log('ตั้งค่า Settings เสร็จแล้ว!', 'success');

    // ถ้าอยู่ใน extend mode (Step 4) → ไปใส่ extend prompt แทน (ใช้ videoPrompt2/extendVideoPrompts)
    if (window._isExtendMode) {
      log('🔀 Extend mode: ไปใส่ Extend Prompt (videoPrompt2)', 'info');
      return STATES.EXTEND_FILL_PROMPT;
    }

    log('ไปใส่ Video Prompt (videoPrompt)', 'info');
    return STATES.VIDEO_FILL_PROMPT;
  }

  async function handleVideoFillPrompt() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Video Step 6/7: ใส่ Video Prompt', 'step');
    sendStepStatus('ใส่ Video Prompt', 'info');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // หา textarea
    let textarea = document.getElementById('PINHOLE_TEXT_AREA_ELEMENT_ID');
    if (!textarea) {
      textarea = document.querySelector('textarea[placeholder*="video"]');
    }
    if (!textarea) {
      textarea = document.querySelector('textarea[placeholder*="Generate"]');
    }
    if (!textarea) {
      textarea = document.querySelector('textarea');
    }

    if (!textarea) {
      log('ไม่พบ textarea สำหรับใส่ Video Prompt', 'error');
      return STATES.ERROR;
    }

    // Focus textarea
    textarea.focus();
    await delay(200);

    // Clear existing content
    textarea.value = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // ใส่ video prompt
    const prompt = S.automationData?.videoPrompt;
    if (!prompt) {
      log('❌ ไม่มี videoPrompt ใน automationData — ไม่สามารถสร้างวิดีโอได้', 'error');
      log(`📋 Debug: automationData keys = ${Object.keys(S.automationData || {}).join(', ')}`, 'info');
      return STATES.ERROR;
    }

    textarea.value = prompt;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    log(`ใส่ Video Prompt แล้ว (${prompt.length} ตัวอักษร)`, 'success');

    await delay(DELAYS.AFTER_CLICK);
    return STATES.VIDEO_CLICK_GENERATE;
  }

  async function handleVideoClickGenerate() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Video Step 7/7: กดปุ่ม Generate และรอวิดีโอ', 'step');
    sendStepStatus('กด Generate รอวิดีโอ...', 'info');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // หาปุ่ม Generate (ใช้ 5 วิธีเพื่อเพิ่มความน่าเชื่อถือ โดยเฉพาะตอน retry)
    log('[Generate Button] กำลังหาปุ่ม Generate...', 'info');

    // วิธี 1: CSS selector (อาจเปลี่ยนได้ถ้า React re-render)
    let generateButton = document.querySelector('button.sc-c177465c-1.gdArnN.sc-408537d4-2.gdXWm');
    if (generateButton) {
      log('[Generate Button] ✅ พบจาก CSS selector', 'info');
    }

    // วิธี 2: หาจาก icon arrow_forward
    if (!generateButton) {
      log('[Generate Button] CSS selector ล้มเหลว - ลองหาจาก icon', 'info');
      generateButton = findButtonByIcon('arrow_forward');
      if (generateButton) {
        log('[Generate Button] ✅ พบจาก arrow_forward icon', 'info');
      }
    }

    // วิธี 3: หาจาก text "Generate"
    if (!generateButton) {
      log('[Generate Button] Icon ล้มเหลว - ลองหาจาก text', 'info');
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.trim().toLowerCase().includes('generate')) {
          generateButton = btn;
          log('[Generate Button] ✅ พบจาก text "Generate"', 'info');
          break;
        }
      }
    }

    // วิธี 4: หาจาก aria-label
    if (!generateButton) {
      log('[Generate Button] Text ล้มเหลว - ลองหาจาก aria-label', 'info');
      generateButton = document.querySelector('button[aria-label*="Generate"]');
      if (generateButton) {
        log('[Generate Button] ✅ พบจาก aria-label', 'info');
      }
    }

    // วิธี 5: หา button ที่มี class ที่ขึ้นต้นด้วย "sc-" และอยู่ใกล้ๆ prompt textarea
    if (!generateButton) {
      log('[Generate Button] Aria-label ล้มเหลว - ลองหาจากตำแหน่งใกล้ prompt', 'info');
      const allButtons = document.querySelectorAll('button[class*="sc-"]');
      // หา button ที่อยู่หลัง textarea (ปกติ Generate อยู่ข้างๆ prompt box)
      for (const btn of allButtons) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 30) { // ขนาดพอสมควร
          generateButton = btn;
          log('[Generate Button] ✅ พบจากตำแหน่งและขนาด', 'info');
          break;
        }
      }
    }

    if (!generateButton) {
      log('❌ ไม่พบปุ่ม Generate (ลองทุกวิธีแล้ว)', 'error');
      log('[Debug] หน้าเว็บมี buttons ทั้งหมด: ' + document.querySelectorAll('button').length, 'error');

      // ส่ง error message ไปให้ React app รับทราบ
      try {
        chrome.runtime.sendMessage({
          type: 'VIDEO_GEN_ERROR',
          data: {
            rowId: S.savedVideoRowId || S.automationData?.rowId,
            error: 'ไม่พบปุ่ม Generate หลังจากลองใหม่ - UI อาจเปลี่ยนแปลง',
            skipRow: true // ข้ามแถวนี้ไป
          }
        });
      } catch (e) { }

      return STATES.ERROR;
    }

    // ⚠️ สำคัญ: จับ existing videos **ก่อน** กด Generate
    // เพื่อไม่ให้ video ที่โผล่มาเร็วจาก cache ถูกนับเป็น "video ใหม่" ผิดๆ
    const existingVideos = document.querySelectorAll('video[src*="storage.googleapis.com"]');
    const existingVideoIds = new Set(Array.from(existingVideos).map(v => extractVideoId(v.src)));
    const existingBlobVideos = document.querySelectorAll('video[src^="blob:"]');
    const existingBlobUrls = new Set(Array.from(existingBlobVideos).map(v => v.src));
    log(`📊 มี video เดิม: storage ${existingVideoIds.size} อัน, blob ${existingBlobUrls.size} อัน`, 'info');

    // ✅ NEW: Capture timestamp when generation starts
    window._generationStartTime = Date.now();
    log(`⏱️ เริ่มจับเวลา generation ที่ ${window._generationStartTime}`, 'info');

    // ✅ Snapshot error elements ที่มีอยู่แล้วก่อนกด Generate — ป้องกัน false positive จาก error เก่า
    const existingErrorElements = snapshotExistingErrors();
    log(`📸 Snapshot error elements เดิม: ${existingErrorElements.size} อัน`, 'info');

    humanClick(generateButton);
    log('กดปุ่ม Generate แล้ว!', 'success');

    // Polling แทน Blind wait - ตรวจหา video ทุก 5 วินาที
    const videoWaitTime = S.automationData?.videoGenDelay || DELAYS.GEN_VIDEO_WAIT;
    const POLL_INTERVAL = 5000; // 5 วินาที
    let elapsed = 0;
    let videoUrl = '';
    let hasSeenProgress = false; // ⚠️ ต้องเห็น progress > 0% ก่อนถึงจะยอมรับ video
    window._loggedNeverSeenProgress = false; // Reset flag สำหรับ fallback log

    log(`⏳ เริ่ม Polling หา video (Max ${videoWaitTime / 1000} วินาที, ตรวจทุก ${POLL_INTERVAL / 1000} วินาที)`, 'info');

    while (elapsed < videoWaitTime) {
      // 1. ดึง Progress % จาก UI ก่อน (ต้องเห็น progress ก่อนถึงจะยอมรับ video)
      let realProgress = null;
      let status = 'waiting';
      const allDivs = document.querySelectorAll('div');
      for (const div of allDivs) {
        const text = div.innerText?.trim();
        if (text && /^\d+%$/.test(text)) {
          realProgress = parseInt(text);
          status = 'generating';
          break;
        }
      }

      // ถ้าเจอ progress > 0% = กำลัง generate จริงๆ
      if (realProgress !== null && realProgress > 0) {
        if (!hasSeenProgress) {
          log(`🚀 เริ่ม generate จริงแล้ว! (progress: ${realProgress}%)`, 'info');
        }
        hasSeenProgress = true;

        // ✅ ตรวจจับ 99% ค้าง
        if (realProgress === 99) {
          if (stuckAt99StartTime === null) {
            stuckAt99StartTime = Date.now();
            log(`⚠️ Progress ถึง 99% - เริ่มจับเวลา...`, 'warning');
          } else {
            const stuckDuration = Date.now() - stuckAt99StartTime;
            log(`⏱️ 99% ค้างมาแล้ว ${(stuckDuration / 1000).toFixed(1)} วินาที (trigger ที่ ${STUCK_99_TIMEOUT / 1000} วินาที)`, 'info');
            if (stuckDuration >= STUCK_99_TIMEOUT) {
              log(`⚠️ 99% ค้างนานเกิน ${STUCK_99_TIMEOUT / 1000} วินาที! กำลังล้าง cookies...`, 'error');
              await handleStuckAt99();
              return STATES.IDLE; // หยุดการทำงาน รอ reload
            }
          }
        } else {
          // Reset ถ้า progress ไม่ใช่ 99%
          stuckAt99StartTime = null;
        }
      }

      // ✅ ข้ามการตรวจ error ถ้ามี video กำลัง generate อยู่ (progress > 0%)
      if (realProgress !== null && realProgress > 0) {
        // วิดีโอกำลัง generate → ไม่ต้องตรวจ error (อาจเป็น error เก่าค้างอยู่ในหน้า)
        // continue polling ปกติ
      } else {

      // ✅ ตรวจจับ "Couldn't generate image" error ระหว่าง polling (ส่ง snapshot เพื่อกรอง error เก่า)
      const midPollError = detectGenerationError(existingErrorElements);
      if (midPollError.hasError && midPollError.errorMessage.toLowerCase().includes("couldn't generate")) {
        log(`⚠️ ตรวจพบ "Couldn't generate image" - กำลังล้าง cookies และ retry...`, 'error');
        await handleStuckAt99(); // ใช้ logic เดียวกับ 99% ค้าง
        return STATES.IDLE;
      }

      // ✅ NEW: ตรวจจับ "High Demand" error - รอแล้ว retry
      if (midPollError.hasError && midPollError.errorMessage.toLowerCase().includes('high demand')) {
        window._highDemandRetryCount = (window._highDemandRetryCount || 0) + 1;
        log(`⚠️ [Step3] Server High Demand! (retry ${window._highDemandRetryCount}/5)`, 'warning');
        try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: `Server High Demand (retry ${window._highDemandRetryCount}/5)`, logType: 'warning' } }); } catch(e) {}

        if (window._highDemandRetryCount >= 5) {
          log(`❌ [Step3] High Demand retry 5 ครั้งแล้ว - ข้ามแถวนี้`, 'error');
          window._highDemandRetryCount = 0;
          try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: 'High Demand retry 5 ครั้งแล้ว - ข้ามแถวนี้', logType: 'error' } }); } catch(e) {}
          return STATES.ERROR;
        }

        // ปิด error popup/toast (ถ้ามี)
        const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                          document.querySelector('button[aria-label="Close"]');
        if (dismissBtn) {
          dismissBtn.click();
          await delay(500);
        }

        // รอ 2-3 นาทีแล้ว retry (สุ่ม 120-180 วินาที)
        const waitTime = 120000 + Math.random() * 60000;
        log(`⏳ [Step3] รอ ${Math.round(waitTime/1000)} วินาที ก่อน retry...`, 'info');
        try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: `รอ ${Math.round(waitTime/1000)} วิ ก่อน retry...`, logType: 'info' } }); } catch(e) {}
        await delay(waitTime);

        // กลับไปเริ่ม retry ตั้งแต่ Step 1/8
        log(`🔄 [Step3] กลับไป retry ตั้งแต่ Video Step 1/8...`, 'info');
        return STATES.VIDEO_SELECT_MODE;
      }

      // ✅ ตรวจจับ "violate our policies" - ข้ามแถวเลย (prompt เป็นตัวปัญหา retry ไม่ช่วย)
      if (midPollError.hasError && midPollError.errorMessage.toLowerCase().includes('violate our policies')) {
        log(`🚫 [Step3] Policy Violation: "${midPollError.errorMessage}" - ข้ามแถวนี้`, 'error');
        try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: 'Policy Violation - ข้ามแถวนี้', logType: 'error' } }); } catch(e) {}

        const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                          document.querySelector('button[aria-label="Close"]');
        if (dismissBtn) {
          dismissBtn.click();
          await delay(500);
        }

        return STATES.ERROR;
      }

      // ✅ ตรวจจับ "Failed Generation" error ทั่วไป - retry
      if (midPollError.hasError) {
        window._genFailedRetryCount = (window._genFailedRetryCount || 0) + 1;
        log(`⚠️ [Step3] Generation Failed: "${midPollError.errorMessage}" (retry ${window._genFailedRetryCount}/5)`, 'warning');
        try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: `Generation Failed (retry ${window._genFailedRetryCount}/5)`, logType: 'warning' } }); } catch(e) {}

        if (window._genFailedRetryCount >= 5) {
          log(`❌ [Step3] Generation failed retry 5 ครั้งแล้ว - ข้ามแถวนี้`, 'error');
          window._genFailedRetryCount = 0;
          try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: 'Generation failed 5 ครั้งแล้ว - ข้ามแถวนี้', logType: 'error' } }); } catch(e) {}
          return STATES.ERROR;
        }

        // ปิด error popup/toast (ถ้ามี)
        const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                          document.querySelector('button[aria-label="Close"]');
        if (dismissBtn) {
          dismissBtn.click();
          await delay(500);
        }

        // รอ 3 วินาทีแล้ว retry ตั้งแต่ Step 1/8
        await delay(3000);
        log(`🔄 [Step3] กลับไป retry ตั้งแต่ Video Step 1/8...`, 'info');
        return STATES.VIDEO_SELECT_MODE;
      }

      } // end else (ไม่มี video กำลัง generate)

      // 2. Check for new video element - ต้องรอ progress หายไปก่อน!
      const storageVideos = document.querySelectorAll('video[src*="storage.googleapis.com"]');
      const blobVideos = document.querySelectorAll('video[src^="blob:"]');

      // หา video ใหม่ที่ไม่เคยมีมาก่อน (เปรียบเทียบด้วย Video ID)
      // ยอมรับเมื่อ:
      //    1. เคยเห็น progress > 0% แล้ว progress หายไป (generation เสร็จ)
      //    2. หรือ ไม่เคยเห็น progress เลย แต่รอนานเกิน 60 วินาที (fallback กรณี UI ไม่แสดง progress)
      const progressGone = hasSeenProgress && realProgress === null;
      const neverSeenProgressFallback = !hasSeenProgress && elapsed >= 60000 && realProgress === null;
      if (progressGone || neverSeenProgressFallback) {
        if (neverSeenProgressFallback && !window._loggedNeverSeenProgress) {
          log(`[Step3] ⚠️ ไม่เคยเห็น progress % หลังรอ ${elapsed / 1000} วินาที — ตรวจหา video โดยตรง`, 'warning');
          window._loggedNeverSeenProgress = true;
        }
        // ✅ Hybrid Detection: ตรวจทั้ง video และ error พร้อมกัน

        // ✅ 1. ตรวจ storage video ก่อน
        log(`[Step3] 📊 พบ storage: ${storageVideos.length}, blob: ${blobVideos.length}, existing storage: ${existingVideoIds.size}, existing blob: ${existingBlobUrls.size}`, 'info');
        log(`[Step3] 📊 Global tracking has ${window._allSeenVideoIds.size} videos`, 'info');

        for (const video of storageVideos) {
          const videoId = extractVideoId(video.src);

          // ✅ CHANGED: Check both local and global video ID sets
          const isInExisting = existingVideoIds.has(videoId);
          const isInGlobalSeen = window._allSeenVideoIds.has(videoId);

          // 🔍 DEBUG: Log video check
          log(`[Step3] 🔍 Checking video ID: ${videoId.substring(0, 8)}... | inExisting: ${isInExisting}, inGlobal: ${isInGlobalSeen}`, 'info');

          // 🔍 DEBUG: Skip video from previous row
          if (isInGlobalSeen) {
            log(`[Step3] ⏭️ Skip video from previous row: ${videoId}`, 'warning');
            continue;
          }

          if (video.src && !isInExisting && !isInGlobalSeen) {
            // ✅ NEW: Validate video age - skip if appeared too quickly
            const videoAge = Date.now() - (window._generationStartTime || Date.now());
            if (videoAge < 1000) {
              log(`[Step3] ⏭️ Skip video (too fast): ${videoId.substring(0, 8)}... (${videoAge}ms)`, 'warning');
              continue; // Skip this video, check next one
            }

            // ✅ Add to global tracking BEFORE using it
            window._allSeenVideoIds.add(videoId);
            log(`[Step3] ✅ Added to global tracking: ${videoId}`, 'info');
            log(`[Step3] 📊 Global tracking now has: ${window._allSeenVideoIds.size} videos`, 'info');

            videoUrl = video.src;
            log(`[Step3] ✅ Found new video (storage): ${videoId} (age: ${(videoAge / 1000).toFixed(1)}s)`, 'success');
            break;
          }
        }

        // ✅ 1.5. Fallback: blob video (Scenebuilder อาจใช้ blob URL แทน storage)
        if (!videoUrl) {
          let largestVideo = null;
          let largestSize = 0;

          for (const video of blobVideos) {
            if (existingBlobUrls.has(video.src)) continue; // ข้าม blob เดิม
            const rect = video.getBoundingClientRect();
            const size = rect.width * rect.height;
            if (size > largestSize && size > 10000) {
              largestSize = size;
              largestVideo = video;
            }
          }

          // Fallback: ถ้าไม่เจอ video ใหญ่พอ แต่มี blob video ใหม่ → ใช้ตัวแรก
          if (!largestVideo) {
            for (const video of blobVideos) {
              if (!existingBlobUrls.has(video.src)) {
                largestVideo = video;
                log(`[Step3] ⚠️ Fallback: ใช้ blob video ตัวแรกที่ใหม่`, 'info');
                break;
              }
            }
          }

          if (largestVideo) {
            videoUrl = largestVideo.src;
            log(`[Step3] ✅ Found new video (blob): ${Math.round(largestSize)} px`, 'success');
          }
        }

        // ✅ 2. ตรวจ error (ส่ง snapshot เพื่อกรอง error เก่า)
        const errorCheck = detectGenerationError(existingErrorElements);

        // ✅ 3. ตัดสินใจด้วย Hybrid Logic
        if (videoUrl) {
          // ✅ มี video ใหม่ → สำเร็จ (ignore error ถ้ามี)
          if (errorCheck.hasError) {
            log(`[Step3] ⚠️ Video สำเร็จแต่มี error label (ignore): ${errorCheck.errorMessage}`, 'warning');
          }
          log(`[Step3] ✅ Video generation successful!`, 'success');
          sendStepStatus('Video generation สำเร็จ!', 'success');
          window._highDemandRetryCount = 0;  // Reset high demand counter
          window._audioFailedRetryCount = 0;  // Reset audio failed counter
          // videoUrl will be sent outside this block (line 2210+)
        } else {
          // ❌ ไม่มี video
          if (errorCheck.hasError) {
            const errorMsg = errorCheck.errorMessage.toLowerCase();

            // ✅ Special handling for "Audio generation failed" - retry with Veo 3.1 compatible prompt
            if (errorMsg.includes('audio generation failed') ||
                (errorMsg.includes('generation failed') && errorMsg.includes('different prompt'))) {
              window._audioFailedRetryCount = (window._audioFailedRetryCount || 0) + 1;
              log(`[Step3] ⚠️ Audio generation failed (retry ${window._audioFailedRetryCount}/3) - แก้ไข prompt ให้เข้ากับ Veo 3.1...`, 'warning');
              try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: `Audio generation failed (retry ${window._audioFailedRetryCount}/3) - แก้ไข prompt...`, logType: 'warning' } }); } catch(e) {}

              // ถ้า retry 3 ครั้งแล้ว ให้ข้ามแถวนี้
              if (window._audioFailedRetryCount > 3) {
                log('[Step3] ❌ Audio generation failed retry 3 ครั้งแล้ว - ข้ามแถวนี้', 'error');
                window._audioFailedRetryCount = 0;
                try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: 'Audio failed 3 ครั้งแล้ว - ข้ามแถวนี้', logType: 'error' } }); } catch(e) {}
                return STATES.ERROR;
              }

              // 1. ปิด error popup/toast (ถ้ามี)
              const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                                 document.querySelector('button[aria-label="Close"]') ||
                                 document.querySelector('[data-sonner-toaster] button');
              if (dismissBtn) {
                dismissBtn.click();
                await delay(500);
                log('[Step3] ปิด error popup แล้ว', 'info');
              }

              // 2. แก้ไข prompt ให้เข้ากับ Veo 3.1 (ทำให้เรียบง่ายขึ้น)
              if (S.automationData?.videoPrompt) {
                let prompt = S.automationData.videoPrompt;

                // วิธีแก้ไข prompt ตามลำดับ retry
                if (window._audioFailedRetryCount === 1) {
                  // Retry 1: ลบ emoji และอักขระพิเศษ
                  prompt = prompt.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');  // Remove emojis
                  prompt = prompt.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s.,!?'"()-]/g, '');  // Keep only Thai, English, numbers, basic punctuation
                  log(`[Step3] 🔄 Retry 1: ลบ emoji และอักขระพิเศษ`, 'info');
                } else if (window._audioFailedRetryCount === 2) {
                  // Retry 2: ลดความยาว + ทำให้เรียบง่ายขึ้น
                  prompt = prompt.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
                  prompt = prompt.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s.,!?'"()-]/g, '');
                  // ตัดให้สั้นลง (เหลือ 80% ของความยาวเดิม)
                  if (prompt.length > 100) {
                    prompt = prompt.substring(0, Math.floor(prompt.length * 0.8));
                    // ตัดที่ประโยคสุดท้ายที่สมบูรณ์
                    const lastPeriod = Math.max(prompt.lastIndexOf('.'), prompt.lastIndexOf('ค่ะ'), prompt.lastIndexOf('ครับ'));
                    if (lastPeriod > prompt.length * 0.5) {
                      prompt = prompt.substring(0, lastPeriod + 1);
                    }
                  }
                  log(`[Step3] 🔄 Retry 2: ลดความยาว + ทำให้เรียบง่ายขึ้น`, 'info');
                } else {
                  // Retry 3: ใช้ prompt พื้นฐานสุด
                  prompt = 'พูดแนะนำสินค้า อธิบายจุดเด่น';
                  log(`[Step3] 🔄 Retry 3: ใช้ prompt พื้นฐาน`, 'info');
                }

                S.automationData.videoPrompt = prompt;
                log(`[Step3] 📝 Prompt ใหม่: ${prompt.substring(0, 50)}...`, 'info');
              }

              // 3. รอสักครู่แล้วกลับไปใส่ prompt ใหม่
              await delay(2000);
              return STATES.VIDEO_FILL_PROMPT;
            }

            // ✅ Special handling for "third-party content providers" — ลิขสิทธิ์จากรูปภาพ ไม่ retry (แก้ prompt ไม่ช่วย)
            if (errorMsg.includes('third-party content providers') || errorMsg.includes('third-party content')) {
              log('[Step3] ⚠️ Google ตรวจพบลิขสิทธิ์บุคคลที่สาม (third-party content) — ข้ามแถวนี้ ลองเปลี่ยนรูปสินค้าที่ไม่มีโลโก้แบรนด์เด่นชัด', 'error');
              try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: 'ลิขสิทธิ์บุคคลที่สาม - ข้ามแถวนี้', logType: 'error' } }); } catch(e) {}

              // ปิด error popup
              const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                                 document.querySelector('button[aria-label="Close"]') ||
                                 document.querySelector('[data-sonner-toaster] button');
              if (dismissBtn) { dismissBtn.click(); await delay(500); }

              try {
                chrome.runtime.sendMessage({
                  type: 'VIDEO_GEN_COMPLETE',
                  success: false,
                  rowId: S.savedVideoRowId || S.automationData?.rowId,
                  error: 'ลิขสิทธิ์บุคคลที่สาม (third-party content) — ลองเปลี่ยนรูปสินค้าที่ไม่มีโลโก้แบรนด์'
                });
              } catch (e) { }

              S.isRunning = false;
              return STATES.IDLE;
            }

            // ✅ Special handling for "prominent people" policy violation - retry with anti-celebrity prompt
            if (errorMsg.includes('might violate') || errorMsg.includes('prominent people') || errorMsg.includes('policies')) {
              log('[Step3] ⚠️ Policy violation (prominent people) - จะลองใหม่ด้วย prompt ที่แก้ไข...', 'warning');
              try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: 'Policy violation (prominent people) - retry...', logType: 'warning' } }); } catch(e) {}

              // 1. ปิด error popup/toast (ถ้ามี)
              const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                                 document.querySelector('button[aria-label="Close"]') ||
                                 document.querySelector('[data-sonner-toaster] button');
              if (dismissBtn) {
                dismissBtn.click();
                await delay(500);
                log('[Step3] ปิด error popup แล้ว', 'info');
              }

              // 2. เพิ่มข้อความป้องกัน prominent people ใน prompt
              if (S.automationData?.videoPrompt) {
                // Track retry count for this specific error
                window._prominentPeopleRetryCount = (window._prominentPeopleRetryCount || 0) + 1;

                if (window._prominentPeopleRetryCount > 3) {
                  log('[Step3] ❌ Prominent people error retry 3 ครั้งแล้ว - ข้ามแถวนี้', 'error');
                  try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: 'Prominent people retry 3 ครั้งแล้ว - ข้ามแถวนี้', logType: 'error' } }); } catch(e) {}
                  window._prominentPeopleRetryCount = 0;

                  try {
                    chrome.runtime.sendMessage({
                      type: 'VIDEO_GEN_COMPLETE',
                      success: false,
                      rowId: S.savedVideoRowId || S.automationData?.rowId,
                      error: 'Policy violation: prominent people (failed 3 retries)'
                    });
                  } catch (e) { }

                  S.isRunning = false;
                  return STATES.IDLE;
                }

                // เพิ่มข้อความป้องกัน
                const antiCelebrityPhrases = [
                  '\\n\\nIMPORTANT: The character must be a completely original, fictional person. DO NOT generate any real celebrity, public figure, or famous person.',
                  '\\n\\nCRITICAL: Create a unique fictional character with no resemblance to any real person, celebrity, or public figure.',
                  '\\n\\nMANDATORY: This character must be 100% original and fictional. Avoid any features that could resemble celebrities or famous people.'
                ];

                const phraseIndex = (window._prominentPeopleRetryCount - 1) % antiCelebrityPhrases.length;
                const antiCelebrityPhrase = antiCelebrityPhrases[phraseIndex];

                // ลบ anti-celebrity phrase เก่าออก (ถ้ามี)
                let basePrompt = S.automationData.videoPrompt;
                for (const phrase of antiCelebrityPhrases) {
                  basePrompt = basePrompt.replace(phrase, '');
                }

                S.automationData.videoPrompt = basePrompt + antiCelebrityPhrase;
                log(`[Step3] 🔄 เพิ่มข้อความป้องกัน prominent people (ครั้งที่ ${window._prominentPeopleRetryCount}/3)`, 'info');
              }

              // 3. กลับไปใส่ prompt ใหม่แล้ว generate อีกครั้ง
              await delay(1000);
              return STATES.VIDEO_FILL_PROMPT;
            }

            // ❌ มี error อื่น + ไม่มี video → ส่งกลับ React
            log('[Step3] ❌ Error detected (no video): ' + errorCheck.errorMessage, 'error');
            try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: S.savedVideoRowId, message: 'Error: ' + (errorCheck.errorMessage || '').substring(0, 80), logType: 'error' } }); } catch(e) {}

            // ส่ง error กลับไป React เพื่อให้ React retry
            try {
              chrome.runtime.sendMessage({
                type: 'VIDEO_GEN_COMPLETE',
                success: false,
                rowId: S.savedVideoRowId || S.automationData?.rowId,
                error: errorCheck.errorMessage
              });
            } catch (e) { }

            // หยุดการทำงาน รอ React retry ใหม่
            S.isRunning = false;
            return STATES.IDLE;
          }
          // else: ⏳ ไม่มี error + ไม่มี video → Continue polling (do nothing)
        }
      }

      if (videoUrl) {
        log(`🎉 Video generation เสร็จใน ${elapsed / 1000} วินาที (เร็วกว่า max ${(videoWaitTime - elapsed) / 1000} วินาที)`, 'success');
        // ✅ Reset 99% stuck retry count เมื่อสำเร็จ
        chrome.storage.local.set({ google_flow_99_stuck_retry: 0 }).catch(() => {});
        stuckAt99StartTime = null;
        break; // พบ video ใหม่ = เสร็จ!
      }

      // ✅ REMOVED: Error check moved inside progressGone block above (line 2035)
      // This prevents false positives from detecting old "Failed Generation" labels
      // while video is still generating successfully

      // 3. Send progress update to React app (ใช้ realProgress ถ้ามี)
      const progress = realProgress !== null ? realProgress : Math.min(Math.round((elapsed / videoWaitTime) * 100), 99);
      try {
        chrome.runtime.sendMessage({
          type: 'VIDEO_GEN_PROGRESS',
          data: {
            rowId: S.savedVideoRowId || S.automationData?.rowId,
            progress: progress,
            elapsed: elapsed / 1000,
            maxWait: videoWaitTime / 1000,
            status: status,
            step: 'Step3'
          }
        });
        // ✅ REMOVED: Redundant log - React app already logs VIDEO_GEN_PROGRESS
        // Removing this reduces log volume by ~50% and eliminates duplicate messages
        // const progressSource = realProgress !== null ? 'UI' : 'calc';
        // log(`[Step3] 📊 ${progress}% [${progressSource}] - ${status}`, 'info');
      } catch (e) {
        // Side panel might be closed, continue anyway
      }

      // 5. Wait and continue polling
      await delay(POLL_INTERVAL);
      elapsed += POLL_INTERVAL;
    }

    // ถ้าหมดเวลาแล้วยังไม่เจอ video ใหม่ ลองหาจาก video element ทั้งหมด (fallback)
    // ⚠️ แก้บัค: ต้องเช็คว่าเป็น video ใหม่ด้วย ไม่ใช่หยิบ video เก่ามา
    if (!videoUrl) {
      log('⚠️ หมดเวลา polling - ลองหา video ใหม่จาก elements ทั้งหมด...', 'warning');
      const allVideos = document.querySelectorAll('video[src]');
      for (const video of allVideos) {
        if (video.src && video.src.includes('storage.googleapis.com')) {
          const videoId = extractVideoId(video.src);
          // ต้องเป็น video ใหม่ที่ไม่มีใน existingVideoIds
          if (!existingVideoIds.has(videoId)) {
            videoUrl = video.src;
            log(`พบ Video ใหม่จาก fallback! ID: ${videoId}`, 'success');
            break;
          }
        }
      }
      // ถ้ายังไม่เจอ video ใหม่ = หมดเวลาจริงๆ
      if (!videoUrl) {
        log('❌ หมดเวลา polling และไม่พบ video ใหม่', 'error');
      }
    }

    // ส่ง videoUrl กลับไปให้ background script (Step 4 จะดาวน์โหลดเอง)
    if (videoUrl) {
      log('ส่ง Video URL กลับไปอัพเดทตาราง...', 'info');

      try {
        // ✅ FIX: Use S.savedVideoRowId to prevent race condition when new scene starts
        const rowIdToSend = S.savedVideoRowId || S.automationData?.rowId;
        log(`📤 Sending VIDEO_URL_RESULT with rowId: ${rowIdToSend}`, 'info');
        chrome.runtime.sendMessage({
          type: 'VIDEO_URL_RESULT',
          data: {
            rowId: rowIdToSend,
            videoUrl: videoUrl
          }
        });
        log('✅ ส่ง Video URL สำเร็จ - จบ Step 3', 'success');
      } catch (e) {
        log('ไม่สามารถส่ง Video URL ได้: ' + e.message, 'warning');
      }
    } else {
      log('ไม่พบ URL วิดีโอที่ generate', 'warning');
    }

    // ตรวจสอบว่าเปิด Extended Mode หรือไม่ — ถ้าเปิด ให้ auto-extend ต่อเลย (ไม่ต้องรอ React ส่ง START_EXTEND_VIDEO)
    // เพราะการ navigate tab ใหม่จะทำลาย page state ที่ extend flow ต้องใช้
    log(`🔍 Debug: extendedMode=${S.automationData?.extendedMode}, videoPrompt2=${S.automationData?.videoPrompt2 ? 'มี (' + S.automationData.videoPrompt2.length + ' chars)' : 'ไม่มี'}, extendVideoPrompts=${S.automationData?.extendVideoPrompts?.length || 0}`, 'info');

    if (S.automationData?.extendedMode && (S.automationData?.videoPrompt2 || S.automationData?.extendVideoPrompts?.length > 0)) {
      // เก็บ video URL ที่เพิ่ง generate ไว้ เพื่อให้ Step 4.4 เลือก video ถูกตัว
      window._latestGeneratedVideoUrl = videoUrl || null;
      log(`🔖 เก็บ video URL สำหรับ extend: ${window._latestGeneratedVideoUrl ? window._latestGeneratedVideoUrl.substring(0, 80) + '...' : 'ไม่มี'}`, 'info');
      // Ensure pictureUrl persists สำหรับ Step 4
      const _picUrl = ctx.lastPictureUrl || window._lastPictureUrl || S.automationData?.pictureUrl || S.automationData?.productImageUrl;
      if (_picUrl) {
        window._lastPictureUrl = _picUrl;
        ctx.lastPictureUrl = _picUrl;
      }
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
      log('🎬 Extended Mode: เริ่ม Extend Loop (9-step Config Dropdown)', 'step');
      return STATES.OPEN_CONFIG_DROPDOWN;
    }

    log('รอครบแล้ว - จบ Step 3 (ไม่มี Extended หรือ videoPrompt2)', 'success');

    return STATES.DONE;
  }

  // ========== Step 4: Extend Video Handlers (Flow ใหม่ - ล้าง SceneBuilder ก่อน) ==========

  // Step 4.0: กดแท็บ "Videos" (เริ่มต้น Extend)
  async function handleExtendClickScenebuilder() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.0: กดแท็บ "Videos"', 'step');

    // Reset retry counters เมื่อเริ่ม Extend ใหม่ (ไม่ใช่ retry)
    window._extendRetryCount = 0;
    window._progressGoneNoVideoCount = 0;

    await delay(DELAYS.BETWEEN_STEPS);

    // หาแท็บ Videos จากหลาย selectors
    let videosTab = null;

    // 1. button[role="tab"] หรือ button[role="radio"] ที่มีข้อความ "Videos"
    const radioBtns = document.querySelectorAll('button[role="tab"], button[role="radio"]');
    for (const btn of radioBtns) {
      if (btn.textContent?.trim().includes('Videos')) {
        videosTab = btn;
        log('พบแท็บจาก button[role="tab/radio"] + text "Videos"', 'info');
        break;
      }
    }

    // 2. class pattern sc-61287434
    if (!videosTab) {
      const classBtns = document.querySelectorAll('button[class*="sc-61287434"]');
      for (const btn of classBtns) {
        if (btn.textContent?.trim().includes('Videos')) {
          videosTab = btn;
          log('พบแท็บจาก class sc-61287434', 'info');
          break;
        }
      }
    }

    // 3. icon videocam
    if (!videosTab) {
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const icon = btn.querySelector('i.google-symbols');
        if (icon && icon.textContent?.trim() === 'videocam') {
          videosTab = btn;
          log('พบแท็บจาก icon videocam', 'info');
          break;
        }
      }
    }

    // 4. text exact match "Videos"
    if (!videosTab) {
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        if (btn.textContent?.trim() === 'Videos' || btn.textContent?.trim().endsWith('Videos')) {
          videosTab = btn;
          log('พบแท็บจาก text exact match', 'info');
          break;
        }
      }
    }

    // 5. waitForElement fallback (รอ 5 วินาที)
    if (!videosTab) {
      log('⏳ รอ 5 วินาที ให้แท็บ Videos โหลด...', 'info');
      videosTab = await waitForElement(
        () => [...document.querySelectorAll('button[role="tab"], button[role="radio"]')].find(
          btn => btn.textContent?.trim().includes('Videos')
        ),
        5000
      );
      if (videosTab) log('พบแท็บจาก waitForElement', 'info');
    }

    if (!videosTab) {
      log('⚠️ หาแท็บ "Videos" ไม่เจอ — ข้ามไป Frames to Video เลย', 'warning');
      window._isExtendMode = true;
      return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
    }

    humanClick(videosTab);
    log('✅ กดแท็บ "Videos" แล้ว', 'success');
    await delay(2000);

    window._isExtendMode = true;
    return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
  }

  // Step 4.4: คลิกเลือก video ล่าสุด (บนสุด/ซ้ายสุด) ก่อน Add to scene
  async function handleExtendSelectVideo() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.4/14: คลิกเลือก video ล่าสุด (บนสุด)', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    // ========== รอให้หน้าโหลดเสร็จ (รอจน DOM มี content) ==========
    let pageReady = false;
    for (let waitAttempt = 0; waitAttempt < 10; waitAttempt++) {
      // ตรวจว่ามี video หรือ "Failed Generation" หรือ "Frames to Video" button ในหน้า
      const hasVideos = document.querySelectorAll('video[src*="storage.googleapis.com"]').length > 0;
      const hasFailedGen = Array.from(document.querySelectorAll('div')).some(
        div => !div.querySelector('div') && div.textContent?.trim().includes('Failed') && div.textContent?.trim().includes('Generation')
      );
      const hasFramesBtn = Array.from(document.querySelectorAll('button')).some(
        btn => btn.textContent?.toLowerCase().includes('frames to video')
      );
      if (hasVideos || hasFailedGen || hasFramesBtn) {
        pageReady = true;
        log(`✅ หน้าโหลดแล้ว (attempt ${waitAttempt + 1}) — videos:${hasVideos} failed:${hasFailedGen} framesBtn:${hasFramesBtn}`, 'info');
        break;
      }
      log(`⏳ รอหน้าโหลด... (attempt ${waitAttempt + 1}/10)`, 'info');
      await delay(2000);
    }
    if (!pageReady) {
      log('⚠️ หน้าโหลดไม่เสร็จ — ลองต่อไป', 'warning');
    }

    // ========== ลบ "Failed Generation" ที่ค้างอยู่ก่อน (ทำก่อนทุกอย่าง) ==========
    let deletedFailedCount = 0;
    for (let deleteRound = 0; deleteRound < 5; deleteRound++) {
      const failedLabels = [];
      const allDivsCheck = document.querySelectorAll('div');
      for (const div of allDivsCheck) {
        if (div.textContent?.trim().includes('Failed') && div.textContent?.trim().includes('Generation') && !div.querySelector('div')) {
          failedLabels.push(div);
        }
      }
      if (failedLabels.length === 0) break;

      for (const div of failedLabels) {
        log(`🗑️ พบ "Failed Generation" (${deletedFailedCount + 1}) - กำลังลบ...`, 'warning');
        // หา container ที่มีปุ่ม more_vert — ไล่ขึ้นไปทีละ parent (สูงสุด 10 ชั้น)
        let container = null;
        let targetBtn = null;
        let node = div;
        for (let up = 0; up < 10; up++) {
          node = node.parentElement;
          if (!node) break;
          targetBtn = Array.from(node.querySelectorAll('button')).find(btn => {
            const icon = btn.querySelector('i');
            return icon && (icon.textContent?.trim() === 'more_vert' || icon.textContent?.trim() === 'more_horiz');
          });
          if (targetBtn) {
            container = node;
            break;
          }
        }
        if (!container || !targetBtn) {
          log(`⚠️ หา container/ปุ่ม more_vert ไม่เจอ สำหรับ Failed Generation — ข้ามไป`, 'warning');
          continue;
        }
        humanClick(targetBtn);
        await delay(1000);
        const menuItems = document.querySelectorAll('div[role="menuitem"], li[role="menuitem"], [role="menu"] button');
        let deleted = false;
        for (const item of menuItems) {
          if (item.textContent?.includes('Delete') || item.textContent?.includes('delete')) {
            humanClick(item);
            deletedFailedCount++;
            deleted = true;
            log(`✅ ลบ Failed Generation สำเร็จ (${deletedFailedCount})`, 'success');
            await delay(1500);
            break;
          }
        }
        if (!deleted) {
          log(`⚠️ กดปุ่ม more_vert แล้ว แต่หา Delete menu item ไม่เจอ (พบ ${menuItems.length} items)`, 'warning');
          // กด Escape ปิดเมนู
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await delay(500);
        }
      }
    }

    if (deletedFailedCount > 0) {
      log(`🗑️ ลบ Failed Generation ทั้งหมด ${deletedFailedCount} รายการ`, 'info');
      await delay(1000); // รอ DOM update หลังลบ
    }

    let clicked = false;
    let targetVideo = null;

    // ========== หาวิดีโอ + scroll/retry ถ้าไม่เจอ ==========
    let allVideos = [];

    for (let searchRound = 0; searchRound < 10; searchRound++) {
      allVideos = Array.from(document.querySelectorAll('video[src*="storage.googleapis.com/ai-sandbox-videofx/video"]'));

      if (allVideos.length > 0) {
        log(`✅ พบ video elements ${allVideos.length} อัน (round ${searchRound + 1})`, 'info');
        break;
      }

      log(`⏳ ไม่พบ video — ลอง scroll + หา video step (round ${searchRound + 1}/10)`, 'warning');

      // Scroll ขึ้น-ลง เพื่อ trigger lazy-load
      window.scrollTo(0, 0);
      await delay(300);
      window.scrollTo(0, document.body.scrollHeight);
      await delay(500);
      window.scrollTo(0, 0);
      await delay(300);

      // ลองคลิกที่ video step/node ใน Flow (ถ้ามี) — เพื่อเปิดดู output ที่มีวิดีโอ
      if (searchRound === 2 || searchRound === 5) {
        // หา step ที่มี icon videocam หรือ play_arrow หรือข้อความ "Video"
        const stepIcons = document.querySelectorAll('i.google-symbols, i.material-icons, i.material-icons-outlined');
        for (const icon of stepIcons) {
          const iconText = icon.textContent?.trim();
          if (iconText === 'videocam' || iconText === 'play_arrow' || iconText === 'smart_display') {
            const stepEl = icon.closest('button') || icon.closest('[class*="card"]') || icon.closest('[class*="step"]') || icon.parentElement;
            if (stepEl) {
              log(`🔍 คลิกที่ video step (icon: ${iconText}) เพื่อเปิดดู output`, 'info');
              humanClick(stepEl);
              await delay(2000);
              break;
            }
          }
        }
        // หา div/button ที่มีข้อความ "Extend_Video" หรือ "Video" ใน Flow steps
        if (allVideos.length === 0) {
          const flowSteps = document.querySelectorAll('div[class*="step"], div[class*="node"], li[class*="step"]');
          for (const step of flowSteps) {
            if (step.textContent?.includes('Video') || step.textContent?.includes('video')) {
              log(`🔍 คลิกที่ Flow step "${step.textContent.trim().substring(0, 30)}" เพื่อเปิดดู output`, 'info');
              humanClick(step);
              await delay(2000);
              break;
            }
          }
        }
      }

      await delay(2000);
    }

    // ถ้าไม่มี video เลย หลัง retry ทั้งหมด → สร้างใหม่ด้วย Frames to Video
    if (allVideos.length === 0) {
      log('❌ หา video ไม่เจอหลัง scroll + retry 10 ครั้ง — สร้างวิดีโอใหม่ด้วย Frames to Video', 'error');
      return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
    }

    // ========== Method 0: Match URL ที่เพิ่ง generate (ถ้ามี) ==========

    if (window._latestGeneratedVideoUrl && allVideos.length > 0) {
      // ดึง video ID จาก URL เพื่อ match (เช่น /video/abc123/)
      const savedUrl = window._latestGeneratedVideoUrl;
      const savedIdMatch = savedUrl.match(/\/video\/([^/]+)\//);
      const savedId = savedIdMatch ? savedIdMatch[1] : null;

      if (savedId) {
        const matchedVideo = allVideos.find(v => v.src && v.src.includes(savedId));
        if (matchedVideo) {
          targetVideo = matchedVideo;
          log(`✅ Method 0: เจอ video ที่ตรงกับ URL ที่เพิ่ง generate (ID: ${savedId})`, 'success');
        } else {
          log(`⚠️ Method 0: ไม่เจอ video ที่ตรง ID ${savedId} - ลอง method อื่น`, 'warning');
        }
      }
    }

    // ========== Method 1: เรียงตามตำแหน่ง Y (บนสุด) ==========
    if (!targetVideo && allVideos.length > 0) {
      // Filter เฉพาะ video ที่มองเห็น
      const visibleVideos = allVideos.filter(video => {
        const rect = video.getBoundingClientRect();
        const style = window.getComputedStyle(video);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          parseFloat(style.opacity) > 0
        );
      });

      log(`พบ video ที่มองเห็นได้ ${visibleVideos.length} อัน`, 'info');

      if (visibleVideos.length > 0) {
        // ✅ ใช้ DOM Order - video แรกใน DOM = บนสุดในหน้าจอ
        targetVideo = visibleVideos[0];
        log(`✅ Method 1: เลือก video แรกใน DOM`, 'success');
      }
    }

    // ========== Fallback Method 2: ใช้ video size ==========
    if (!targetVideo && allVideos.length > 0) {
      log('⚠️ Method 1 ล้มเหลว - ลอง Method 2: เรียงตาม video size', 'warning');

      const videosBySize = [...allVideos].sort((a, b) => {
        const sizeA = a.videoWidth * a.videoHeight;
        const sizeB = b.videoWidth * b.videoHeight;
        return sizeB - sizeA;  // ใหญ่สุดก่อน
      });

      targetVideo = videosBySize[0];
      log(`✅ Method 2: เลือก video ใหญ่สุด (${targetVideo.videoWidth}x${targetVideo.videoHeight})`, 'success');
    }

    // ========== Fallback Method 3: ใช้ videos[0] (วิธีเดิม) ==========
    if (!targetVideo && allVideos.length > 0) {
      log('⚠️ Method 2 ล้มเหลว - ลอง Method 3: ใช้ videos[0]', 'warning');
      targetVideo = allVideos[0];
      log('✅ Method 3: ใช้ video ตัวแรกในลิสต์', 'success');
    }

    // ========== คลิกที่ video ที่เลือก ==========
    if (targetVideo) {
      // หา click target (parent container)
      let clickTarget = targetVideo.closest('[data-testid]') ||
        targetVideo.closest('[class*="card"]') ||
        targetVideo.closest('[class*="item"]') ||
        targetVideo.closest('[class*="thumbnail"]') ||
        targetVideo.closest('[class*="video"]') ||
        targetVideo.parentElement ||
        targetVideo;

      log(`กำลังคลิกที่: ${clickTarget.tagName} (class: ${clickTarget.className?.substring(0, 50)})`, 'info');
      humanClick(clickTarget);
      clicked = true;
      log('✅ คลิกเลือก video แล้ว', 'success');
    }

    // ========== Fallback: หาจาก icon videocam ==========
    if (!clicked) {
      log('⚠️ ไม่พบ video element - ลองหาจาก icon videocam', 'warning');

      const videocamBtn = findButtonByIcon('videocam');
      if (videocamBtn) {
        humanClick(videocamBtn);
        clicked = true;
        log('✅ คลิกที่ icon videocam แล้ว', 'success');
      }
    }

    // ========== Fallback: หาจาก google-symbols ==========
    if (!clicked) {
      const icons = document.querySelectorAll('i.google-symbols');
      for (const icon of icons) {
        if (icon.textContent.trim() === 'videocam') {
          const clickTarget = icon.closest('button') || icon.closest('[class*="card"]') || icon.parentElement;
          if (clickTarget) {
            humanClick(clickTarget);
            clicked = true;
            log('✅ คลิกที่ videocam icon (google-symbols) แล้ว', 'success');
            break;
          }
        }
      }
    }

    if (!clicked) {
      log('⚠️ ไม่พบ video element หรือ videocam icon - ลองกด Add to scene ต่อ', 'warning');
    }

    await delay(1500);
    // ข้าม Add to scene — ไปกด Scenebuilder เลย (อยู่หน้าเดิม)
    return STATES.EXTEND_CLICK_SWITCH_BUILDER;
  }

  // Step 4.5: กดปุ่ม "Add to scene" (transition_push icon) — ข้ามแล้ว แต่เก็บไว้เผื่อ fallback
  async function handleExtendClickAddToScene() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.5/14: กดปุ่ม "Add to scene"', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    // รอให้ปุ่ม "Add to scene" ปรากฏ (สูงสุด 10 วินาที)
    const addToSceneBtn = await waitForElement(() => {
      // วิธี 1: หาจาก icon transition_push
      let btn = findButtonByIcon('transition_push');
      if (btn) {
        log('[Add to scene] ✅ พบจาก icon transition_push', 'info');
        return btn;
      }

      // วิธี 2: หาจาก button ที่มี color="BLURPLE" และมี icon transition_push
      const blurpleButtons = document.querySelectorAll('button[color="BLURPLE"]');
      for (const b of blurpleButtons) {
        const icon = b.querySelector('i.google-symbols');
        if (icon && icon.textContent.trim() === 'transition_push') {
          log('[Add to scene] ✅ พบจาก BLURPLE button + icon', 'info');
          return b;
        }
      }

      // วิธี 3: หาจาก i.google-symbols ที่มี text transition_push
      const icons = document.querySelectorAll('i.google-symbols');
      for (const icon of icons) {
        if (icon.textContent.trim() === 'transition_push') {
          btn = icon.closest('button');
          if (btn) {
            log('[Add to scene] ✅ พบจาก google-symbols icon', 'info');
            return btn;
          }
        }
      }

      // วิธี 4: หาจาก text "Add to scene" ใน span (ที่ซ่อนอยู่)
      const spans = document.querySelectorAll('button span');
      for (const span of spans) {
        if (span.textContent.toLowerCase().includes('add to scene')) {
          btn = span.closest('button');
          if (btn) {
            log('[Add to scene] ✅ พบจาก span text', 'info');
            return btn;
          }
        }
      }

      // วิธี 5: หาจาก textContent ของ button
      const buttons = document.querySelectorAll('button');
      for (const b of buttons) {
        if (b.textContent.toLowerCase().includes('add to scene')) {
          log('[Add to scene] ✅ พบจาก button text', 'info');
          return b;
        }
      }

      return null;
    }, 10000);

    if (!addToSceneBtn) {
      log('❌ ไม่พบปุ่ม "Add to scene" (รอ 10 วินาทีแล้ว)', 'error');
      log('💡 ลองหาปุ่มที่มี icon transition_push หรือ color="BLURPLE"', 'info');
      return STATES.ERROR;
    }

    humanClick(addToSceneBtn);
    log('✅ กดปุ่ม "Add to scene" แล้ว', 'success');

    await delay(DELAYS.AFTER_CLICK);
    return STATES.EXTEND_CLICK_SWITCH_BUILDER;
  }

  // Step 4.6: กดปุ่ม "Switch to SceneBuilder"
  async function handleExtendClickSwitchBuilder() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.6/14: กดปุ่ม "Switch to SceneBuilder"', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    // หาปุ่ม "Switch to SceneBuilder" จาก class หรือ text
    let switchBtn = document.querySelector('button.sc-f6076f05-0');

    if (!switchBtn) {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.includes('Switch to SceneBuilder')) {
          switchBtn = btn;
          break;
        }
      }
    }

    if (!switchBtn) {
      log('⚠️ ไม่พบปุ่ม "Switch to SceneBuilder" - อาจเข้า SceneBuilder อัตโนมัติแล้ว', 'warning');
      // รอแล้วไปต่อ
      await delay(2000);
      return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
    }

    humanClick(switchBtn);
    log('✅ กดปุ่ม "Switch to SceneBuilder" แล้ว', 'success');

    await delay(3000); // รอ SceneBuilder โหลด

    // ========== FIX: รอให้ clip ปรากฏใน SceneBuilder ก่อน (สูงสุด 10 วินาที) ==========
    log('⏳ รอตรวจสอบว่า clip ถูกเพิ่มเข้า SceneBuilder แล้ว...', 'info');

    const clipElement = await waitForElement(() => {
      // วิธี 1: หา clip จาก icon 'remove', 'delete', 'close' (ปุ่มลบ clip)
      let removeBtn = findButtonByIcon('remove');
      if (removeBtn) {
        log('✅ พบ clip ใน SceneBuilder (เจอปุ่ม remove)', 'success');
        return removeBtn;
      }

      removeBtn = findButtonByIcon('delete');
      if (removeBtn) {
        log('✅ พบ clip ใน SceneBuilder (เจอปุ่ม delete)', 'success');
        return removeBtn;
      }

      removeBtn = findButtonByIcon('close');
      if (removeBtn) {
        log('✅ พบ clip ใน SceneBuilder (เจอปุ่ม close)', 'success');
        return removeBtn;
      }

      // วิธี 2: หา video element ใน SceneBuilder
      const videos = document.querySelectorAll('video');
      if (videos.length > 0) {
        log(`✅ พบ clip ใน SceneBuilder (เจอ ${videos.length} video elements)`, 'success');
        return videos[0];
      }

      // วิธี 3: หา div ที่มี class เกี่ยวกับ clip/scene
      const clipDivs = document.querySelectorAll('div[class*="clip"], div[class*="scene"], div[class*="timeline"]');
      if (clipDivs.length > 0) {
        log(`✅ พบ clip ใน SceneBuilder (เจอ ${clipDivs.length} clip divs)`, 'success');
        return clipDivs[0];
      }

      // วิธี 4: หา thumbnail/preview images ที่มีขนาดพอสมควร
      const images = document.querySelectorAll('img');
      for (const img of images) {
        const rect = img.getBoundingClientRect();
        // thumbnail มักมีขนาดมากกว่า 50x50
        if (rect.width > 50 && rect.height > 50) {
          // ต้องไม่ใช่ header/nav/icon
          if (!img.closest('header, nav, [class*="toolbar"]')) {
            log(`✅ พบ clip ใน SceneBuilder (เจอ thumbnail ${rect.width}x${rect.height})`, 'success');
            return img;
          }
        }
      }

      // วิธี 5: หา div ที่มี data-* attributes เกี่ยวกับ clip
      const dataClips = document.querySelectorAll('[data-clip-id], [data-scene-item], [data-timeline-item]');
      if (dataClips.length > 0) {
        log(`✅ พบ clip ใน SceneBuilder (เจอ data attributes)`, 'success');
        return dataClips[0];
      }

      return null;
    }, 10000); // รอสูงสุด 10 วินาที

    if (!clipElement) {
      log('❌ ไม่พบ clip ใน SceneBuilder หลังรอ 10 วินาที', 'error');
      log('💡 วิดีโออาจไม่ถูกเพิ่มเข้า scene สำเร็จ กรุณาตรวจสอบขั้นตอนก่อนหน้า', 'warning');
      log('💡 Hint: ตรวจสอบว่า "Add to scene" สำเร็จหรือไม่', 'warning');
      return STATES.ERROR;
    }

    log('✅ ตรวจสอบแล้ว: มี clip ใน SceneBuilder - พร้อมทำต่อ', 'success');
    // ========== END FIX ==========

    return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
  }

  // Step 4.6.5: คลิกเลือกคลิปสุดท้ายใน timeline (สำหรับ extend รอบถัดไป)
  async function handleExtendSelectLastClip() {
    const currentCount = window._extendCurrentCount || 0;
    // extendClipCount = จำนวนคลิปรวม (เลือก 2 = 2 คลิปรวม = ทำ 1 extend)
    const targetCount = (S.automationData?.extendClipCount || 2) - 1;

    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log(`📍 Step 4.6.5: คลิกเลือกคลิปสุดท้าย (Extend ${currentCount + 1}/${targetCount})`, 'step');

    await delay(1000);

    // ========== วิธีหลัก: หาทุก clip element แล้วเลือกตัวที่อยู่ขวาสุด ==========
    // รวม selectors หลายแบบเพื่อจับ clip ทุกชนิด (ทั้ง complete และ generating)
    const clipSelectors = [
      'div[class*="sc-624db470"]',   // Timeline Video Thumbnails
      'div[class*="sc-962285be"]',   // Clip tracks
    ];

    let allClipElements = [];
    for (const selector of clipSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        allClipElements = Array.from(elements);
        log(`พบ clips จาก "${selector}": ${elements.length}`, 'info');
        break;
      }
    }

    // วิธีเสริม: หาจาก span "Timeline Video Thumbnail for seeking" ถ้า selector ข้างบนไม่เจอ
    if (allClipElements.length === 0) {
      const allSpans = document.querySelectorAll('span');
      const thumbnailSpans = Array.from(allSpans).filter(span =>
        span.textContent.includes('Timeline Video Thumbnail for seeking')
      );
      if (thumbnailSpans.length > 0) {
        allClipElements = thumbnailSpans.map(span => span.parentElement).filter(Boolean);
        log(`พบ clips จาก thumbnail spans: ${allClipElements.length}`, 'info');
      }
    }

    // ========== เลือกตัวขวาสุดด้วยตำแหน่ง X ==========
    if (allClipElements.length > 0) {
      // เรียงตาม X position (ขวาสุด = ค่า X สูงสุด)
      const sorted = allClipElements
        .map(el => ({ el, x: el.getBoundingClientRect().right }))
        .sort((a, b) => b.x - a.x);

      const rightmost = sorted[0].el;
      const rightmostIndex = allClipElements.indexOf(rightmost) + 1;
      log(`🎯 คลิกเลือกคลิปขวาสุด (คลิปที่ ${rightmostIndex}/${allClipElements.length}, X=${sorted[0].x.toFixed(0)})`, 'info');
      humanClick(rightmost);
      await delay(500);
      return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
    }

    // ========== Fallback: คลิกที่ปุ่ม + ด้านขวา แล้วกดซ้ายเพื่อเลือกคลิปก่อนหน้า ==========
    log('⚠️ ไม่พบ Timeline clips - ข้ามไปกดปุ่ม +', 'warning');
    await delay(500);
    return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
  }

  // Step 4.7: กดปุ่ม "+" (PINHOLE_ADD_CLIP_CARD_ID)
  async function handleExtendClickAddClip() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.7/14: กดปุ่ม "+" เพิ่มคลิป', 'step');

    // ใช้ waitForElement รอจนกว่าจะเจอปุ่ม (สูงสุด 10 วินาที)
    const addClipBtn = await waitForElement(() => {
      // 1. ลองหาจาก ID ก่อน
      let btn = document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID');
      if (btn) return btn;

      // 2. หา <i> ที่มี class material-icons และ text="add" แบบเฉพาะเจาะจง
      const allIcons = document.querySelectorAll('i.material-icons');
      for (const icon of allIcons) {
        if (icon.textContent.trim() === 'add') {
          // หา parent ที่คลิกได้ (button, div ที่มี click, หรือ element ที่มี cursor pointer)
          const clickable = icon.closest('button') || icon.closest('[role="button"]') || icon.parentElement;
          if (clickable) return clickable;
        }
      }

      // 3. หาจาก icon 'add' ที่อยู่ใน button (เดิม)
      btn = findButtonByIcon('add');
      if (btn) return btn;

      // 4. หาจาก icon 'add_circle'
      btn = findButtonByIcon('add_circle');
      if (btn) return btn;

      return null;
    }, 10000);

    if (!addClipBtn) {
      log('❌ ไม่พบปุ่ม "+" (รอ 10 วินาทีแล้ว)', 'error');
      return STATES.ERROR;
    }

    humanClick(addClipBtn);
    log('✅ กดปุ่ม "+" เพิ่มคลิปแล้ว', 'success');

    await delay(1000); // รอ menu เปิด
    return STATES.EXTEND_CLICK_EXTEND_MENU;
  }

  // Step 4.8: กดเมนู "Extend…"
  async function handleExtendClickExtendMenu() {
    const currentCount = window._extendCurrentCount || 0;
    // extendClipCount = จำนวนคลิปรวม (เลือก 2 = 2 คลิปรวม = ทำ 1 extend)
    const targetCount = (S.automationData?.extendClipCount || 2) - 1;

    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log(`📍 Step 4.8/14: กดเมนู "Extend…" (Extend ${currentCount + 1}/${targetCount})`, 'step');

    // ใช้ waitForElement รอให้ menu โหลด (สูงสุด 8 วินาที - เพิ่มเวลาสำหรับ 33% mode)
    const extendMenuItem = await waitForElement(() => {
      // 1. หาจาก role="menuitem" ที่มี text "Extend"
      const menuItems = document.querySelectorAll('div[role="menuitem"]');
      for (const item of menuItems) {
        if (item.textContent.includes('Extend')) {
          return item;
        }
      }

      // 2. หาจาก data-radix-collection-item (Radix UI menu)
      const radixItems = document.querySelectorAll('[data-radix-collection-item]');
      for (const item of radixItems) {
        if (item.textContent.includes('Extend')) {
          return item;
        }
      }

      // 3. หาจาก icon logout (รวม material-icons-outlined)
      const icons = document.querySelectorAll('i.google-symbols, i.material-icons, i.material-icons-outlined');
      for (const icon of icons) {
        if (icon.textContent.trim() === 'logout') {
          // หา parent ที่เป็น menuitem หรือ radix item
          const menuItem = icon.closest('div[role="menuitem"]') || icon.closest('[data-radix-collection-item]');
          if (menuItem) return menuItem;
        }
      }

      return null;
    }, 8000);

    if (!extendMenuItem) {
      log('❌ ไม่พบเมนู "Extend…" (รอ 8 วินาทีแล้ว)', 'error');
      return STATES.ERROR;
    }

    humanClick(extendMenuItem);
    log('✅ กดเมนู "Extend…" แล้ว', 'success');

    return STATES.EXTEND_WAIT_TEXTAREA;
  }

  // Step 4.9: รอ textarea พร้อม (3 วินาที)
  async function handleExtendWaitTextarea() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.9/14: รอ textarea พร้อม', 'step');

    // รอ 3 วินาทีให้ UI โหลด
    log('⏳ รอ 3 วินาที...', 'info');
    await delay(3000);

    // เช็คว่ามี textarea พร้อมหรือยัง
    const textarea = document.querySelector('#PINHOLE_TEXT_AREA_ELEMENT_ID');
    if (textarea) {
      log('✅ พบ textarea พร้อมใช้งาน', 'success');
    } else {
      log('⚠️ ไม่พบ textarea จาก ID - จะลองหาจาก selector อื่น', 'warning');
    }

    return STATES.EXTEND_FILL_PROMPT;
  }

  // Step 4.10: ใส่ Video Prompt ลงใน textarea (เลือก prompt ตาม extend count)
  async function handleExtendFillPrompt() {
    const currentExtendIndex = window._extendCurrentCount || 0;
    // extendClipCount = จำนวนคลิปรวม (เลือก 2 = 2 คลิปรวม = ทำ 1 extend)
    const targetCount = (S.automationData?.extendClipCount || 2) - 1;
    const promptsAvailable = S.automationData?.extendVideoPrompts?.length || 0;

    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log(`📍 Step 4.10/14: ใส่ Video Prompt (Extend ${currentExtendIndex + 1}/${targetCount})`, 'step');
    log(`📋 Available prompts: ${promptsAvailable}, Current index: ${currentExtendIndex}`, 'info');

    // เลือก prompt ตาม extend index:
    // - extend #1 (index 0): ใช้ videoPrompt2 (VP2)
    // - extend #2 (index 1): ใช้ extendVideoPrompts[0] (VP3)
    // - extend #3 (index 2): ใช้ extendVideoPrompts[1] (VP4)
    // - etc.

    // Debug: แสดงข้อมูล extendVideoPrompts
    const availablePrompts = S.automationData?.extendVideoPrompts?.length || 0;
    log(`📊 Debug: extendVideoPrompts มี ${availablePrompts} prompts, currentExtendIndex = ${currentExtendIndex}`, 'info');

    let prompt = '';
    if (currentExtendIndex === 0) {
      // Extend #1: ใช้ videoPrompt2 (VP2) เสมอ
      prompt = S.automationData?.videoPrompt2 || '';
      log(`📝 ใช้ videoPrompt2 (VP2) สำหรับ Extend #1`, 'info');
    } else if (S.automationData?.extendVideoPrompts && S.automationData.extendVideoPrompts[currentExtendIndex - 1]) {
      // Extend #2+: ใช้ extendVideoPrompts[index-1] (VP3, VP4, ...)
      prompt = S.automationData.extendVideoPrompts[currentExtendIndex - 1];
      log(`📝 ใช้ extendVideoPrompts[${currentExtendIndex - 1}] (VP${currentExtendIndex + 2}) สำหรับ Extend #${currentExtendIndex + 1}`, 'info');
    } else if (S.automationData?.videoPrompt2) {
      // Fallback สุดท้าย
      prompt = S.automationData.videoPrompt2;
      log(`📝 ⚠️ ใช้ videoPrompt2 (fallback) - ไม่มี extendVideoPrompts[${currentExtendIndex - 1}]`, 'warning');
    }

    // Debug: แสดง dialogue_script ที่จะใช้
    if (prompt) {
      try {
        const promptObj = JSON.parse(prompt);
        if (promptObj.dialogue_script) {
          log(`🗣️ dialogue_script: "${promptObj.dialogue_script}"`, 'info');
        }
      } catch (e) {
        log(`📝 Prompt content: "${prompt.substring(0, 100)}..."`, 'info');
      }
    }

    if (!prompt) {
      log('❌ ไม่มี prompt สำหรับ extend', 'error');
      return STATES.ERROR;
    }

    // หา textarea จาก ID ที่ user ให้มา
    let promptInput = document.querySelector('#PINHOLE_TEXT_AREA_ELEMENT_ID');

    if (!promptInput) {
      // Fallback: หา textarea ทั่วไป
      promptInput = document.querySelector('textarea[placeholder*="prompt"]');
    }

    if (!promptInput) {
      promptInput = document.querySelector('textarea[placeholder*="Describe"]');
    }

    if (!promptInput) {
      // หา textarea ที่ใช้งานได้
      const textareas = document.querySelectorAll('textarea');
      for (const ta of textareas) {
        if (!ta.disabled && ta.offsetParent !== null) {
          promptInput = ta;
          break;
        }
      }
    }

    if (!promptInput) {
      log('❌ ไม่พบ textarea สำหรับใส่ prompt', 'error');
      return STATES.ERROR;
    }

    // Clear และใส่ค่าใหม่ (ก็อปวางทีเดียว ไม่พิมพ์ทีละตัว)
    promptInput.value = '';
    promptInput.focus();

    // ใส่ prompt ทีเดียว
    promptInput.value = prompt;
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    promptInput.dispatchEvent(new Event('change', { bubbles: true }));
    log(`✅ ใส่ Video Prompt 2 แล้ว (${prompt.length} ตัวอักษร)`, 'success');

    await delay(DELAYS.AFTER_CLICK);
    return STATES.EXTEND_CLICK_CREATE;
  }

  // Step 4.11: กดปุ่ม "Create" (arrow_forward icon)
  async function handleExtendClickCreate() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.11/14: กดปุ่ม "Create"', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    // หาปุ่ม Create จาก icon arrow_forward
    let createBtn = findButtonByIcon('arrow_forward');

    if (!createBtn) {
      // ลองหาจาก text "Create"
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.toLowerCase().includes('create')) {
          createBtn = btn;
          break;
        }
      }
    }

    if (!createBtn) {
      log('❌ ไม่พบปุ่ม "Create"', 'error');
      return STATES.ERROR;
    }

    // ⚠️ สำคัญ: จับ existing videos **ก่อน** กด Create
    // SceneBuilder ใช้ blob URLs และ Storyboard ใช้ storage.googleapis.com
    const existingBlobVideos = document.querySelectorAll('video[src^="blob:"]');
    const existingStorageVideos = document.querySelectorAll('video[src*="storage.googleapis.com"]');
    window._extendExistingBlobUrls = new Set(Array.from(existingBlobVideos).map(v => v.src));
    window._extendExistingStorageIds = new Set(Array.from(existingStorageVideos).map(v => extractVideoId(v.src)));
    log(`📊 มี video เดิม: blob ${window._extendExistingBlobUrls.size} อัน, storage ${window._extendExistingStorageIds.size} อัน`, 'info');

    // ✅ NEW: Capture timestamp when generation starts
    window._generationStartTime = Date.now();
    log(`⏱️ เริ่มจับเวลา generation ที่ ${window._generationStartTime}`, 'info');

    // ✅ Snapshot error elements ก่อนกด Create — ป้องกัน false positive จาก error เก่า
    window._extendExistingErrorElements = snapshotExistingErrors();
    log(`📸 Snapshot error elements เดิม: ${window._extendExistingErrorElements.size} อัน`, 'info');

    // ✅ บันทึก extend state ลง chrome.storage เผื่อ page reload ระหว่าง generate
    try {
      await chrome.storage.local.set({
        google_flow_extend_in_progress: true,
        google_flow_extend_data: {
          ...S.automationData,
          extendCurrentCount: window._extendCurrentCount || 0,
          lastState: 'EXTEND_WAIT_GENERATE',
          timestamp: Date.now()
        }
      });
      log('💾 บันทึก extend state ลง storage แล้ว (เผื่อ page reload)', 'info');
    } catch (e) {
      log('⚠️ บันทึก extend state ไม่สำเร็จ (ไม่เป็นไร)', 'warning');
    }

    humanClick(createBtn);
    log('✅ กดปุ่ม "Create" แล้ว - เริ่ม Generate VDO', 'success');

    return STATES.EXTEND_WAIT_GENERATE;
  }

  // Step 4.12: รอ GEN VDO เสร็จ (Polling พร้อม Progress %)
  async function handleExtendWaitGenerate() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.12/14: รอ VDO Extend Generate (Polling)', 'step');

    const videoWaitTime = S.automationData?.videoGenDelay || DELAYS.GEN_VIDEO_WAIT;
    const POLL_INTERVAL = 5000; // 5 วินาที
    const HEARTBEAT_INTERVAL = 30000; // 30 วินาที - log heartbeat ทุก 30s
    let elapsed = 0;
    let hasSeenProgress = false;
    let lastHeartbeatTime = 0;
    let pollCount = 0;
    let lastProgressValue = null;

    // existing videos จาก handleExtendClickCreate
    const existingBlobUrls = window._extendExistingBlobUrls || new Set();
    const existingStorageIds = window._extendExistingStorageIds || new Set();

    log(`⏳ เริ่ม Polling (Max ${videoWaitTime / 1000}s, ตรวจทุก ${POLL_INTERVAL / 1000}s)`, 'info');
    log(`💓 Heartbeat จะแสดงทุก 30s เพื่อแสดงว่าระบบทำงานปกติ`, 'info');

    while (elapsed < videoWaitTime) {
      pollCount++;

      // Heartbeat: log ทุก 30s
      if (elapsed - lastHeartbeatTime >= HEARTBEAT_INTERVAL) {
        const elapsedMin = (elapsed / 60000).toFixed(1);
        const maxMin = (videoWaitTime / 60000).toFixed(1);
        const pctTime = ((elapsed / videoWaitTime) * 100).toFixed(0);
        log(
          `[Step4] 💓 รอมา ${elapsedMin}/${maxMin} นาที (${pctTime}%) | Poll #${pollCount}`,
          'info'
        );
        lastHeartbeatTime = elapsed;
      }

      // 1. ดึง Progress % จาก UI (leaf elements ที่มี % text)
      let realProgress = null;
      let status = 'waiting';
      const allDivs = document.querySelectorAll('div');

      // Debug: แสดงว่ากำลัง scan DOM (ทุก 6 polls = 30s)
      if (pollCount % 6 === 0 && !hasSeenProgress) {
        log(`[Step4] 🔍 Scan ${allDivs.length} divs, ยังไม่เจอ progress...`, 'info');
      }

      for (const div of allDivs) {
        // ต้องเป็น leaf element (ไม่มี children) เพื่อจับ % ได้แม่น
        if (div.children.length === 0) {
          const text = div.innerText?.trim();
          if (text && /^\d+%$/.test(text)) {
            realProgress = parseInt(text);
            status = 'generating';
            break;
          }
        }
      }

      // ถ้าเจอ progress > 0% = กำลัง generate จริงๆ
      if (realProgress !== null && realProgress > 0) {
        if (!hasSeenProgress) {
          log(`🚀 เริ่ม generate จริงแล้ว! (progress: ${realProgress}%)`, 'info');
        } else if (realProgress !== lastProgressValue) {
          // Log เฉพาะตอน progress เปลี่ยน
          log(`[Step4] 📈 Progress: ${lastProgressValue}% → ${realProgress}%`, 'info');
        }
        hasSeenProgress = true;
        lastProgressValue = realProgress;

        // ✅ ตรวจจับ 99% ค้าง - ถ้าค้างนานเกิน 120 วินาที ให้กลับไป Scenebuilder แล้วทำต่อ
        const EXTEND_99_STUCK_TIMEOUT = 120000; // 120 วินาที
        if (realProgress === 99) {
          if (stuckAt99StartTime === null) {
            stuckAt99StartTime = Date.now();
            log(`⏳ [Step4] Progress ถึง 99% - รอ video render เสร็จ...`, 'info');
          } else {
            const stuckDuration = Date.now() - stuckAt99StartTime;
            // log ทุก 30 วินาที
            if (stuckDuration > 0 && stuckDuration % 30000 < 2000) {
              log(`⏳ [Step4] 99% รอมาแล้ว ${(stuckDuration / 1000).toFixed(0)} วินาที (trigger ที่ ${EXTEND_99_STUCK_TIMEOUT / 1000} วินาที)...`, 'info');
            }
            // ถ้าค้างนานเกิน timeout → กลับไป Scenebuilder แล้วทำขั้นตอน Extend ต่อ
            if (stuckDuration >= EXTEND_99_STUCK_TIMEOUT) {
              log(`⚠️ [Step4] 99% ค้างนานเกิน ${EXTEND_99_STUCK_TIMEOUT / 1000} วินาที! กลับไป Scenebuilder แล้วทำต่อ...`, 'warning');
              stuckAt99StartTime = null;
              window._generationStartTime = null;
              return STATES.EXTEND_CLICK_SCENEBUILDER;
            }
          }
        } else {
          // Reset ถ้า progress ไม่ใช่ 99%
          stuckAt99StartTime = null;
        }
      } else if (realProgress === null && lastProgressValue !== null) {
        // Progress หายไป
        log(`[Step4] 🔍 Progress หายไป (was ${lastProgressValue}%)`, 'info');
        lastProgressValue = null;
      }

      // ✅ ตรวจจับ "Couldn't generate image" error ระหว่าง polling (กรอง error เก่า)
      const midPollError = detectGenerationError(window._extendExistingErrorElements);
      if (midPollError.hasError && midPollError.errorMessage.toLowerCase().includes("couldn't generate")) {
        log(`⚠️ [Step4] ตรวจพบ "Couldn't generate image" - กำลังล้าง cookies และ retry...`, 'error');
        await handleStuckAt99();
        return STATES.IDLE;
      }

      // ✅ NEW: ตรวจจับ "High Demand" error - รอแล้ว retry
      if (midPollError.hasError && midPollError.errorMessage.toLowerCase().includes('high demand')) {
        window._highDemandRetryCount = (window._highDemandRetryCount || 0) + 1;
        log(`⚠️ [Step4] Server High Demand! (retry ${window._highDemandRetryCount}/5)`, 'warning');

        if (window._highDemandRetryCount >= 5) {
          log(`❌ [Step4] High Demand retry 5 ครั้งแล้ว - ข้ามแถวนี้`, 'error');
          window._highDemandRetryCount = 0;
          return STATES.ERROR;
        }

        // ปิด error popup/toast (ถ้ามี)
        const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                          document.querySelector('button[aria-label="Close"]');
        if (dismissBtn) {
          dismissBtn.click();
          await delay(500);
        }

        // รอ 2-3 นาทีแล้ว retry (สุ่ม 120-180 วินาที)
        const waitTime = 120000 + Math.random() * 60000;
        log(`⏳ [Step4] รอ ${Math.round(waitTime/1000)} วินาที ก่อน retry...`, 'info');
        await delay(waitTime);

        // กลับไปเริ่ม extend ใหม่
        log(`🔄 [Step4] กลับไป retry extend...`, 'info');
        return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
      }

      // ✅ REMOVED: Error check moved inside progressGone block below
      // This prevents false positives from detecting old errors while generating

      // 2. Check for new video - ตรวจเมื่อ progress หายไป หรือค้างที่ 99% นาน
      let newVideoUrl = null;
      const progressGone = hasSeenProgress && realProgress === null;
      const stuckAt99Long = realProgress === 99 && stuckAt99StartTime && (Date.now() - stuckAt99StartTime) > 30000;
      const shouldCheckVideo = progressGone || stuckAt99Long;

      if (shouldCheckVideo) {
        if (progressGone) {
          log(`[Step4] 🔍 Progress หายไป! รอ 5 วินาทีก่อนหา video...`, 'info');
          await delay(5000); // ✅ EXTENDED: รอให้ video โหลด + error label ปรากฏ (ถ้ามี)
        } else {
          log(`[Step4] 🔍 99% ค้างนาน ${((Date.now() - stuckAt99StartTime) / 1000).toFixed(0)}s - ตรวจหา video...`, 'info');
        }

        // ✅ Hybrid Detection: ตรวจทั้ง video และ error พร้อมกัน

        // ✅ 1. ตรวจ video ก่อน (collect new videos)
        // Debug: แสดงจำนวน video ที่พบ
        const storageVideos = document.querySelectorAll('video[src*="storage.googleapis.com"]');
        const blobVideos = document.querySelectorAll('video[src^="blob:"]');
        log(`[Step4] 📊 พบ storage: ${storageVideos.length}, blob: ${blobVideos.length}, existing storage: ${existingStorageIds.size}, existing blob: ${existingBlobUrls.size}`, 'info');
        log(`[Step4] 📊 Global tracking has ${window._allSeenVideoIds.size} videos`, 'info');

        // ลองหา storage URL ก่อน
        for (const video of storageVideos) {
          const videoId = extractVideoId(video.src);

          // ✅ CHANGED: Check both local and global video ID sets
          const isInExisting = existingStorageIds.has(videoId);
          const isInGlobalSeen = window._allSeenVideoIds.has(videoId);

          // 🔍 DEBUG: Log video check
          log(`[Step4] 🔍 Checking video ID: ${videoId.substring(0, 8)}... | inExisting: ${isInExisting}, inGlobal: ${isInGlobalSeen}`, 'info');

          // 🔍 DEBUG: Skip video from previous row
          if (isInGlobalSeen) {
            log(`[Step4] ⏭️ Skip video from previous row: ${videoId}`, 'warning');
            continue;
          }

          if (!isInExisting && !isInGlobalSeen) {
            // ✅ NEW: Validate video age - skip if appeared too quickly
            const videoAge = Date.now() - (window._generationStartTime || Date.now());
            if (videoAge < 1000) {
              log(`[Step4] ⏭️ Skip video (too fast): ${videoId.substring(0, 8)}... (${videoAge}ms)`, 'warning');
              continue; // Skip this video, check next one
            }

            // ✅ Add to global tracking BEFORE using it
            window._allSeenVideoIds.add(videoId);
            log(`[Step4] ✅ Added to global tracking: ${videoId}`, 'info');
            log(`[Step4] 📊 Global tracking now has: ${window._allSeenVideoIds.size} videos`, 'info');

            newVideoUrl = video.src;
            log(`[Step4] ✅ Found new video (storage): ${videoId} (age: ${(videoAge / 1000).toFixed(1)}s)`, 'success');
            break;
          }
        }

        // ถ้าไม่เจอ storage → ใช้ blob video ตัวใหญ่ที่สุด (preview panel)
        if (!newVideoUrl) {
          let largestVideo = null;
          let largestSize = 0;

          for (const video of blobVideos) {
            const rect = video.getBoundingClientRect();
            const size = rect.width * rect.height;

            // เลือก video ที่ใหญ่ที่สุด (ลด threshold เหลือ 10000 pixels)
            if (size > largestSize && size > 10000) {
              largestSize = size;
              largestVideo = video;
            }
          }

          // Fallback: ถ้าไม่เจอ video ใหญ่พอ แต่มี blob video อยู่ → ใช้ตัวแรกเลย
          if (!largestVideo && blobVideos.length > 0) {
            largestVideo = blobVideos[0];
            log(`[Step4] ⚠️ Fallback: ใช้ blob video ตัวแรก`, 'info');
          }

          if (largestVideo) {
            newVideoUrl = largestVideo.src;
            log(`[Step4] ✅ Found video from preview panel (${Math.round(largestSize)} px)`, 'success');
          }
        }

        // ✅ 2. ตรวจ error (กรอง error เก่า)
        const errorCheck = detectGenerationError(window._extendExistingErrorElements);

        // ✅ 3. ตัดสินใจด้วย Hybrid Logic + Failed Label Check
        if (newVideoUrl) {
          // ตรวจสอบ Failed label
          if (errorCheck.hasError) {
            // ❌ มี video + มี Failed label → RETRY
            log(`[Step4] ❌ Video พบแต่มี Failed label: ${errorCheck.errorMessage}`, 'error');
            log('[Step4] 🔄 จะลองใหม่...', 'warning');

            // Increment retry counter
            window._extendRetryCount = (window._extendRetryCount || 0) + 1;
            log(`[Extend] 🔄 จะลองใหม่ครั้งที่ ${window._extendRetryCount}/3...`, 'warning');

            // Check infinite loop
            const now = Date.now();
            if (window._lastExtendRetryTimestamp && (now - window._lastExtendRetryTimestamp) < 1000) {
              window._consecutiveExtendRetriesInSameSecond = (window._consecutiveExtendRetriesInSameSecond || 0) + 1;
              if (window._consecutiveExtendRetriesInSameSecond >= 3) {
                log('[Extend] ❌ ตรวจพบ infinite retry loop', 'error');
                try {
                  chrome.runtime.sendMessage({
                    type: 'VIDEO_GEN_ERROR',
                    data: {
                      rowId: S.savedVideoRowId || S.automationData?.rowId,
                      error: 'Infinite retry loop detected in Step 4 - skipping row',
                      skipRow: true
                    }
                  });
                } catch (e) { }
                return STATES.ERROR;
              }
            } else {
              window._consecutiveExtendRetriesInSameSecond = 0;
            }
            window._lastExtendRetryTimestamp = now;

            // จำกัด retry 3 รอบรวม — ทุกรอบ simplify prompt ขึ้นระดับ
            if (window._extendRetryCount > 3) {
              log(`[Extend] ❌ Retry ครบ 3 รอบแล้ว — ข้ามคลิปนี้`, 'error');
              try {
                chrome.runtime.sendMessage({
                  type: 'EXTEND_VIDEO_ERROR',
                  data: {
                    rowId: S.savedVideoRowId || S.automationData?.rowId,
                    error: `Extend clip ${(window._extendCurrentCount || 0) + 1} failed after 3 retries`,
                    skipRow: false
                  }
                });
              } catch (e) {}
              return STATES.ERROR;
            }

            const simplifyLevel = window._extendRetryCount;  // 1, 2, 3
            log(`[Extend] ⚠️ Retry ${simplifyLevel}/3 - ปรับ prompt ระดับ ${simplifyLevel}`, 'warning');

            const currentIndex = window._extendCurrentCount || 0;
            let prompt = '';
            if (currentIndex === 0) {
              prompt = S.automationData?.videoPrompt2 || '';
            } else if (S.automationData?.extendVideoPrompts && S.automationData.extendVideoPrompts[currentIndex - 1]) {
              prompt = S.automationData.extendVideoPrompts[currentIndex - 1];
            }
            if (prompt) {
              if (simplifyLevel === 1) {
                prompt = prompt.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
                prompt = prompt.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s.,!?'"()-]/g, '');
                log('[Extend] 🔄 ระดับ 1: ลบ emoji และอักขระพิเศษ', 'info');
              } else if (simplifyLevel === 2) {
                prompt = prompt.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
                prompt = prompt.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s.,!?'"()-]/g, '');
                if (prompt.length > 100) {
                  prompt = prompt.substring(0, Math.floor(prompt.length * 0.8));
                  const lastPeriod = Math.max(prompt.lastIndexOf('.'), prompt.lastIndexOf('ค่ะ'), prompt.lastIndexOf('ครับ'));
                  if (lastPeriod > prompt.length * 0.5) prompt = prompt.substring(0, lastPeriod + 1);
                }
                log('[Extend] 🔄 ระดับ 2: ลดความยาว 80%', 'info');
              } else {
                prompt = 'พูดต่อเนื่องจากเดิม อธิบายสินค้าเพิ่มเติม';
                log('[Extend] 🔄 ระดับ 3: ใช้ prompt พื้นฐาน', 'info');
              }
              if (currentIndex === 0) {
                S.automationData.videoPrompt2 = prompt;
              } else {
                S.automationData.extendVideoPrompts[currentIndex - 1] = prompt;
              }
              log(`[Extend] 📝 Prompt ใหม่: ${prompt.substring(0, 80)}...`, 'info');
            }

            // ปิด error popup + ซ่อน error elements
            const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                               document.querySelector('button[aria-label="Close"]');
            if (dismissBtn) { dismissBtn.click(); await delay(500); }

            try {
              const errorLabels = document.querySelectorAll('*');
              let hiddenCount = 0;
              for (const el of errorLabels) {
                const directText = Array.from(el.childNodes)
                  .filter(node => node.nodeType === Node.TEXT_NODE)
                  .map(node => node.textContent.trim())
                  .join(' ');
                if (directText && (directText.includes('Failed Generation') || directText.includes('generation failed'))) {
                  el.style.display = 'none';
                  el.style.visibility = 'hidden';
                  hiddenCount++;
                }
              }
              if (hiddenCount > 0) {
                log(`[Extend] 🧹 ซ่อน error elements ${hiddenCount} อัน`, 'info');
              }
            } catch (e) { }

            await delay(2000);
            window._generationStartTime = null;
            return STATES.EXTEND_FILL_PROMPT;

          } else {
            // ✅ มี video + ไม่มี Failed label → SUCCESS
            log(`[Step4] ✅ Extended video generation successful!`, 'success');
          }
          // newVideoUrl will be used outside this block
        } else {
          // ❌ ไม่มี video
          if (errorCheck.hasError) {
            const errorText = errorCheck.errorMessage;
            const errorMsg = errorText.toLowerCase();

            // ✅ Special handling for "Audio generation failed" - retry with Veo 3.1 compatible prompt
            if (errorMsg.includes('audio generation failed') ||
                (errorMsg.includes('generation failed') && errorMsg.includes('different prompt'))) {
              window._audioFailedRetryCount = (window._audioFailedRetryCount || 0) + 1;
              log(`[Step4] ⚠️ Audio generation failed (retry ${window._audioFailedRetryCount}/3) - แก้ไข prompt ให้เข้ากับ Veo 3.1...`, 'warning');

              // ถ้า retry 3 ครั้งแล้ว ให้ข้ามแถวนี้
              if (window._audioFailedRetryCount > 3) {
                log('[Step4] ❌ Audio generation failed retry 3 ครั้งแล้ว - ข้ามแถวนี้', 'error');
                window._audioFailedRetryCount = 0;
                return STATES.ERROR;
              }

              // 1. ปิด error popup/toast (ถ้ามี)
              const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                                 document.querySelector('button[aria-label="Close"]') ||
                                 document.querySelector('[data-sonner-toaster] button');
              if (dismissBtn) {
                dismissBtn.click();
                await delay(500);
                log('[Step4] ปิด error popup แล้ว', 'info');
              }

              // 2. แก้ไข prompt ให้เข้ากับ Veo 3.1 (ทำให้เรียบง่ายขึ้น)
              // ดึง prompt ตาม index: #0 → videoPrompt2, #1+ → extendVideoPrompts[index-1]
              const currentIndex = window._extendCurrentCount || 0;
              let currentPrompt = '';
              if (currentIndex === 0) {
                currentPrompt = S.automationData?.videoPrompt2 || '';
              } else if (S.automationData?.extendVideoPrompts) {
                currentPrompt = S.automationData.extendVideoPrompts[currentIndex - 1] || '';
              }
              if (currentPrompt) {
                let prompt = currentPrompt;

                // วิธีแก้ไข prompt ตามลำดับ retry
                if (window._audioFailedRetryCount === 1) {
                  // Retry 1: ลบ emoji และอักขระพิเศษ
                  prompt = prompt.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');  // Remove emojis
                  prompt = prompt.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s.,!?'"()-]/g, '');  // Keep only Thai, English, numbers, basic punctuation
                  log(`[Step4] 🔄 Retry 1: ลบ emoji และอักขระพิเศษ`, 'info');
                } else if (window._audioFailedRetryCount === 2) {
                  // Retry 2: ลดความยาว + ทำให้เรียบง่ายขึ้น
                  prompt = prompt.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
                  prompt = prompt.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s.,!?'"()-]/g, '');
                  // ตัดให้สั้นลง (เหลือ 80% ของความยาวเดิม)
                  if (prompt.length > 100) {
                    prompt = prompt.substring(0, Math.floor(prompt.length * 0.8));
                    // ตัดที่ประโยคสุดท้ายที่สมบูรณ์
                    const lastPeriod = Math.max(prompt.lastIndexOf('.'), prompt.lastIndexOf('ค่ะ'), prompt.lastIndexOf('ครับ'));
                    if (lastPeriod > prompt.length * 0.5) {
                      prompt = prompt.substring(0, lastPeriod + 1);
                    }
                  }
                  log(`[Step4] 🔄 Retry 2: ลดความยาว + ทำให้เรียบง่ายขึ้น`, 'info');
                } else {
                  // Retry 3: ใช้ prompt พื้นฐานสุด
                  prompt = 'พูดต่อเนื่องจากเดิม อธิบายสินค้าเพิ่มเติม';
                  log(`[Step4] 🔄 Retry 3: ใช้ prompt พื้นฐาน`, 'info');
                }

                // เก็บ prompt ที่แก้ไขแล้วกลับไป
                if (currentIndex === 0) {
                  S.automationData.videoPrompt2 = prompt;
                } else {
                  S.automationData.extendVideoPrompts[currentIndex - 1] = prompt;
                }
                log(`[Step4] 📝 Prompt ใหม่: ${prompt.substring(0, 50)}...`, 'info');
              } else if (S.automationData?.videoPrompt2) {
                // Fallback to videoPrompt2 modification
                const suffixes = ['.', '..', ' -', ' .', '...'];
                const suffixIndex = (window._audioFailedRetryCount - 1) % suffixes.length;
                let basePrompt = S.automationData.videoPrompt2;
                for (const s of suffixes) {
                  if (basePrompt.endsWith(s)) {
                    basePrompt = basePrompt.slice(0, -s.length);
                    break;
                  }
                }
                S.automationData.videoPrompt2 = basePrompt + suffixes[suffixIndex];
                log(`[Step4] 🔄 แก้ไข videoPrompt2 (เพิ่ม "${suffixes[suffixIndex]}")`, 'info');
              }

              // 3. รอสักครู่แล้วกลับไปใส่ prompt ใหม่
              await delay(2000);
              return STATES.EXTEND_FILL_PROMPT;
            }

            // ✅ Special handling for "third-party content providers" — ลิขสิทธิ์จากรูปภาพ ไม่ retry
            if (errorMsg.includes('third-party content providers') || errorMsg.includes('third-party content')) {
              log('[Step4] ⚠️ Google ตรวจพบลิขสิทธิ์บุคคลที่สาม (third-party content) — ข้ามแถวนี้ ลองเปลี่ยนรูปสินค้าที่ไม่มีโลโก้แบรนด์เด่นชัด', 'error');

              const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                                 document.querySelector('button[aria-label="Close"]') ||
                                 document.querySelector('[data-sonner-toaster] button');
              if (dismissBtn) { dismissBtn.click(); await delay(500); }

              try {
                chrome.runtime.sendMessage({
                  type: 'VIDEO_GEN_COMPLETE',
                  success: false,
                  rowId: S.savedVideoRowId || S.automationData?.rowId,
                  error: 'ลิขสิทธิ์บุคคลที่สาม (third-party content) — ลองเปลี่ยนรูปสินค้าที่ไม่มีโลโก้แบรนด์'
                });
              } catch (e) { }

              S.isRunning = false;
              return STATES.IDLE;
            }

            // ✅ Special handling for "prominent people" policy violation - retry with anti-celebrity prompt
            if (errorMsg.includes('might violate') || errorMsg.includes('prominent people') || errorMsg.includes('policies')) {
              log('[Step4] ⚠️ Policy violation (prominent people) - จะลองใหม่ด้วย prompt ที่แก้ไข...', 'warning');

              // 1. ปิด error popup/toast (ถ้ามี)
              const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                                 document.querySelector('button[aria-label="Close"]') ||
                                 document.querySelector('[data-sonner-toaster] button');
              if (dismissBtn) {
                dismissBtn.click();
                await delay(500);
                log('[Step4] ปิด error popup แล้ว', 'info');
              }

              // 2. เพิ่มข้อความป้องกัน prominent people ใน prompt
              if (S.automationData?.videoPrompt2) {
                // Track retry count for this specific error
                window._prominentPeopleRetryCount2 = (window._prominentPeopleRetryCount2 || 0) + 1;

                if (window._prominentPeopleRetryCount2 > 3) {
                  log('[Step4] ❌ Prominent people error retry 3 ครั้งแล้ว - ข้ามแถวนี้', 'error');
                  window._prominentPeopleRetryCount2 = 0;

                  try {
                    chrome.runtime.sendMessage({
                      type: 'EXTEND_VIDEO_ERROR',
                      data: {
                        rowId: S.savedVideoRowId || S.automationData?.rowId,
                        error: 'Policy violation: prominent people (failed 3 retries)',
                        skipRow: true
                      }
                    });
                  } catch (e) { }

                  S.isRunning = false;
                  return STATES.IDLE;
                }

                // เพิ่มข้อความป้องกัน
                const antiCelebrityPhrases = [
                  '\\n\\nIMPORTANT: The character must be a completely original, fictional person. DO NOT generate any real celebrity, public figure, or famous person.',
                  '\\n\\nCRITICAL: Create a unique fictional character with no resemblance to any real person, celebrity, or public figure.',
                  '\\n\\nMANDATORY: This character must be 100% original and fictional. Avoid any features that could resemble celebrities or famous people.'
                ];

                const phraseIndex = (window._prominentPeopleRetryCount2 - 1) % antiCelebrityPhrases.length;
                const antiCelebrityPhrase = antiCelebrityPhrases[phraseIndex];

                // ลบ anti-celebrity phrase เก่าออก (ถ้ามี)
                let basePrompt = S.automationData.videoPrompt2;
                for (const phrase of antiCelebrityPhrases) {
                  basePrompt = basePrompt.replace(phrase, '');
                }

                S.automationData.videoPrompt2 = basePrompt + antiCelebrityPhrase;
                log(`[Step4] 🔄 เพิ่มข้อความป้องกัน prominent people (ครั้งที่ ${window._prominentPeopleRetryCount2}/3)`, 'info');
              }

              // 3. กลับไปใส่ prompt ใหม่แล้ว generate อีกครั้ง
              await delay(1000);
              return STATES.EXTEND_FILL_PROMPT;
            }

            // ❌ มี error อื่น + ไม่มี video → Retry
            log('[Step4] ❌ Error detected (no video): ' + errorText, 'error');

            // ✅ NEW: Track retry count
            window._extendRetryCount = (window._extendRetryCount || 0) + 1;
            log(`[Extend] 🔄 จะลองใหม่ครั้งที่ ${window._extendRetryCount}/3...`, 'warning');

            // ✅ NEW: Detect infinite retry loop (copied from Step 3)
            const now = Date.now();
            if (window._lastExtendRetryTimestamp && (now - window._lastExtendRetryTimestamp) < 1000) {
              window._consecutiveExtendRetriesInSameSecond = (window._consecutiveExtendRetriesInSameSecond || 0) + 1;

              if (window._consecutiveExtendRetriesInSameSecond >= 3) {
                log('[Extend] ❌ ตรวจพบ infinite retry loop (retry 3 ครั้งภายใน 1 วินาที)', 'error');

                try {
                  chrome.runtime.sendMessage({
                    type: 'VIDEO_GEN_ERROR',
                    data: {
                      rowId: S.savedVideoRowId || S.automationData?.rowId,
                      error: 'Infinite retry loop detected in Step 4 - skipping row',
                      skipRow: true
                    }
                  });
                } catch (e) { }

                return STATES.ERROR;
              }
            } else {
              window._consecutiveExtendRetriesInSameSecond = 0;
            }
            window._lastExtendRetryTimestamp = now;

            // จำกัด retry 3 รอบรวม — ทุกรอบ simplify prompt ขึ้นระดับ
            if (window._extendRetryCount > 3) {
              log(`[Extend] ❌ Retry ครบ 3 รอบแล้ว — ข้ามคลิปนี้`, 'error');
              try {
                chrome.runtime.sendMessage({
                  type: 'EXTEND_VIDEO_ERROR',
                  data: {
                    rowId: S.savedVideoRowId || S.automationData?.rowId,
                    error: `Extend clip ${(window._extendCurrentCount || 0) + 1} failed after 3 retries`,
                    skipRow: false
                  }
                });
              } catch (e) {}
              return STATES.ERROR;
            }

            const simplifyLevel2 = window._extendRetryCount;  // 1, 2, 3
            log(`[Extend] ⚠️ Retry ${simplifyLevel2}/3 - ปรับ prompt ระดับ ${simplifyLevel2}`, 'warning');

            const currentIndex2 = window._extendCurrentCount || 0;
            let prompt2 = '';
            if (currentIndex2 === 0) {
              prompt2 = S.automationData?.videoPrompt2 || '';
            } else if (S.automationData?.extendVideoPrompts) {
              prompt2 = S.automationData.extendVideoPrompts[currentIndex2 - 1] || '';
            }
            if (prompt2) {
              if (simplifyLevel2 === 1) {
                prompt2 = prompt2.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
                prompt2 = prompt2.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s.,!?'"()-]/g, '');
                log('[Extend] 🔄 ระดับ 1: ลบ emoji และอักขระพิเศษ', 'info');
              } else if (simplifyLevel2 === 2) {
                prompt2 = prompt2.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
                prompt2 = prompt2.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s.,!?'"()-]/g, '');
                if (prompt2.length > 100) {
                  prompt2 = prompt2.substring(0, Math.floor(prompt2.length * 0.8));
                  const lastPeriod = Math.max(prompt2.lastIndexOf('.'), prompt2.lastIndexOf('ค่ะ'), prompt2.lastIndexOf('ครับ'));
                  if (lastPeriod > prompt2.length * 0.5) prompt2 = prompt2.substring(0, lastPeriod + 1);
                }
                log('[Extend] 🔄 ระดับ 2: ลดความยาว 80%', 'info');
              } else {
                prompt2 = 'พูดต่อเนื่องจากเดิม อธิบายสินค้าเพิ่มเติม';
                log('[Extend] 🔄 ระดับ 3: ใช้ prompt พื้นฐาน', 'info');
              }
              if (currentIndex2 === 0) {
                S.automationData.videoPrompt2 = prompt2;
              } else {
                S.automationData.extendVideoPrompts[currentIndex2 - 1] = prompt2;
              }
              log(`[Extend] 📝 Prompt ใหม่: ${prompt2.substring(0, 80)}...`, 'info');
            }

            // ปิด error popup + ซ่อน error elements
            const dismissBtn2 = document.querySelector('button[aria-label="Dismiss"]') ||
                                document.querySelector('button[aria-label="Close"]');
            if (dismissBtn2) { dismissBtn2.click(); await delay(500); }

            try {
              const errorLabels = document.querySelectorAll('*');
              let hiddenCount = 0;
              for (const el of errorLabels) {
                const directText = Array.from(el.childNodes)
                  .filter(node => node.nodeType === Node.TEXT_NODE)
                  .map(node => node.textContent.trim())
                  .join(' ');
                if (directText && (directText.includes('Failed Generation') || directText.includes('generation failed'))) {
                  el.style.display = 'none';
                  el.style.visibility = 'hidden';
                  hiddenCount++;
                }
              }
              if (hiddenCount > 0) {
                log(`[Extend] 🧹 ซ่อน error elements ${hiddenCount} อัน`, 'info');
              }
            } catch (cleanupError) {
              log('[Extend] ⚠️ ซ่อน error elements ไม่สำเร็จ (ไม่เป็นไร)', 'warning');
            }

            await delay(2000);
            window._generationStartTime = null;
            return STATES.EXTEND_FILL_PROMPT;
          }
          // else: ⏳ ไม่มี error + ไม่มี video → Continue polling (do nothing)
        }
      }

      // ตรวจสอบว่ามี video หรือยัง (สำหรับ progress gone no video case)
      if (progressGone && !newVideoUrl) {
          // ⚠️ Progress หายแต่ไม่พบ video = อาจเป็น Error (generation ล้มเหลวเงียบๆ)
          window._progressGoneNoVideoCount = (window._progressGoneNoVideoCount || 0) + 1;

          // ✅ CHANGED: รอ 12 รอบ (60 วินาที) ก่อนแจ้งเตือน, 24 รอบ (120 วินาที) ก่อน error
          if (window._progressGoneNoVideoCount >= 12) {
            // แจ้งเตือนที่ 60 วินาที
            if (window._progressGoneNoVideoCount === 12) {
              log('[Extend] ⚠️ Progress หายแต่ยังไม่พบ video (รอมา 60 วินาทีแล้ว)', 'warning');
            }

            // ถ้ารอถึง 120 วินาที (24 รอบ) ถึงจะถือว่า Error
            if (window._progressGoneNoVideoCount >= 24) {
              log(`[Extend] ❌ รอนานเกินไป (2 นาที) - ถือว่า Error`, 'error');

              // ส่ง error message แจ้งผู้ใช้
              try {
                chrome.runtime.sendMessage({
                  type: 'EXTEND_VIDEO_ERROR',
                  data: {
                    rowId: S.savedVideoRowId || S.automationData?.rowId,
                    error: 'ไม่พบ video ใหม่หลังจาก generation เสร็จ (รอมา 2 นาที)',
                    userAction: 'กรุณาตรวจสอบหน้าเว็บ หรือลองใหม่อีกครั้ง'
                  }
                });
              } catch (e) { }

              // ไม่ auto-retry อีกต่อ - ให้ผู้ใช้จัดการเอง
              return STATES.ERROR;
            } else {
              log(`[Step4] ⏳ ยังไม่พบ video (${window._progressGoneNoVideoCount}/24 รอบ, ${window._progressGoneNoVideoCount * 5}s) - กำลังรอต่อ...`, 'warning');
            }
          } else {
            log(`[Step4] ⚠️ ไม่พบ video ใหม่ (${window._progressGoneNoVideoCount}/12 รอบ) - รอ poll อีกรอบ...`, 'warning');
          }
        }

      if (newVideoUrl) {
        log(`🎉 Video Extend เสร็จใน ${elapsed / 1000} วินาที!`, 'success');
        // ✅ Reset retry counters เมื่อสำเร็จ
        chrome.storage.local.set({ google_flow_99_stuck_retry: 0 }).catch(() => {});
        stuckAt99StartTime = null;
        window._highDemandRetryCount = 0;  // Reset high demand counter
        window._audioFailedRetryCount = 0;  // Reset audio failed counter
        // เก็บ URL ไว้ให้ handleExtendGetBlobUrl ใช้
        window._extendNewVideoUrl = newVideoUrl;
        break;
      }

      // 3. (ไม่ส่ง progress — ลด noise ใน log)

      // 5. Wait and continue polling
      await delay(POLL_INTERVAL);
      elapsed += POLL_INTERVAL;
    }

    log('✅ Polling เสร็จสิ้น', 'success');
    return STATES.EXTEND_GET_BLOB_URL;
  }

  // Step 4.13: ดึง Video URL จาก storage.googleapis.com หรือ blob URL - FINAL STEP
  async function handleExtendGetBlobUrl() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

    // นับจำนวน extend ที่ทำสำเร็จ + reset retry counter
    window._extendCurrentCount = (window._extendCurrentCount || 0) + 1;
    window._extendRetryCount = 0;
    // extendClipCount = จำนวนคลิปรวม (เลือก 2 = 2 คลิปรวม = ทำ 1 extend)
    const targetCount = (S.automationData?.extendClipCount || 2) - 1;

    log(`📍 Step 4.13/14: ดึง Storage URL (Extend ${window._extendCurrentCount}/${targetCount})`, 'step');

    // ✅ เช็กว่า clip ถัดไปมี URL แล้วหรือยัง — ถ้ามีให้ข้ามไปเรื่อยๆ
    while (window._extendCurrentCount < targetCount) {
      const nextExtendNum = window._extendCurrentCount + 1;  // extend number ถัดไป (1-based)
      // extend #1 → existingVideoExtendUrl, extend #2+ → existingExtendVideoUrls[index-2]
      const nextExistingUrl = nextExtendNum === 1
        ? S.automationData?.existingVideoExtendUrl
        : S.automationData?.existingExtendVideoUrls?.[nextExtendNum - 2];
      if (!nextExistingUrl) break;  // ไม่มี URL — ต้อง extend จริง

      log(`⏭️ Extend #${nextExtendNum} มี URL แล้ว — ข้าม`, 'info');
      try {
        chrome.runtime.sendMessage({
          type: 'EXTENDED_VIDEO_URL_RESULT',
          data: {
            url: nextExistingUrl,
            rowId: S.savedVideoRowId || S.automationData?.rowId,
            extendCount: nextExtendNum,
            isIntermediate: true
          }
        });
      } catch (e) {}
      window._extendCurrentCount++;
      log(`📍 ข้ามไป Extend ${window._extendCurrentCount}/${targetCount}`, 'info');
    }

    await delay(2000);

    // =========== ถ้า polling เจอ video ใหม่แล้ว ใช้เลย ===========
    if (window._extendNewVideoUrl) {
      const foundUrl = window._extendNewVideoUrl;
      log(`✅ ใช้ Video URL ที่ polling พบแล้ว: ${foundUrl.substring(0, 80)}...`, 'success');
      // clear เพื่อไม่ให้ใช้ซ้ำ
      window._extendNewVideoUrl = null;
      window._extendExistingBlobUrls = null;
      window._extendExistingStorageIds = null;

      // ===== ตรวจสอบว่าต้อง extend อีกหรือไม่ =====
      if (window._extendCurrentCount < targetCount) {
        // ดาวน์โหลด intermediate URL ลงเครื่องก่อน (เพื่อให้ FFmpeg ใช้ได้)
        let intermediateUrl = foundUrl;
        try {
          if (foundUrl.startsWith('http')) {
            log(`📥 ดาวน์โหลด intermediate คลิป ${window._extendCurrentCount}/${targetCount} ลงเครื่อง...`, 'info');
            const resp = await fetch(foundUrl);
            const blob = await resp.blob();
            const reader = new FileReader();
            const b64Promise = new Promise((resolve, reject) => { reader.onloadend = () => resolve(reader.result); reader.onerror = reject; });
            reader.readAsDataURL(blob);
            const dUrl = await b64Promise;
            const b64 = dUrl.split(',')[1];
            const sKey = `video_extend_${S.automationData?.rowId}_${window._extendCurrentCount}`;
            await chrome.storage.local.set({ [sKey]: { base64: b64, mimeType: blob.type || 'video/mp4', size: blob.size, sourceUrl: foundUrl } });
            intermediateUrl = `storage:${sKey}`;
            log(`✅ เก็บ intermediate คลิปลง storage (${(blob.size / 1024 / 1024).toFixed(2)} MB)`, 'success');
          }
        } catch (e) {
          log(`⚠️ ดาวน์โหลด intermediate ไม่ได้ - ใช้ URL ตรงๆ: ${e.message}`, 'warning');
        }

        // ส่ง intermediate URL กลับเพื่ออัปเดท VDO Extend URL column
        try {
          chrome.runtime.sendMessage({
            type: 'EXTENDED_VIDEO_URL_RESULT',
            data: {
              url: intermediateUrl,
              videoExtendUrl: intermediateUrl,
              rowId: S.savedVideoRowId || S.automationData?.rowId,
              success: true,
              isPermanent: false,
              extendCount: window._extendCurrentCount,
              isIntermediate: true
            }
          });
          log(`📤 ส่ง intermediate URL กลับ (Extend ${window._extendCurrentCount}/${targetCount})`, 'info');
        } catch (e) {
          log('⚠️ ส่ง intermediate message ไม่ได้: ' + e.message, 'warning');
        }
        log(`🔄 Extend ${window._extendCurrentCount}/${targetCount} เสร็จ - ต้อง extend อีก ${targetCount - window._extendCurrentCount} คลิป`, 'info');
        log(`🔄 กำลังเริ่ม extend รอบที่ ${window._extendCurrentCount + 1}...`, 'info');
        await delay(3000);  // รอให้ UI พร้อม
        return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;  // กด + เพื่อ extend ต่อ
      }

      // ถ้าเป็น storage URL (permanent) → ดาวน์โหลดลงเครื่องก่อน แล้วส่ง storage key กลับ
      // (เพื่อให้ FFmpeg ใช้ได้ — URL อาจหมดอายุก่อน FFmpeg เริ่มทำงาน)
      if (foundUrl.includes('storage.googleapis.com')) {
        log('📥 googleapis URL - กำลังดาวน์โหลดลงเครื่อง...', 'info');
        try {
          const response = await fetch(foundUrl);
          const blob = await response.blob();
          log(`✅ ดาวน์โหลดสำเร็จ - size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`, 'success');

          // แปลง blob เป็น base64
          const reader = new FileReader();
          const base64Promise = new Promise((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
          });
          reader.readAsDataURL(blob);
          const dataUrl = await base64Promise;
          const base64 = dataUrl.split(',')[1];

          // เก็บลง chrome.storage.local
          const storageKey = `video_extend_${S.automationData?.rowId}_${window._extendCurrentCount}`;
          await chrome.storage.local.set({
            [storageKey]: {
              base64: base64,
              mimeType: blob.type || 'video/mp4',
              size: blob.size,
              sourceUrl: foundUrl
            }
          });
          log(`✅ เก็บ video ลง storage แล้ว (key: ${storageKey}, ${(blob.size / 1024 / 1024).toFixed(2)} MB)`, 'success');

          chrome.runtime.sendMessage({
            type: 'EXTENDED_VIDEO_URL_RESULT',
            data: {
              rowId: S.savedVideoRowId || S.automationData?.rowId,
              videoExtendUrl: `storage:${storageKey}`,
              url: `storage:${storageKey}`,
              success: true,
              size: blob.size,
              isPermanent: true,
              storageKey: storageKey,
              extendCount: window._extendCurrentCount
            }
          });
          log(`✅ ส่ง storage key กลับเรียบร้อย (ทำ extend ${window._extendCurrentCount} ครั้ง)`, 'success');
        } catch (e) {
          log(`⚠️ ดาวน์โหลดลงเครื่องไม่ได้ - ส่ง URL ตรงๆ แทน: ${e.message}`, 'warning');
          // Fallback: ส่ง googleapis URL ตรงๆ (อาจหมดอายุได้)
          try {
            chrome.runtime.sendMessage({
              type: 'EXTENDED_VIDEO_URL_RESULT',
              data: {
                url: foundUrl,
                videoExtendUrl: foundUrl,
                rowId: S.savedVideoRowId || S.automationData?.rowId,
                success: true,
                isPermanent: true,
                extendCount: window._extendCurrentCount
              }
            });
          } catch (e2) {
            log('ไม่สามารถส่ง message กลับได้: ' + e2.message, 'warning');
          }
        }
        return STATES.EXTEND_COMPLETE;
      }

      // ถ้าเป็น blob URL → ต้อง fetch และ convert เป็น base64 ก่อน!
      // (blob URL จะหมดอายุเมื่อ navigate ไปหน้าอื่น)

      // ===== ถ้ายังต้อง extend อีก → ดาวน์โหลดลงเครื่องก่อน แล้ววนไปทำ extend ต่อ =====
      if (window._extendCurrentCount < targetCount) {
        // ดาวน์โหลด blob URL ลงเครื่อง (เพื่อให้ FFmpeg ใช้ได้)
        let intermediateUrl = foundUrl;
        try {
          log(`📥 ดาวน์โหลด intermediate blob คลิป ${window._extendCurrentCount}/${targetCount} ลงเครื่อง...`, 'info');
          const resp = await fetch(foundUrl);
          const blob = await resp.blob();
          const reader = new FileReader();
          const b64Promise = new Promise((resolve, reject) => { reader.onloadend = () => resolve(reader.result); reader.onerror = reject; });
          reader.readAsDataURL(blob);
          const dUrl = await b64Promise;
          const b64 = dUrl.split(',')[1];
          const sKey = `video_extend_${S.automationData?.rowId}_${window._extendCurrentCount}`;
          await chrome.storage.local.set({ [sKey]: { base64: b64, mimeType: blob.type || 'video/mp4', size: blob.size, sourceUrl: foundUrl } });
          intermediateUrl = `storage:${sKey}`;
          log(`✅ เก็บ intermediate blob ลง storage (${(blob.size / 1024 / 1024).toFixed(2)} MB)`, 'success');
        } catch (e) {
          log(`⚠️ ดาวน์โหลด intermediate blob ไม่ได้ - ใช้ blob URL ตรงๆ: ${e.message}`, 'warning');
        }

        try {
          chrome.runtime.sendMessage({
            type: 'EXTENDED_VIDEO_URL_RESULT',
            data: {
              url: intermediateUrl,
              videoExtendUrl: intermediateUrl,
              rowId: S.savedVideoRowId || S.automationData?.rowId,
              success: true,
              isPermanent: false,
              extendCount: window._extendCurrentCount,
              isIntermediate: true
            }
          });
          log(`📤 ส่ง intermediate URL กลับ (Extend ${window._extendCurrentCount}/${targetCount})`, 'info');
        } catch (e) {
          log('⚠️ ส่ง intermediate message ไม่ได้: ' + e.message, 'warning');
        }
        log(`🔄 ต้อง extend อีก ${targetCount - window._extendCurrentCount} คลิป - กำลังเริ่มรอบถัดไป...`, 'info');
        await delay(3000);  // รอให้ UI พร้อม
        return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;  // กด + เพื่อ extend ต่อ
      }

      // ===== Extend ครบแล้ว → เก็บ blob เป็น base64 =====
      log('⚠️ blob URL - กำลัง fetch และเก็บ base64...', 'warning');
      try {
        const response = await fetch(foundUrl);
        const blob = await response.blob();
        log(`✅ Fetch blob สำเร็จ - size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`, 'success');

        // แปลง blob เป็น base64
        const reader = new FileReader();
        const base64Promise = new Promise((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
        });
        reader.readAsDataURL(blob);

        const dataUrl = await base64Promise;
        const base64 = dataUrl.split(',')[1];

        log(`✅ แปลง base64 สำเร็จ - length: ${base64.length}`, 'success');

        // เก็บลง chrome.storage.local
        const storageKey = `video_extend_${S.automationData?.rowId}_${window._extendCurrentCount}`;
        await chrome.storage.local.set({
          [storageKey]: {
            base64: base64,
            mimeType: blob.type || 'video/mp4',
            size: blob.size,
            sourceUrl: foundUrl
          }
        });

        log(`✅ เก็บ video extend ลง storage แล้ว (key: ${storageKey})`, 'success');

        // ส่ง storage key กลับแทน blob URL
        chrome.runtime.sendMessage({
          type: 'EXTENDED_VIDEO_URL_RESULT',
          data: {
            rowId: S.savedVideoRowId || S.automationData?.rowId,
            videoExtendUrl: `storage:${storageKey}`,
            url: `storage:${storageKey}`,
            success: true,
            size: blob.size,
            isPermanent: false,
            storageKey: storageKey,
            extendCount: window._extendCurrentCount
          }
        });
        log(`✅ ส่ง storage key กลับเรียบร้อย (ทำ extend ${window._extendCurrentCount} ครั้ง)`, 'success');
        return STATES.EXTEND_COMPLETE;

      } catch (e) {
        log(`❌ Error fetching blob: ${e.message}`, 'error');
        chrome.runtime.sendMessage({
          type: 'EXTENDED_VIDEO_URL_RESULT',
          data: {
            rowId: S.savedVideoRowId || S.automationData?.rowId,
            success: false,
            error: e.message
          }
        });
        return STATES.ERROR;
      }
    }

    // =========== ถ้า polling ไม่เจอ → หาใหม่จาก DOM ===========
    // =========== ลองหา storage.googleapis.com URL ก่อน (URL ถาวร) ===========
    let permanentUrl = null;

    // หา video ที่มี storage.googleapis.com URL (timeline หรือที่อื่น)
    const storageVideos = document.querySelectorAll('video[src*="storage.googleapis.com"]');
    log(`พบ video ที่มี storage URL: ${storageVideos.length} อัน`, 'info');

    if (storageVideos.length > 0) {
      // เลือก video ตัวล่าสุด (ตัวแรกในลิสต์ = ล่าสุด)
      // หรือตัวที่ใหญ่ที่สุดถ้าอยู่ใน preview panel
      for (const video of storageVideos) {
        const rect = video.getBoundingClientRect();
        const size = rect.width * rect.height;
        log(`Storage video size: ${rect.width}x${rect.height} = ${size}, src: ${video.src.substring(0, 80)}...`, 'info');

        // ถ้าเจอ video ที่มี size > 0 (visible) ใช้ตัวนั้น
        if (size > 0 || !permanentUrl) {
          permanentUrl = video.src;
        }
      }

      if (permanentUrl) {
        log(`✅ พบ Permanent URL: ${permanentUrl.substring(0, 100)}...`, 'success');
      }
    }

    // =========== ถ้าไม่เจอ permanent URL → ใช้ blob URL และเก็บเป็น base64 ===========
    let blobUrl = null;

    if (!permanentUrl) {
      log('ไม่พบ storage URL - ลองหา blob URL...', 'info');

      // หา video element ที่มี blob URL - ต้องเป็นตัวใหญ่ใน preview panel (ขวา)
      const videos = document.querySelectorAll('video[src^="blob:"]');
      log(`พบ video elements ที่มี blob URL: ${videos.length} อัน`, 'info');

      if (videos.length > 0) {
        // หา video ที่ใหญ่ที่สุด (preview panel) ไม่ใช่ตัวเล็กใน timeline
        let largestVideo = null;
        let largestSize = 0;

        for (const video of videos) {
          const rect = video.getBoundingClientRect();
          const size = rect.width * rect.height;
          log(`Video size: ${rect.width}x${rect.height} = ${size}`, 'info');

          // เลือก video ที่ใหญ่กว่า 50000 pixels (ประมาณ 250x200 ขึ้นไป)
          if (size > largestSize && size > 50000) {
            largestSize = size;
            largestVideo = video;
          }
        }

        if (largestVideo) {
          blobUrl = largestVideo.src;
          log(`เลือก video ที่ใหญ่ที่สุด: ${largestSize} pixels`, 'success');
          log(`พบ blob URL: ${blobUrl.substring(0, 50)}...`, 'success');
        } else {
          // Fallback: ใช้ตัวแรก
          blobUrl = videos[0].src;
          log(`ใช้ video ตัวแรก (fallback): ${blobUrl.substring(0, 50)}...`, 'warning');
        }
      }
    }

    // =========== ไม่เจอทั้ง permanent และ blob URL ===========
    if (!permanentUrl && !blobUrl) {
      log('❌ ไม่พบ URL ใน video element', 'error');
      log('💡 จะใช้ Video URL จาก Step 3 แทน (VDO 1 อย่างเดียว)', 'warning');
      return STATES.DONE;
    }

    // ===== ตรวจสอบว่าต้อง extend อีกหรือไม่ (DOM path) =====
    if (window._extendCurrentCount < targetCount) {
      // ส่ง intermediate URL กลับ (DOM path — ใช้ permanentUrl หรือ blobUrl ที่หาเจอ)
      const domFoundUrl = permanentUrl || blobUrl;
      if (domFoundUrl) {
        try {
          chrome.runtime.sendMessage({
            type: 'EXTENDED_VIDEO_URL_RESULT',
            data: {
              url: domFoundUrl,
              videoExtendUrl: domFoundUrl,
              rowId: S.savedVideoRowId || S.automationData?.rowId,
              success: true,
              isPermanent: !!permanentUrl,
              extendCount: window._extendCurrentCount,
              isIntermediate: true
            }
          });
          log(`📤 ส่ง intermediate URL กลับ (DOM path, Extend ${window._extendCurrentCount}/${targetCount})`, 'info');
        } catch (e) {
          log('⚠️ ส่ง intermediate message ไม่ได้: ' + e.message, 'warning');
        }
      }
      log(`🔄 ต้อง extend อีก ${targetCount - window._extendCurrentCount} คลิป (DOM path) - กำลังเริ่มรอบถัดไป...`, 'info');
      await delay(3000);  // รอให้ UI พร้อม
      return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;  // กด + เพื่อ extend ต่อ
    }

    // =========== ถ้ามี permanent URL → ใช้เลย ไม่ต้อง fetch blob ===========
    if (permanentUrl) {
      log('🎯 ใช้ Permanent URL (storage.googleapis.com)', 'success');

      chrome.runtime.sendMessage({
        type: 'EXTENDED_VIDEO_URL_RESULT',
        data: {
          rowId: S.savedVideoRowId || S.automationData?.rowId,
          videoExtendUrl: permanentUrl,
          url: permanentUrl,
          success: true,
          isPermanent: true,
          extendCount: window._extendCurrentCount
        }
      });

      log(`✅ ส่ง Permanent URL กลับเรียบร้อย (ทำ extend ${window._extendCurrentCount} ครั้ง)`, 'success');

    } else {
      // =========== ใช้ blob URL - ต้อง fetch และเก็บ base64 ===========
      log('⚠️ ใช้ blob URL - กำลัง fetch และเก็บ base64...', 'warning');

      try {
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        log(`✅ Fetch blob สำเร็จ - size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`, 'success');

        // แปลง blob เป็น base64
        const reader = new FileReader();
        const base64Promise = new Promise((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
        });
        reader.readAsDataURL(blob);

        const dataUrl = await base64Promise;
        const base64 = dataUrl.split(',')[1];

        log(`✅ แปลง base64 สำเร็จ - length: ${base64.length}`, 'success');

        // เก็บลง chrome.storage.local
        const storageKey = `video_extend_${S.automationData?.rowId}`;
        await chrome.storage.local.set({
          [storageKey]: {
            base64: base64,
            mimeType: blob.type || 'video/mp4',
            size: blob.size,
            blobUrl: blobUrl
          }
        });

        log(`✅ เก็บ video extend ลง storage แล้ว (key: ${storageKey})`, 'success');

        // ส่ง storage key กลับแทน blob URL
        chrome.runtime.sendMessage({
          type: 'EXTENDED_VIDEO_URL_RESULT',
          data: {
            rowId: S.savedVideoRowId || S.automationData?.rowId,
            videoExtendUrl: `storage:${storageKey}`,
            url: `storage:${storageKey}`,
            success: true,
            size: blob.size,
            isPermanent: false,
            storageKey: storageKey,
            extendCount: window._extendCurrentCount
          }
        });

        log(`✅ ส่ง storage key กลับเรียบร้อย (ทำ extend ${window._extendCurrentCount} ครั้ง)`, 'success');

      } catch (e) {
        log(`❌ Error fetching blob: ${e.message}`, 'error');

        chrome.runtime.sendMessage({
          type: 'EXTENDED_VIDEO_URL_RESULT',
          data: {
            rowId: S.savedVideoRowId || S.automationData?.rowId,
            success: false,
            error: e.message
          }
        });

        return STATES.ERROR;
      }
    }

    // ส่ง message ว่า Extended Mode เสร็จสมบูรณ์
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('🎉 Step 4 Extend Video เสร็จสมบูรณ์!', 'success');

    chrome.runtime.sendMessage({
      type: 'EXTENDED_VIDEO_COMPLETE',
      data: {
        rowId: S.savedVideoRowId || S.automationData?.rowId,
        success: true,
        extendCount: window._extendCurrentCount
      }
    });

    return STATES.DONE;
  }

  // Step 4.1: กดปุ่ม "Arrange" (flex_no_wrap icon) - ย้ายมาทำตอนแรก
  async function handleExtendClickArrange() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.1/14: กดปุ่ม "Arrange"', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    // หาปุ่ม Arrange จาก icon flex_no_wrap
    let arrangeBtn = findButtonByIcon('flex_no_wrap');

    if (!arrangeBtn) {
      // ลองหาจาก text "Arrange"
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.toLowerCase().includes('arrange')) {
          arrangeBtn = btn;
          break;
        }
      }
    }

    if (!arrangeBtn) {
      log('⚠️ ไม่พบปุ่ม "Arrange" - ข้ามไปลบ clips', 'warning');
      return STATES.EXTEND_DELETE_CLIPS;
    }

    humanClick(arrangeBtn);
    log('✅ กดปุ่ม "Arrange" แล้ว', 'success');

    await delay(1000);
    return STATES.EXTEND_DELETE_CLIPS;
  }

  // Step 4.2: ลบ clips จนหมด - ย้ายมาทำตอนแรก
  async function handleExtendDeleteClips() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.2/14: ลบ clips ออกจนหมด', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    // === รอบ 1: ลบ clips ===
    let deletedCount = await deleteAllClipsInSceneBuilder();
    log(`รอบ 1: ลบได้ ${deletedCount} clips`, 'info');

    // === รอแล้วลบ clips รอบ 2 (ถ้ามีค้าง) ===
    await delay(2000);
    const deletedCount2 = await deleteAllClipsInSceneBuilder();
    if (deletedCount2 > 0) {
      log(`⚠️ รอบ 2: ลบเพิ่มอีก ${deletedCount2} clips (ที่ค้าง)`, 'warning');
      deletedCount += deletedCount2;
    }

    log(`✅ ลบ clips ทั้งหมด ${deletedCount} อัน - SceneBuilder ว่างแล้ว`, 'success');

    // ตรวจว่ามีรูปสินค้า (pictureUrl) สำหรับ Frames to Video หรือไม่
    const hasImageForSB = ctx.lastPictureUrl || window._lastPictureUrl || S.automationData?.pictureUrl || S.automationData?.productImageUrl;
    // ข้าม Upload Image — ไปใส่ Video Prompt เลย
    log('⚠️ ไม่มีรูปสินค้า — ข้ามไปใส่ Video Prompt', 'warning');
    return STATES.EXTEND_SB_FILL_PROMPT;
  }

  // Helper: ลบ clips ทั้งหมดใน SceneBuilder
  async function deleteAllClipsInSceneBuilder() {
    let count = 0;
    const maxAttempts = 20; // ป้องกัน infinite loop

    for (let i = 0; i < maxAttempts; i++) {
      const deleteBtn = findButtonByIcon('remove') || findButtonByIcon('delete') || findButtonByIcon('close');
      if (!deleteBtn) {
        break;
      }
      humanClick(deleteBtn);
      count++;
      log(`✅ ลบ clip ${count}`, 'success');
      await delay(800); // รอให้ UI อัพเดท
    }

    return count;
  }

  // Step 4.2.5: อัปโหลดรูปสินค้าเข้า SceneBuilder → Frames to Video → สร้างวิดีโอแรก
  async function handleExtendUploadImage() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.2.5: อัปโหลดรูปสินค้าเข้า SceneBuilder (Frames to Video)', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    // หารูปสินค้า (ลำดับ: Step 2 URL → window backup → pictureUrl → productImageUrl)
    const imageUrl = ctx.lastPictureUrl || window._lastPictureUrl || S.automationData?.pictureUrl || S.automationData?.productImageUrl;
    if (!imageUrl) {
      log('⚠️ ไม่มีรูปสินค้า — ข้ามไปใส่ Video Prompt', 'warning');
      return STATES.EXTEND_SB_FILL_PROMPT;
    }

    // ===== 1. ดาวน์โหลดรูปจาก URL =====
    log(`📥 กำลังดาวน์โหลดรูปจาก: ${imageUrl.substring(0, 80)}...`, 'info');
    let imageFile = null;
    try {
      imageFile = await imageToFile(imageUrl, 'product_image.png');
      if (!imageFile) throw new Error('imageToFile returned null');
      log(`✅ ดาวน์โหลดรูปสำเร็จ — ขนาด: ${(imageFile.size / 1024).toFixed(1)} KB`, 'success');
    } catch (err) {
      log(`❌ ดาวน์โหลดรูปไม่สำเร็จ: ${err.message} — fallback ไปหน้า Flow`, 'error');
      return STATES.EXTEND_GO_BACK;
    }

    // ===== 2. กดแท็บ "Frames" =====
    log('🔍 กดแท็บ "Frames" ...', 'info');
    let framesTab2 = null;
    const ftTabs2 = document.querySelectorAll('button[role="tab"], button[role="radio"]');
    for (const tab of ftTabs2) {
      const text = tab.textContent?.trim().toLowerCase() || '';
      const icon = tab.querySelector('i.google-symbols, i.material-icons');
      if (text.includes('frames') || icon?.textContent?.trim() === 'crop_free') {
        framesTab2 = tab;
        break;
      }
    }
    // Legacy fallback: combobox dropdown
    if (!framesTab2) {
      const modeDropdown = document.querySelector('button[role="combobox"]');
      if (modeDropdown) {
        const currentModeText = modeDropdown.textContent?.trim().toLowerCase() || '';
        if (!currentModeText.includes('frames to video')) {
          humanClick(modeDropdown);
          await delay(1500);
          const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="option"], li[role="option"], [data-radix-collection-item]');
          for (const item of menuItems) {
            if (item.textContent?.toLowerCase().includes('frames to video')) {
              framesTab2 = item;
              break;
            }
          }
        } else {
          log('✅ อยู่โหมด "Frames to Video" อยู่แล้ว', 'info');
        }
      }
    }
    if (framesTab2) {
      const state = framesTab2.getAttribute('data-state');
      if (state === 'active' || state === 'on') {
        log('✅ อยู่ที่แท็บ Frames อยู่แล้ว', 'info');
      } else {
        humanClick(framesTab2);
        log('✅ กดแท็บ Frames แล้ว', 'success');
        await delay(2000);
      }
    } else {
      log('⚠️ หาแท็บ Frames ไม่เจอ — ลองต่อไป', 'warning');
    }

    // ===== 3. กดปุ่ม + (Add clip) ใน Frames to Video =====
    log('🔍 หาปุ่ม + (add) ...', 'info');
    let addBtn = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const addBtns = [];
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const icon = btn.querySelector('i.google-symbols, i.material-icons');
        if (icon && icon.textContent?.trim() === 'add') {
          addBtns.push(btn);
        }
      }
      if (addBtns.length > 0) {
        addBtns.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        addBtn = addBtns[0];
        break;
      }
      addBtn = document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID');
      if (addBtn) break;

      log(`⏳ หาปุ่ม + ไม่เจอ (attempt ${attempt + 1}/10)`, 'info');
      await delay(1500);
    }

    if (!addBtn) {
      log('❌ หาปุ่ม + ไม่เจอ — fallback ไปหน้า Flow', 'error');
      return STATES.EXTEND_GO_BACK;
    }

    log('✅ พบปุ่ม + — กดเลย', 'success');
    humanClick(addBtn);
    await delay(2000);

    // ===== 4. กดปุ่ม Upload =====
    log('🔍 หาปุ่ม Upload ...', 'info');
    let uploadBtn = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const icon = btn.querySelector('i.google-symbols, i.material-icons, i.material-icons-outlined');
        if (icon && icon.textContent?.trim() === 'upload') {
          uploadBtn = btn;
          break;
        }
        if (btn.textContent?.trim().toLowerCase() === 'upload' || btn.textContent?.includes('Upload')) {
          uploadBtn = btn;
          break;
        }
      }
      if (uploadBtn) break;
      log(`⏳ หาปุ่ม Upload ไม่เจอ (attempt ${attempt + 1}/10)`, 'info');
      await delay(1000);
    }

    if (!uploadBtn) {
      log('❌ หาปุ่ม Upload ไม่เจอ — fallback ไปหน้า Flow', 'error');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(500);
      return STATES.EXTEND_GO_BACK;
    }

    log('✅ พบปุ่ม Upload — กดเลย', 'success');
    humanClick(uploadBtn);
    await delay(1500);

    // ===== 5. หา file input แล้ว set ไฟล์รูป =====
    log('🔍 หา file input ...', 'info');
    let fileInput = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const inputs = document.querySelectorAll('input[type="file"]');
      if (inputs.length > 0) {
        fileInput = inputs[inputs.length - 1];
        break;
      }
      log(`⏳ หา file input ไม่เจอ (attempt ${attempt + 1}/10)`, 'info');
      await delay(1000);
    }

    if (!fileInput) {
      log('❌ หา file input ไม่เจอ — fallback ไปหน้า Flow', 'error');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await delay(500);
      return STATES.EXTEND_GO_BACK;
    }

    log('✅ พบ file input — กำลัง set ไฟล์รูป', 'success');

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(imageFile);
    fileInput.files = dataTransfer.files;

    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));

    log('✅ Set ไฟล์รูปใน file input แล้ว — รอ Crop dialog', 'success');
    await delay(3000);

    // ===== 6. จัดการ "Crop your ingredient" dialog =====
    // รอให้ Crop dialog ปรากฏ (มีข้อความ "Crop your ingredient" หรือปุ่ม "Crop and Save")
    let cropDialogFound = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const cropSaveBtn = Array.from(document.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('Crop and Save') || btn.textContent?.includes('Crop')
      );
      if (cropSaveBtn) {
        cropDialogFound = true;
        log('✅ พบ Crop dialog', 'success');
        break;
      }
      log(`⏳ รอ Crop dialog... (attempt ${attempt + 1}/10)`, 'info');
      await delay(1500);
    }

    if (cropDialogFound) {
      // 6a. เลือก Portrait จาก combobox (ถ้ายังไม่ใช่ Portrait)
      log('🔍 เลือก Portrait ...', 'info');
      // หา combobox ที่อยู่ใกล้ปุ่ม "Crop and Save" (ภายใน dialog เดียวกัน)
      let cropCombobox = null;
      const cropSaveBtnForScope = Array.from(document.querySelectorAll('button')).find(
        btn => btn.textContent?.includes('Crop and Save')
      );
      if (cropSaveBtnForScope) {
        // หา dialog container ที่ครอบ Crop and Save button
        let dialogContainer = cropSaveBtnForScope.closest('[role="dialog"]')
          || cropSaveBtnForScope.closest('mat-dialog-container')
          || cropSaveBtnForScope.closest('.cdk-overlay-pane')
          || cropSaveBtnForScope.parentElement?.parentElement?.parentElement?.parentElement;
        if (dialogContainer) {
          cropCombobox = dialogContainer.querySelector('button[role="combobox"]');
          log(`📍 หา combobox ภายใน dialog container: ${cropCombobox ? 'เจอ' : 'ไม่เจอ'}`, 'info');
        }
      }
      // Fallback: หาจากทั้งหน้า
      if (!cropCombobox) {
        cropCombobox = document.querySelector('button[role="combobox"]');
        log(`📍 Fallback หา combobox จากทั้งหน้า: ${cropCombobox ? 'เจอ' : 'ไม่เจอ'}`, 'info');
      }
      if (cropCombobox) {
        const currentCropMode = cropCombobox.textContent?.trim().toLowerCase() || '';
        if (!currentCropMode.includes('portrait')) {
          log('📋 กดเปิด dropdown เลือก Portrait...', 'info');
          humanClick(cropCombobox);
          await delay(1000);

          // หา "Portrait" option
          let portraitItem = null;
          const menuItems = document.querySelectorAll('div[role="menuitem"], div[role="option"], li[role="option"], [data-radix-collection-item]');
          for (const item of menuItems) {
            if (item.textContent?.toLowerCase().includes('portrait')) {
              portraitItem = item;
              break;
            }
          }
          if (!portraitItem) {
            // Fallback: หาจาก text ทั่วไป
            const allEls = document.querySelectorAll('div, li, button, span');
            for (const el of allEls) {
              if (el.children.length <= 2 && el.textContent?.trim() === 'Portrait') {
                portraitItem = el;
                break;
              }
            }
          }
          if (portraitItem) {
            humanClick(portraitItem);
            log('✅ เลือก "Portrait" แล้ว', 'success');
            await delay(1500);
          } else {
            log('⚠️ หา "Portrait" ไม่เจอ — ใช้ค่าปัจจุบัน', 'warning');
          }
        } else {
          log('✅ อยู่ Portrait อยู่แล้ว', 'info');
        }
      } else {
        log('⚠️ หา crop combobox ไม่เจอ — ข้ามไป', 'warning');
      }

      // 6b. กด "Crop and Save"
      log('🔍 หาปุ่ม "Crop and Save" ...', 'info');
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
        humanClick(cropSaveBtn);
        log('✅ กด "Crop and Save" แล้ว', 'success');
        await delay(3000); // รอ crop + save เสร็จ
      } else {
        log('⚠️ หาปุ่ม "Crop and Save" ไม่เจอ — ลองต่อไป', 'warning');
      }
    } else {
      log('⚠️ ไม่พบ Crop dialog — อาจไม่ต้อง crop (ลองต่อไป)', 'warning');
    }

    // ===== 7. รอรูปปรากฏ + โหลดเสร็จจริงใน SceneBuilder =====
    log('⏳ รอรูปปรากฏใน SceneBuilder...', 'info');
    let imageFullyLoaded = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      // ตรวจหลายแบบ: img ทุกประเภท, remove button (มี clip แล้ว)
      const storageImgs = document.querySelectorAll('img[src*="storage.googleapis.com"]');
      const blobImgs = document.querySelectorAll('img[src*="blob:"]');
      const dataImgs = document.querySelectorAll('img[src*="data:image"]');
      const allImgs = document.querySelectorAll('img');
      const removeBtn = findButtonByIcon('remove');

      // หา img ที่โหลดเสร็จจริงๆ (complete + naturalWidth > 0)
      const fullyLoadedImgs = Array.from(allImgs).filter(
        img => img.src && img.src.length > 50 && img.complete && img.naturalWidth > 50
      );

      // ตรวจ loading indicator (spinner/progress ที่เกี่ยวกับรูป)
      const loadingSpinners = document.querySelectorAll(
        'mat-spinner, mat-progress-spinner, [role="progressbar"], .loading, .spinner'
      );
      const hasLoadingIndicator = loadingSpinners.length > 0;

      if (fullyLoadedImgs.length > 0 && !hasLoadingIndicator) {
        imageFullyLoaded = true;
        log(`✅ รูปโหลดเสร็จแล้ว (loaded:${fullyLoadedImgs.length}, storage:${storageImgs.length}, blob:${blobImgs.length})`, 'success');
        break;
      }

      // ถ้ามี remove button (= มี clip ใน timeline แล้ว) ถือว่าพร้อม
      if (removeBtn) {
        imageFullyLoaded = true;
        log('✅ พบ remove button (clip อยู่ใน timeline แล้ว) — รูปพร้อม', 'success');
        break;
      }

      // ถ้าเจอ img แต่ยังโหลดไม่เสร็จ → log แจ้ง
      const pendingImgs = Array.from(allImgs).filter(
        img => img.src && img.src.length > 50 && !img.complete
      );
      if (pendingImgs.length > 0) {
        log(`⏳ พบรูป ${pendingImgs.length} รูปกำลังโหลด... (attempt ${attempt + 1}/30)`, 'info');
      } else if (storageImgs.length > 0 || blobImgs.length > 0 || dataImgs.length > 0) {
        // มี img src แต่ complete แล้ว — ตรวจ naturalWidth
        const smallImgs = Array.from(allImgs).filter(
          img => img.src && img.src.length > 50 && img.complete && img.naturalWidth <= 50
        );
        if (smallImgs.length > 0) {
          log(`⏳ รูปโหลดแล้วแต่ขนาดเล็กเกิน (${smallImgs.length} รูป) — รอ... (attempt ${attempt + 1}/30)`, 'info');
        } else {
          log(`⏳ รอรูป... (attempt ${attempt + 1}/30)`, 'info');
        }
      } else {
        log(`⏳ ยังไม่เจอรูป... (attempt ${attempt + 1}/30)`, 'info');
      }

      await delay(2000);
    }

    if (!imageFullyLoaded) {
      log('⚠️ รูปยังโหลดไม่เสร็จ — รอเพิ่มอีก 10 วินาทีแล้วลองต่อ', 'warning');
      await delay(10000);
    }

    // รอเพิ่มอีก 3 วินาทีให้ SceneBuilder process รูปเสร็จสมบูรณ์
    log('⏳ รอ SceneBuilder process รูป...', 'info');
    await delay(3000);

    log('🎬 รูปพร้อมแล้ว — ไปใส่ Video Prompt', 'success');
    return STATES.EXTEND_SB_FILL_PROMPT;
  }

  // Step 4.2.6: ใส่ Video Prompt ใน SceneBuilder (สำหรับสร้างวิดีโอแรก)
  async function handleExtendSBFillPrompt() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.2.6: ใส่ Video Prompt ใน SceneBuilder', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    // ใช้ videoPrompt (prompt วิดีโอแรก) จาก S.automationData
    const prompt = S.automationData?.videoPrompt || S.automationData?.videoPrompt2 || '';
    if (!prompt) {
      log('❌ ไม่มี Video Prompt สำหรับสร้างวิดีโอแรก', 'error');
      return STATES.EXTEND_GO_BACK;
    }

    log(`📝 Video Prompt: "${prompt.substring(0, 100)}..."`, 'info');

    // หา textarea จาก ID
    let promptInput = document.querySelector('#PINHOLE_TEXT_AREA_ELEMENT_ID');

    if (!promptInput) {
      promptInput = document.querySelector('textarea[placeholder*="prompt"]');
    }
    if (!promptInput) {
      promptInput = document.querySelector('textarea[placeholder*="Describe"]');
    }
    if (!promptInput) {
      // Fallback: หา textarea ที่มีอยู่
      const textareas = document.querySelectorAll('textarea');
      if (textareas.length > 0) {
        promptInput = textareas[textareas.length - 1];
      }
    }

    if (!promptInput) {
      log('❌ ไม่พบ textarea สำหรับใส่ prompt', 'error');
      return STATES.EXTEND_GO_BACK;
    }

    // Focus and set value
    promptInput.focus();
    await delay(300);

    // Clear existing text
    promptInput.value = '';
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Set prompt using nativeInputValueSetter (React compatibility)
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(promptInput, prompt);
    } else {
      promptInput.value = prompt;
    }
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
    promptInput.dispatchEvent(new Event('change', { bubbles: true }));

    log('✅ ใส่ Video Prompt แล้ว', 'success');
    await delay(1000);

    return STATES.EXTEND_SB_CLICK_CREATE;
  }

  // Step 4.2.7: กดปุ่ม Create ใน SceneBuilder (สร้างวิดีโอแรกจากรูป)
  async function handleExtendSBClickCreate() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.2.7: กดปุ่ม "Create" ใน SceneBuilder', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    // หาปุ่ม Create — ลองหลายวิธี
    let createBtn = null;

    // วิธี 1: หาจาก icon arrow_forward
    createBtn = findButtonByIcon('arrow_forward');
    if (createBtn) {
      log('🔍 พบปุ่ม Create จาก icon arrow_forward', 'info');
    }

    // วิธี 2: หาจาก span ที่มีข้อความ "Create" ภายใน button
    if (!createBtn) {
      const spans = document.querySelectorAll('button span');
      for (const span of spans) {
        if (span.textContent.trim().toLowerCase() === 'create') {
          createBtn = span.closest('button');
          if (createBtn) {
            log('🔍 พบปุ่ม Create จาก span text', 'info');
            break;
          }
        }
      }
    }

    // วิธี 3: หาจาก button ที่มี class pattern ตรง
    if (!createBtn) {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.toLowerCase().includes('create') && btn.querySelector('i')) {
          createBtn = btn;
          log('🔍 พบปุ่ม Create จาก button text + icon', 'info');
          break;
        }
      }
    }

    if (!createBtn) {
      log('❌ ไม่พบปุ่ม "Create" — ลอง fallback', 'error');
      return STATES.EXTEND_GO_BACK;
    }

    // จับ existing videos ก่อนกด Create
    const existingBlobVideos = document.querySelectorAll('video[src^="blob:"]');
    const existingStorageVideos = document.querySelectorAll('video[src*="storage.googleapis.com"]');
    window._extendSBExistingBlobUrls = new Set(Array.from(existingBlobVideos).map(v => v.src));
    window._extendSBExistingStorageIds = new Set(Array.from(existingStorageVideos).map(v => extractVideoId(v.src)));
    log(`📊 มี video เดิม: blob ${window._extendSBExistingBlobUrls.size} อัน, storage ${window._extendSBExistingStorageIds.size} อัน`, 'info');

    // Capture timestamp
    window._sbGenerationStartTime = Date.now();

    // Snapshot error elements
    window._extendSBExistingErrorElements = snapshotExistingErrors();
    log(`📸 Snapshot error elements เดิม: ${window._extendSBExistingErrorElements.size} อัน`, 'info');

    // Scroll ปุ่มเข้ามาใน viewport ก่อน click
    createBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
    await delay(500);

    // กดปุ่ม Create — ใช้ทั้ง humanClick + PointerEvent + .click() เพื่อให้ชัวร์
    log('🖱️ กำลังกดปุ่ม Create...', 'info');
    humanClick(createBtn);
    await delay(300);

    // เพิ่ม PointerEvent (React ใช้ pointer events)
    const rect = createBtn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    ['pointerdown', 'pointerup'].forEach(type => {
      createBtn.dispatchEvent(new PointerEvent(type, {
        view: window, bubbles: true, cancelable: true,
        clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse'
      }));
    });
    await delay(300);

    // Fallback: .click()
    createBtn.click();

    log('✅ กดปุ่ม "Create" แล้ว (humanClick + PointerEvent + .click()) - รอ Generate วิดีโอแรก', 'success');

    // รอดู progress สักครู่ — ถ้า 15 วินาทีแล้วไม่มี progress ให้ลองกดอีกครั้ง
    await delay(15000);
    const allDivs = document.querySelectorAll('div');
    let hasProgress = false;
    for (const div of allDivs) {
      if (div.children.length === 0) {
        const text = div.innerText?.trim();
        if (text && /^\d+%$/.test(text)) {
          hasProgress = true;
          break;
        }
      }
    }
    // ตรวจว่ามี video ใหม่หรือยัง
    const newBlobCheck = document.querySelectorAll('video[src^="blob:"]');
    const hasNewVideo = newBlobCheck.length > (existingBlobVideos?.length || 0);

    if (!hasProgress && !hasNewVideo) {
      log('⚠️ ไม่พบ progress หลังกด Create 15 วินาที — ลองกดอีกครั้ง', 'warning');
      // หาปุ่มอีกครั้ง (อาจ re-render)
      let retryBtn = findButtonByIcon('arrow_forward');
      if (!retryBtn) {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.textContent.toLowerCase().includes('create')) {
            retryBtn = btn;
            break;
          }
        }
      }
      if (retryBtn) {
        retryBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
        await delay(500);
        humanClick(retryBtn);
        await delay(300);
        const rect2 = retryBtn.getBoundingClientRect();
        ['pointerdown', 'pointerup'].forEach(type => {
          retryBtn.dispatchEvent(new PointerEvent(type, {
            view: window, bubbles: true, cancelable: true,
            clientX: rect2.left + rect2.width / 2, clientY: rect2.top + rect2.height / 2,
            pointerId: 1, pointerType: 'mouse'
          }));
        });
        await delay(300);
        retryBtn.click();
        log('🔄 กดปุ่ม Create ซ้ำแล้ว', 'info');
      }
    } else {
      log(`✅ หลังกด Create: ${hasProgress ? 'มี progress' : ''} ${hasNewVideo ? 'มี video ใหม่' : ''}`, 'info');
    }

    return STATES.EXTEND_SB_WAIT_GENERATE;
  }

  // Step 4.2.8: รอ GEN วิดีโอแรกใน SceneBuilder (Polling)
  async function handleExtendSBWaitGenerate() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.2.8: รอ GEN วิดีโอแรกใน SceneBuilder (Polling)', 'step');

    const videoWaitTime = S.automationData?.videoGenDelay || DELAYS.GEN_VIDEO_WAIT;
    const POLL_INTERVAL = 5000;
    const HEARTBEAT_INTERVAL = 30000;
    let elapsed = 0;
    let hasSeenProgress = false;
    let lastHeartbeatTime = 0;
    let pollCount = 0;

    const existingBlobUrls = window._extendSBExistingBlobUrls || new Set();
    const existingStorageIds = window._extendSBExistingStorageIds || new Set();

    log(`⏳ เริ่ม Polling (Max ${videoWaitTime / 1000}s, ตรวจทุก ${POLL_INTERVAL / 1000}s)`, 'info');

    while (elapsed < videoWaitTime) {
      pollCount++;

      // Heartbeat
      if (elapsed - lastHeartbeatTime >= HEARTBEAT_INTERVAL) {
        const elapsedMin = (elapsed / 60000).toFixed(1);
        const maxMin = (videoWaitTime / 60000).toFixed(1);
        log(`[SB Gen] 💓 รอมา ${elapsedMin}/${maxMin} นาที | Poll #${pollCount}`, 'info');
        lastHeartbeatTime = elapsed;
      }

      // ตรวจสอบ stop/pause
      if (S.shouldStop) {
        log('🛑 ได้รับคำสั่งหยุด', 'warning');
        return STATES.IDLE;
      }
      if (S.shouldPause) {
        log('⏸️ หยุดชั่วคราว...', 'info');
        await delay(2000);
        continue;
      }

      // ตรวจสอบ progress — inline จาก DOM (leaf elements ที่มี % text)
      let realProgress = null;
      const allDivsCheck = document.querySelectorAll('div');
      for (const div of allDivsCheck) {
        if (div.children.length === 0) {
          const text = div.innerText?.trim();
          if (text && /^\d+%$/.test(text)) {
            realProgress = parseInt(text);
            break;
          }
        }
      }

      if (realProgress !== null && realProgress > 0) {
        if (!hasSeenProgress) {
          log(`🚀 [SB Gen] เริ่ม generate จริงแล้ว! (progress: ${realProgress}%)`, 'info');
        }
        hasSeenProgress = true;

        // ส่ง progress กลับไปให้ React
        try {
          chrome.runtime.sendMessage({
            type: 'EXTEND_PROGRESS',
            data: {
              rowId: S.automationData?.rowId,
              percent: realProgress,
              step: 'sb_first_video'
            }
          });
        } catch (e) { /* ignore */ }
      }

      // ตรวจสอบ error (เฉพาะ error ใหม่)
      const errorInfo = detectGenerationError(window._extendSBExistingErrorElements);
      if (errorInfo.hasError) {
        log(`❌ [SB Gen] พบ error: ${errorInfo.errorMessage}`, 'error');
        // ส่ง error กลับ React ทันที เพื่อให้ retry ได้เลย ไม่ต้องรอ inactivity timeout
        try {
          chrome.runtime.sendMessage({
            type: 'EXTEND_VIDEO_ERROR',
            data: {
              rowId: S.automationData?.rowId,
              error: `SB generation failed: ${errorInfo.errorMessage}`,
              skipRow: false
            }
          });
          log('📤 ส่ง EXTEND_VIDEO_ERROR กลับ React แล้ว', 'info');
        } catch (e) {
          log('⚠️ ส่ง error message ไม่ได้: ' + e.message, 'warning');
        }
        // Fallback ไปหน้า Flow แทน
        return STATES.EXTEND_GO_BACK;
      }

      // ตรวจสอบว่ามี video ใหม่ปรากฏหรือไม่ (= generation เสร็จ)
      const allBlobVideos = document.querySelectorAll('video[src^="blob:"]');
      const allStorageVideos = document.querySelectorAll('video[src*="storage.googleapis.com"]');

      // หา video ใหม่ (blob)
      for (const vid of allBlobVideos) {
        if (!existingBlobUrls.has(vid.src)) {
          log(`🎬 [SB Gen] พบวิดีโอใหม่ (blob)! src: ${vid.src.substring(0, 60)}...`, 'success');
          log('✅ วิดีโอแรกสร้างเสร็จใน SceneBuilder — ไปเริ่ม Extend', 'success');
          // วิดีโอแรกสร้างเสร็จแล้ว → ไปเลือกคลิปสุดท้ายเพื่อ extend
          return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
        }
      }

      // หา video ใหม่ (storage)
      for (const vid of allStorageVideos) {
        const vidId = extractVideoId(vid.src);
        if (vidId && !existingStorageIds.has(vidId)) {
          log(`🎬 [SB Gen] พบวิดีโอใหม่ (storage)! id: ${vidId}`, 'success');
          log('✅ วิดีโอแรกสร้างเสร็จใน SceneBuilder — ไปเริ่ม Extend', 'success');
          return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
        }
      }

      // ตรวจหา remove button (มี clip ใหม่) เมื่อมี progress หายไป (= generation เสร็จ)
      if (hasSeenProgress && realProgress === null) {
        const removeBtn = findButtonByIcon('remove');
        if (removeBtn) {
          log('✅ [SB Gen] Progress หายไป + พบ remove button — วิดีโอสร้างเสร็จ', 'success');
          return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
        }
      }

      await delay(POLL_INTERVAL);
      elapsed += POLL_INTERVAL;
    }

    // Timeout — fallback ไปหน้า Flow
    log(`⚠️ [SB Gen] Timeout (${videoWaitTime / 1000}s) — fallback ไปหน้า Flow`, 'warning');
    // ส่ง error กลับ React ทันที
    try {
      chrome.runtime.sendMessage({
        type: 'EXTEND_VIDEO_ERROR',
        data: {
          rowId: S.automationData?.rowId,
          error: 'SB generation timeout',
          skipRow: false
        }
      });
    } catch (e) {}
    return STATES.EXTEND_GO_BACK;
  }

  // Step 4.3: กดย้อนกลับหน้าเว็บ (fallback — ถ้า upload ไม่ได้)
  async function handleExtendGoBack() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.3/14: ไปเลือกวิดีโอเพื่อ extend (ไม่ต้อง back — อยู่หน้าเดิม)', 'step');

    await delay(500);

    // เช็คว่าอยู่ Scenebuilder หรือไม่
    const isInSB = !!document.querySelector('button[role="combobox"]') ||
      !!findButtonByIcon('flex_no_wrap') ||
      !!findButtonByIcon('add') ||
      !!document.querySelector('#PINHOLE_ADD_CLIP_CARD_ID') ||
      !!document.querySelector('#PINHOLE_TEXT_AREA_ELEMENT_ID');
    if (isInSB) {
      log('🔄 อยู่ Scenebuilder อยู่แล้ว — ไปใส่ Video Prompt เลย', 'info');
      return STATES.EXTEND_SB_FILL_PROMPT;
    } else {
      log('🔄 ไม่ได้อยู่ Scenebuilder — กดเข้า Scenebuilder ก่อน', 'info');
      return STATES.EXTEND_CLICK_SCENEBUILDER;
    }
  }

  // ========== Legacy Extended Mode Handlers (backward compatible) ==========

  async function handleExtendedWaitScenebuilder() {
    // Redirect ไป flow ใหม่
    return STATES.EXTEND_CLICK_ADD_TO_SCENE;
  }

  async function handleExtendedClickAddClip() {
    return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
  }

  async function handleExtendedFillPrompt() {
    return STATES.EXTEND_FILL_PROMPT;
  }

  async function handleExtendedClickGenerate() {
    return STATES.EXTEND_CLICK_CREATE;
  }

  async function handleExtendedWaitVideo() {
    return STATES.EXTEND_WAIT_GENERATE;
  }

  async function handleExtendedClickPlay() {
    return STATES.EXTEND_GET_BLOB_URL;
  }

  async function handleExtendedGetBlobUrl() {
    return STATES.EXTEND_GET_BLOB_URL;
  }


  // ========== Register All Handlers ==========
  // Step 3 handlers
  ctx.handlers.handleVideoSelectMode = handleVideoSelectMode;
  ctx.handlers.handleVideoClickImage = handleVideoClickImage;
  ctx.handlers.handleVideoSelectFramesToVideo = handleVideoSelectFramesToVideo;
  ctx.handlers.handleVideo8sAddImage = handleVideo8sAddImage;
  // State→handler mapping สำหรับ states ใหม่ที่ main script (cached) อาจไม่มีใน switch
  ctx.stateHandlers = ctx.stateHandlers || {};
  ctx.stateHandlers['VIDEO_8S_ADD_IMAGE'] = handleVideo8sAddImage;
  ctx.handlers.handleVideoAddToPrompt = handleVideoAddToPrompt;
  ctx.handlers.handleVideoOpenSettings = handleVideoOpenSettings;
  ctx.handlers.handleVideoSetAspectRatio = handleVideoSetAspectRatio;
  ctx.handlers.handleVideoSetOutputCount = handleVideoSetOutputCount;
  ctx.handlers.handleVideoFillPrompt = handleVideoFillPrompt;
  ctx.handlers.handleVideoClickGenerate = handleVideoClickGenerate;

  // Step 4 handlers
  ctx.handlers.handleExtendClickScenebuilder = handleExtendClickScenebuilder;
  ctx.handlers.handleExtendClickArrange = handleExtendClickArrange;
  ctx.handlers.handleExtendDeleteClips = handleExtendDeleteClips;
  ctx.handlers.handleExtendUploadImage = handleExtendUploadImage;
  ctx.handlers.handleExtendSBFillPrompt = handleExtendSBFillPrompt;
  ctx.handlers.handleExtendSBClickCreate = handleExtendSBClickCreate;
  ctx.handlers.handleExtendSBWaitGenerate = handleExtendSBWaitGenerate;
  ctx.handlers.handleExtendGoBack = handleExtendGoBack;
  ctx.handlers.handleExtendSelectVideo = handleExtendSelectVideo;
  ctx.handlers.handleExtendClickAddToScene = handleExtendClickAddToScene;
  ctx.handlers.handleExtendClickSwitchBuilder = handleExtendClickSwitchBuilder;
  ctx.handlers.handleExtendSelectLastClip = handleExtendSelectLastClip;
  ctx.handlers.handleExtendClickAddClip = handleExtendClickAddClip;
  ctx.handlers.handleExtendClickExtendMenu = handleExtendClickExtendMenu;
  ctx.handlers.handleExtendWaitTextarea = handleExtendWaitTextarea;
  ctx.handlers.handleExtendFillPrompt = handleExtendFillPrompt;
  ctx.handlers.handleExtendClickCreate = handleExtendClickCreate;
  ctx.handlers.handleExtendWaitGenerate = handleExtendWaitGenerate;
  ctx.handlers.handleExtendGetBlobUrl = handleExtendGetBlobUrl;

  // Legacy extended handlers
  ctx.handlers.handleExtendedWaitScenebuilder = handleExtendedWaitScenebuilder;
  ctx.handlers.handleExtendedClickAddClip = handleExtendedClickAddClip;
  ctx.handlers.handleExtendedFillPrompt = handleExtendedFillPrompt;
  ctx.handlers.handleExtendedClickGenerate = handleExtendedClickGenerate;
  ctx.handlers.handleExtendedWaitVideo = handleExtendedWaitVideo;
  ctx.handlers.handleExtendedClickPlay = handleExtendedClickPlay;
  ctx.handlers.handleExtendedGetBlobUrl = handleExtendedGetBlobUrl;

  // ========== Register Message Handlers ==========
  ctx.messageHandlers = ctx.messageHandlers || [];
  ctx.messageHandlers.push(function (message, sender, sendResponse) {

    // Extend Retry: รับ Prompt ใหม่จาก React app
    if (message.type === 'EXTEND_NEW_PROMPT_READY') {
      const { videoPrompt2 } = message.data || {};
      if (videoPrompt2) {
        log(`📥 ได้รับ Prompt ใหม่ (${videoPrompt2.length} chars)`, 'success');
        window._newVideoPrompt2 = videoPrompt2;
      } else {
        log('⚠️ ได้รับ message แต่ไม่มี videoPrompt2', 'warning');
      }
      sendResponse({ success: true });
      return true;
    }

    // Step 3: GEN วิดีโอ
    if (message.type === 'START_VIDEO_GEN') {
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
      log('🎬 ได้รับคำสั่งเริ่มต้น Step 3 (GEN วิดีโอ)', 'info');

      if (S.isRunning) {
        log('⚠️ กำลังทำงานอยู่แล้ว - ไม่เริ่มใหม่', 'warning');
        sendResponse({ success: false, reason: 'already_running' });
        return true;
      }

      chrome.storage.local.get('sora_stop_requested').then((stopData) => {
        if (stopData.sora_stop_requested) {
          log('🛑 มีคำสั่งหยุดรออยู่ - ไม่เริ่มทำงาน', 'warning');
          S.shouldStop = true;
          sendResponse({ success: false, stopped: true });
          return;
        }

        S.isRunning = true;
        S.currentSessionId = Date.now() + '_' + Math.random();
        const mySessionId = S.currentSessionId;

        S.shouldStop = false;
        S.shouldPause = false;
        S.currentState = STATES.IDLE;
        S.userUploadResolve = null;

        S.automationData = message.data || {};
        S.savedVideoRowId = S.automationData.rowId;

        // Clear cached image URLs เพื่อให้ใช้ pictureUrl จาก automationData ใหม่ทุกครั้ง
        // (แก้บั๊ก: Viral mode ฉาก 2+ ดึงรูปฉากเก่ามาทำคลิป เพราะ cache ไม่ถูก clear)
        ctx.lastPictureUrl = null;
        window._lastPictureUrl = null;

        // Reset extend mode — Viral mode ใช้แค่ Start Frame เท่านั้น (ไม่ใช้ End Frame)
        // ป้องกันกรณี _isExtendMode ค้างจาก 16s extend flow ก่อนหน้า
        window._isExtendMode = false;

        window._step3RetryCount = S.automationData.retryCount || 0;
        window._generationStartTime = null;

        if (window._step3RetryCount > 0) {
          log(`[Flow] 🔁 Retry ${window._step3RetryCount}/3 (from React)`, 'info');
        } else {
          log('[Flow] 🆕 เริ่มสร้างวิดีโอ (row ใหม่)', 'info');
        }
        S.currentMode = 'video';

        log(`📋 Data: rowId=${S.automationData.rowId}, projectUrl=${S.automationData.projectUrl?.substring(0, 50)}...`, 'info');
        if (S.automationData.extendedMode) {
          log('🎬 Extended Mode: เปิด (จะสร้าง VDO 2 ตัว)', 'info');
          log(`📝 videoPrompt2: ${S.automationData.videoPrompt2?.substring(0, 50)}...`, 'info');
        }

        // ทั้ง 8s และ 16s ใช้ 9-step Config Dropdown flow เหมือนกัน
        window._extendCurrentCount = 0; // reset extend counter
        S.currentState = STATES.OPEN_CONFIG_DROPDOWN;
        log(`▶️ เริ่ม State Machine จาก: ${S.currentState}`, 'info');

        try {
          chrome.runtime.sendMessage({
            type: 'STEP3_STARTED',
            data: {
              rowId: S.savedVideoRowId || S.automationData?.rowId,
              timestamp: Date.now()
            }
          });
        } catch (e) {
          log('⚠️ ส่ง STEP3_STARTED message ล้มเหลว (ไม่เป็นไร)', 'warning');
        }

        ctx.runStateMachine(mySessionId);
      });

      sendResponse({ success: true });
      return true;
    }

    // Step 4: Extend Video Only
    if (message.type === 'START_EXTEND_VIDEO') {
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
      log('🎬 ได้รับคำสั่งเริ่มต้น Step 4 Extend Video', 'info');

      if (S.isRunning) {
        log('✅ Self-contained loop กำลังทำงานอยู่แล้ว — ไม่ต้องเริ่มใหม่ (React จะรับ messages จาก loop ได้เลย)', 'info');
        sendResponse({ success: true, reason: 'already_running' });
        return true;
      }

      S.isRunning = true;
      S.currentSessionId = Date.now() + '_' + Math.random();
      const mySessionId = S.currentSessionId;

      S.shouldStop = false;
      S.shouldPause = false;
      S.currentState = STATES.IDLE;
      S.userUploadResolve = null;

      // Extend เริ่มจาก clip 1 เป็นต้นไป (clip 0 = video แรกที่สร้างเสร็จแล้ว)
      const startFromClip = message.data?.startFromClip || 1;
      window._extendRetryCount = 0;
      window._generationStartTime = null;
      window._progressGoneNoVideoCount = 0;
      window._extendSimplifyCount = 0;
      window._extendCurrentCount = startFromClip;
      log(`[Flow] 🔄 เริ่ม Extend จาก clip ${startFromClip + 1} (clip 1-${startFromClip} เสร็จแล้ว)`, 'info');

      S.automationData = message.data || {};
      S.currentMode = 'video';  // ใช้ 'video' เพื่อให้ 9-step handlers ทำงานเหมือน Video Gen

      const totalClips = S.automationData.extendClipCount || 2;
      const targetExtendCount = totalClips - 1;
      const extendVideoPromptsCount = S.automationData.extendVideoPrompts?.length || 0;
      log(`📋 Data: rowId=${S.automationData.rowId}`, 'info');
      log(`🖼️ pictureUrl: ${S.automationData.pictureUrl ? `มี (${S.automationData.pictureUrl.substring(0, 60)}...)` : '❌ ไม่มี'}`, 'info');
      log(`📝 videoPrompt: ${S.automationData.videoPrompt ? `มี (${S.automationData.videoPrompt.length} chars)` : '❌ ไม่มี'}`, 'info');
      log(`🔢 คลิปรวม: ${totalClips} (ทำ ${targetExtendCount} extends)`, 'info');
      log(`📝 extendVideoPrompts: ${extendVideoPromptsCount} prompts`, 'info');

      if (S.automationData.extendVideoPrompts && S.automationData.extendVideoPrompts.length > 0) {
        log('📋 ========== extendVideoPrompts Debug ==========', 'info');
        S.automationData.extendVideoPrompts.forEach((p, i) => {
          try {
            const promptObj = JSON.parse(p);
            if (promptObj.dialogue_script) {
              log(`🗣️ [${i}] dialogue_script: "${promptObj.dialogue_script}"`, 'info');
            } else {
              log(`📝 [${i}]: "${p?.substring(0, 80)}..."`, 'info');
            }
          } catch (e) {
            log(`📝 [${i}]: "${p?.substring(0, 80)}..."`, 'info');
          }
        });
        log('📋 ==============================================', 'info');
      }

      log(`📝 videoPrompt2: ${S.automationData.videoPrompt2?.substring(0, 50)}...`, 'info');

      // ใช้ 9-step Config Dropdown flow เหมือน video แรก
      S.currentState = STATES.OPEN_CONFIG_DROPDOWN;
      log(`▶️ เริ่ม State Machine จาก: ${S.currentState}`, 'info');

      ctx.runStateMachine(mySessionId);

      sendResponse({ success: true });
      return true;
    }

    // Continue หลัง user อัพโหลดรูปเสร็จ
    if (message.type === 'VIDEO_GEN_CONTINUE') {
      log('ได้รับคำสั่ง Continue จาก user', 'info');

      if (S.userUploadResolve) {
        S.userUploadResolve();
        S.userUploadResolve = null;
      }

      sendResponse({ success: true });
      return true;
    }

    return false; // Not handled by this file
  });

})();
