// ========================================
// Google Flow Content Script - Step 2: GEN ภาพ + Step 3: GEN วิดีโอ
// สำหรับ labs.google.com/fx/tools/flow
// ========================================

(function () {
  'use strict';

  // ป้องกันการ execute ซ้ำ (เกิดจาก manifest.json + background.js inject)
  if (window._aistudioContentScriptLoaded) {
    console.log('🔄 aistudio-content-script.js already loaded, skipping...');
    return;
  }
  window._aistudioContentScriptLoaded = true;


  // ========== Shared Context Bridge (สำหรับแยกไฟล์ Video+Extend) ==========
  window.__flowCtx = window.__flowCtx || {};
  const ctx = window.__flowCtx;

  console.log('🎨 Google Flow Content Script loaded - URL:', window.location.href);

  // ========== เคลียร์แคชเว็บ Flow (labs.google.com) ==========
  function clearFlowCache() {
    try {
      sessionStorage.clear();

      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('flow') || key.includes('clip') || key.includes('extend'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));

      if (indexedDB.databases) {
        indexedDB.databases().then(dbs => {
          dbs.forEach(db => {
            if (db.name && db.name.includes('flow')) {
              indexedDB.deleteDatabase(db.name);
            }
          });
        });
      }

      console.log('🧹 [clearFlowCache] Cache cleared! (sessionStorage + localStorage + indexedDB)');
    } catch (err) {
      console.error('❌ [clearFlowCache] Error:', err);
    }
  }

  // ========== ตรวจจับ "Something went wrong" ==========
  const MAX_ERROR_RETRY = 3; // จำกัด retry สูงสุด 3 ครั้ง
  let isHandlingError = false; // ป้องกันการ handle error ซ้ำ

  // ========== ตรวจจับ 99% ค้าง ==========
  const MAX_99_STUCK_RETRY = 3; // จำกัด retry สูงสุด 3 ครั้ง
  const STUCK_99_TIMEOUT = 10000; // 10 วินาที
  let stuckAt99StartTime = null; // เวลาที่เริ่มค้างที่ 99%
  let isHandling99Stuck = false; // ป้องกันการ handle ซ้ำ

  async function handleStuckAt99() {
    if (isHandling99Stuck) return;
    isHandling99Stuck = true;

    console.log('⚠️ ตรวจพบ Progress ค้างที่ 99% นานเกิน 10 วินาที - กำลังล้างแคช...');

    try {
      // ดึง retry count จาก storage
      const storage = await chrome.storage.local.get('google_flow_99_stuck_retry');
      const retryCount = storage.google_flow_99_stuck_retry || 0;

      if (retryCount >= MAX_99_STUCK_RETRY) {
        console.log('❌ หมดจำนวน retry (3/3) - หยุดการทำงาน');
        // Reset retry count
        await chrome.storage.local.set({ google_flow_99_stuck_retry: 0 });

        // ส่ง message ไปแจ้ง popup
        chrome.runtime.sendMessage({
          type: 'GOOGLE_FLOW_RETRY_LIMIT_REACHED',
          data: { reason: '99% stuck', retryCount: retryCount }
        }).catch(() => {});

        isHandling99Stuck = false;
        return;
      }

      // เพิ่ม retry count
      const newRetryCount = retryCount + 1;
      await chrome.storage.local.set({ google_flow_99_stuck_retry: newRetryCount });
      console.log(`🔄 99% Stuck Retry: ${newRetryCount}/${MAX_99_STUCK_RETRY}`);

      // ล้างแคชเว็บ Flow
      clearFlowCache();

      // ✅ บันทึก automation data ลง storage เพื่อให้ checkRetryAfterReload() ทำงานต่อได้หลัง reload
      if (automationData) {
        // ใส่ messageType ให้ตรงกับ mode ปัจจุบัน (image/video) เพื่อ retry ได้ถูกขั้นตอน
        const retryMessageType = currentMode === 'video' ? 'START_VIDEO_GEN' : 'START_AISTUDIO_GEN';
        await chrome.storage.local.set({
          google_flow_retry_after_reload: true,
          google_flow_retry_data: {
            ...automationData,
            messageType: retryMessageType,
            errorRetryCount: newRetryCount,
            lastErrorReason: '99% stuck'
          }
        });
        console.log('💾 บันทึก retry data สำหรับ reload แล้ว');
      }

      // แจ้ง popup ว่ากำลัง retry
      chrome.runtime.sendMessage({
        type: 'GOOGLE_FLOW_RETRY_AFTER_ERROR',
        data: { reason: '99% stuck', retryCount: newRetryCount }
      }).catch(() => {});

      // รอ 1 วินาที แล้วรีเฟรชหน้า
      await new Promise(r => setTimeout(r, 1000));
      console.log('🔄 รีเฟรชหน้าเว็บ...');
      window.location.reload();

    } catch (err) {
      console.error('❌ Error handling 99% stuck:', err);
      isHandling99Stuck = false;
    }
  }

  // ตัวแปรสำหรับ auto-detect 99% ค้าง
  let autoDetect99StartTime = null;
  const AUTO_DETECT_99_TIMEOUT = 15000; // 15 วินาที

  async function checkAndHandleErrorScreen() {
    // ป้องกันการ handle ซ้ำ
    if (isHandlingError) {
      return false;
    }

    const bodyText = document.body?.innerText?.trim() || '';

    // วิธีที่ 1: ตรวจจับหน้าจอดำที่มีแค่ "Something went wrong."
    const isBlackScreen = (
      bodyText === 'Something went wrong.' ||
      (bodyText.includes('Something went wrong') && bodyText.length < 200)  // เพิ่ม threshold
    );

    // วิธีที่ 2: ตรวจจับ div ที่มี class "sc-" และมี text "Something went wrong" (หาทุก div)
    let hasErrorDiv = false;
    const scDivs = document.querySelectorAll('div[class*="sc-"]');
    for (const div of scDivs) {
      const text = div.textContent?.trim() || '';
      if (text === 'Something went wrong.' || text.toLowerCase().includes('something went wrong')) {
        hasErrorDiv = true;
        console.log(`🔴 [Auto-Detect] พบ "Something went wrong" ใน div!`);
        break;
      }
    }

    // ✅ วิธีที่ 3: ตรวจจับ "Couldn't generate image. Try again later."
    // ใช้ scDivs ที่ query ไว้แล้ว (ไม่ต้อง query ใหม่)
    let hasCouldntGenerateError = false;
    for (const div of scDivs) {
      const text = div.textContent?.trim() || '';
      if (text.toLowerCase().includes("couldn't generate")) {
        hasCouldntGenerateError = true;
        console.log(`🔴 [Auto-Detect] พบ "Couldn't generate image" error!`);
        break;
      }
    }

    // ✅ วิธีที่ 4: ตรวจจับ 99% ค้างนานเกิน 15 วินาที
    let is99Stuck = false;
    for (const div of scDivs) {
      const text = div.textContent?.trim();
      if (text === '99%') {
        if (autoDetect99StartTime === null) {
          autoDetect99StartTime = Date.now();
          console.log(`⏱️ [Auto-Detect] พบ 99% - เริ่มจับเวลา...`);
        } else {
          const stuckDuration = Date.now() - autoDetect99StartTime;
          console.log(`⏱️ [Auto-Detect] 99% ค้างมาแล้ว ${(stuckDuration / 1000).toFixed(1)} วินาที`);
          if (stuckDuration >= AUTO_DETECT_99_TIMEOUT) {
            is99Stuck = true;
            console.log(`🔴 [Auto-Detect] 99% ค้างนานเกิน ${AUTO_DETECT_99_TIMEOUT / 1000} วินาที!`);
          }
        }
        break;
      }
    }
    // Reset ถ้าไม่เจอ 99%
    if (!is99Stuck && autoDetect99StartTime !== null) {
      const foundAny99 = Array.from(scDivs).some(d => d.textContent?.trim() === '99%');
      if (!foundAny99) {
        autoDetect99StartTime = null;
      }
    }

    if (isBlackScreen || hasErrorDiv || hasCouldntGenerateError || is99Stuck) {
      const reason = isBlackScreen || hasErrorDiv ? 'Something went wrong' :
                     hasCouldntGenerateError ? "Couldn't generate image" :
                     '99% stuck';
      console.log(`🔴 [Auto-Detect] ตรวจพบ error: ${reason} - กำลังล้าง cookies และ retry...`);
      isHandlingError = true; // ตั้ง flag ป้องกันซ้ำ
      autoDetect99StartTime = null; // Reset timer

      try {
        // ดึง retry data จาก storage
        const storage = await chrome.storage.local.get('google_flow_retry_data');
        const retryData = storage.google_flow_retry_data || {};
        const currentRetryCount = retryData.errorRetryCount || 0;

        // เช็ค retry limit
        if (currentRetryCount >= MAX_ERROR_RETRY) {
          console.log(`❌ Retry ครบ ${MAX_ERROR_RETRY} ครั้งแล้ว - หยุดทำงาน`);
          // ส่ง error กลับไป popup
          chrome.runtime.sendMessage({
            type: 'GOOGLE_FLOW_RETRY_LIMIT_REACHED',
            data: {
              reason: 'Retry limit reached',
              retryCount: currentRetryCount,
              rowId: retryData.rowId
            }
          }).catch(() => {});
          // ลบ retry data
          await chrome.storage.local.remove(['google_flow_retry_data', 'google_flow_retry_after_reload']);
          isHandlingError = false;
          return true;
        }

        // ล้างแคชเว็บ Flow
        clearFlowCache();

        // อัพเดท retry count และตั้ง flag + เก็บ reason ไว้ด้วย
        const newRetryCount = currentRetryCount + 1;
        // ใส่ messageType ให้ตรงกับ mode ปัจจุบัน (image/video) เพื่อ retry ได้ถูกขั้นตอน
        const retryMessageType = currentMode === 'video' ? 'START_VIDEO_GEN' : 'START_AISTUDIO_GEN';
        const baseData = (retryData && retryData.rowId) ? retryData : (automationData || retryData);
        await chrome.storage.local.set({
          google_flow_retry_after_reload: true,
          google_flow_retry_data: {
            ...baseData,
            messageType: retryMessageType,
            errorRetryCount: newRetryCount,
            lastErrorReason: reason  // เก็บ reason ไว้แสดงหลัง reload
          }
        });
        console.log(`🔄 Retry ${newRetryCount}/${MAX_ERROR_RETRY} (${reason}) - รอ 3 วินาทีแล้ว reload...`);

        await new Promise(r => setTimeout(r, 3000));
        window.location.reload();
      } catch (err) {
        console.error('❌ จัดการ error ไม่สำเร็จ:', err);
        isHandlingError = false;
      }
      return true;
    }
    return false;
  }

  // ตรวจจับ retry flag หลัง reload และเริ่มสร้างภาพใหม่
  async function checkRetryAfterReload() {
    try {
      // ✅ ตรวจสอบว่ามี extend ค้างอยู่หรือไม่ (page reload ระหว่าง extend generate)
      const extendStorage = await chrome.storage.local.get(['google_flow_extend_in_progress', 'google_flow_extend_data']);
      if (extendStorage.google_flow_extend_in_progress && extendStorage.google_flow_extend_data) {
        const extendData = extendStorage.google_flow_extend_data;
        const age = Date.now() - (extendData.timestamp || 0);
        const ageMinutes = (age / 60000).toFixed(1);

        // เฉพาะข้อมูลที่ไม่เก่าเกิน 15 นาที
        if (age < 15 * 60 * 1000) {
          console.log(`🔄 [Extend Resume] พบ extend ค้าง (อายุ ${ageMinutes} นาที) — จะ retry extend`);

          // ลบ flag
          await chrome.storage.local.remove(['google_flow_extend_in_progress', 'google_flow_extend_data']);

          // ส่ง message ให้ React ทราบว่าต้อง retry extend
          chrome.runtime.sendMessage({
            type: 'GOOGLE_FLOW_RETRY_AFTER_ERROR',
            data: {
              reason: 'Page reload during extend generation',
              retryCount: extendData.errorRetryCount || 0,
              retryData: extendData
            }
          }).catch(() => {
            console.log('Popup not available for extend retry message');
          });

          return; // จบ — ไม่ต้องเช็ค retry ปกติอีก
        } else {
          console.log(`⚠️ [Extend Resume] ข้อมูล extend เก่าเกิน 15 นาที (${ageMinutes}m) — ลบทิ้ง`);
          await chrome.storage.local.remove(['google_flow_extend_in_progress', 'google_flow_extend_data']);
        }
      }

      const storage = await chrome.storage.local.get(['google_flow_retry_after_reload', 'google_flow_retry_data']);
      if (storage.google_flow_retry_after_reload && storage.google_flow_retry_data) {
        const retryData = storage.google_flow_retry_data;
        const retryCount = retryData.errorRetryCount || 0;
        console.log(`🔄 พบ retry flag (${retryCount}/${MAX_ERROR_RETRY}) - เริ่มสร้างภาพใหม่...`);

        // ลบ flag (แต่เก็บ retry_data ไว้สำหรับเช็ค retry count ครั้งถัดไป)
        await chrome.storage.local.remove('google_flow_retry_after_reload');

        // ═══════════════════════════════════════════════════════════════
        // ✅ FIX: ถ้าอยู่ homepage ให้กด "Create with Flow" ก่อน
        // ═══════════════════════════════════════════════════════════════
        const currentUrl = window.location.href;
        const isHomepage = currentUrl === 'https://labs.google/fx/tools/flow' ||
                          currentUrl === 'https://labs.google/fx/tools/flow/' ||
                          currentUrl.match(/^https:\/\/labs\.google\/fx\/?$/);

        if (isHomepage) {
          console.log('🏠 อยู่ที่ homepage - กำลังกดปุ่ม "Create with Flow"...');

          // หาปุ่ม "Create with Flow"
          const createFlowBtn = await new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 20; // 10 วินาที
            const interval = setInterval(() => {
              attempts++;
              const btns = document.querySelectorAll('button');
              for (const btn of btns) {
                if (btn.textContent.includes('Create with Flow')) {
                  clearInterval(interval);
                  resolve(btn);
                  return;
                }
              }
              if (attempts >= maxAttempts) {
                clearInterval(interval);
                resolve(null);
              }
            }, 500);
          });

          if (createFlowBtn) {
            console.log('✅ พบปุ่ม "Create with Flow" - กำลังคลิก...');
            createFlowBtn.click();

            // รอให้ URL เปลี่ยนเป็น project URL
            console.log('⏳ รอ URL เปลี่ยนเป็น project...');
            let urlChanged = false;
            for (let i = 0; i < 30; i++) { // 15 วินาที
              await new Promise(r => setTimeout(r, 500));
              if (window.location.href !== currentUrl && window.location.href.includes('/project/')) {
                urlChanged = true;
                console.log(`✅ URL เปลี่ยนเป็น project แล้ว: ${window.location.href}`);
                break;
              }
            }

            if (!urlChanged) {
              console.log('⚠️ URL ไม่เปลี่ยน - อาจต้อง retry ใหม่');
            }

            // รอให้ UI โหลด
            await new Promise(r => setTimeout(r, 3000));
          } else {
            console.log('⚠️ ไม่พบปุ่ม "Create with Flow"');
          }
        }
        // ═══════════════════════════════════════════════════════════════

        // ส่ง message ไปให้ popup/background ให้ retry พร้อม data (ใช้ reason จริงจาก storage)
        const errorReason = retryData.lastErrorReason || 'Unknown error';
        chrome.runtime.sendMessage({
          type: 'GOOGLE_FLOW_RETRY_AFTER_ERROR',
          data: {
            reason: errorReason,
            retryCount: retryCount,
            retryData: retryData
          }
        }).catch(() => {
          console.log('Popup not available for retry message');
        });
      }
    } catch (err) {
      console.error('❌ ตรวจสอบ retry flag ไม่สำเร็จ:', err);
    }
  }

  // ตรวจจับ error screen ทันทีที่โหลด
  checkAndHandleErrorScreen();

  // ตรวจสอบ retry flag หลัง 2 วินาที (รอให้หน้าโหลดเสร็จ)
  setTimeout(checkRetryAfterReload, 2000);

  // Poll ตรวจจับ error screen ทุก 5 วินาที (สำหรับ error ที่เกิดระหว่างทำงาน)
  setInterval(checkAndHandleErrorScreen, 5000);

  // ========== ปิด Changelog Dialog อัตโนมัติ ==========
  function dismissChangelogDialog() {
    const dialog = document.querySelector('div[role="dialog"][data-state="open"]');
    if (!dialog) return;
    const heading = dialog.querySelector('h2');
    if (!heading || !heading.textContent.includes('Latest Flow Update')) return;
    const btn = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent.trim() === 'Get started');
    if (btn) {
      btn.click();
      console.log('✅ Auto-dismissed changelog dialog (clicked "Get started")');
    }
  }
  dismissChangelogDialog();
  setTimeout(dismissChangelogDialog, 2000);
  setTimeout(dismissChangelogDialog, 5000);

  // ========== Configuration ==========
  const DELAYS = {
    BETWEEN_STEPS: 2250,    // 2.25 วินาที ระหว่างขั้นตอน (+50%)
    AFTER_CLICK: 1500,      // 1.5 วินาที หลังกดปุ่ม (+50%)
    WAIT_FOR_ELEMENT: 3000, // 3 วินาที รอ element (+50%)
    WAIT_FOR_DROPDOWN: 1200, // 1.2 วินาที รอ dropdown (+50%)
    AFTER_CREATE_IMAGE: 4500, // 4.5 วินาที หลังเลือก Create Image (+50%)
    GEN_IMAGE_WAIT: 180000,  // 3 นาที รอ GEN ภาพ
    GEN_VIDEO_WAIT: 300000, // 5 นาที รอ GEN วิดีโอ
  };

  // ========== State Machine ==========
  const STATES = {
    IDLE: 'IDLE',
    // Step 2: GEN ภาพ
    OPEN_CONFIG_DROPDOWN: 'OPEN_CONFIG_DROPDOWN',
    SELECT_IMAGE_MODE: 'SELECT_IMAGE_MODE',
    // SELECT_CREATE_IMAGE — ลบแล้ว (UI ใหม่ไม่มี Create Image dropdown)
    SET_MODEL: 'SET_MODEL',
    SET_ASPECT_RATIO: 'SET_ASPECT_RATIO',
    SET_OUTPUT_COUNT: 'SET_OUTPUT_COUNT',
    CLOSE_CONFIG_DROPDOWN: 'CLOSE_CONFIG_DROPDOWN',
    CLICK_ADD_BUTTONS: 'CLICK_ADD_BUTTONS',
    FILL_PROMPT: 'FILL_PROMPT',
    CLICK_GENERATE: 'CLICK_GENERATE',
    // Step 3: GEN วิดีโอ
    VIDEO_SELECT_MODE: 'VIDEO_SELECT_MODE',
    VIDEO_CLICK_IMAGE: 'VIDEO_CLICK_IMAGE',
    VIDEO_SELECT_FRAMES_TO_VIDEO: 'VIDEO_SELECT_FRAMES_TO_VIDEO',
    VIDEO_ADD_TO_PROMPT: 'VIDEO_ADD_TO_PROMPT',
    VIDEO_8S_ADD_IMAGE: 'VIDEO_8S_ADD_IMAGE',
    VIDEO_OPEN_SETTINGS: 'VIDEO_OPEN_SETTINGS',
    VIDEO_SET_ASPECT_RATIO: 'VIDEO_SET_ASPECT_RATIO',
    VIDEO_SET_OUTPUT_COUNT: 'VIDEO_SET_OUTPUT_COUNT',
    VIDEO_FILL_PROMPT: 'VIDEO_FILL_PROMPT',
    VIDEO_CLICK_GENERATE: 'VIDEO_CLICK_GENERATE',
    // Step 4: Extended Mode - กดแท็บ Videos → เลือก video → Extend
    EXTEND_CLICK_SCENEBUILDER: 'EXTEND_CLICK_SCENEBUILDER',       // 0. กดแท็บ "Videos"
    EXTEND_CLICK_ARRANGE: 'EXTEND_CLICK_ARRANGE',                 // (legacy - ไม่ใช้แล้ว)
    EXTEND_DELETE_CLIPS: 'EXTEND_DELETE_CLIPS',                   // (legacy - ไม่ใช้แล้ว)
    EXTEND_UPLOAD_IMAGE: 'EXTEND_UPLOAD_IMAGE',                   // 2.5. อัปโหลดรูปสินค้าเข้า SceneBuilder (Frames to Video)
    EXTEND_SB_FILL_PROMPT: 'EXTEND_SB_FILL_PROMPT',               // 2.6. ใส่ Video Prompt ใน SceneBuilder
    EXTEND_SB_CLICK_CREATE: 'EXTEND_SB_CLICK_CREATE',             // 2.7. กดปุ่ม Create ใน SceneBuilder
    EXTEND_SB_WAIT_GENERATE: 'EXTEND_SB_WAIT_GENERATE',           // 2.8. รอ GEN วิดีโอแรกใน SceneBuilder
    EXTEND_GO_BACK: 'EXTEND_GO_BACK',                             // (legacy - ไม่ใช้แล้ว)
    EXTEND_SELECT_VIDEO: 'EXTEND_SELECT_VIDEO',                   // (legacy - ไม่ใช้แล้ว)
    EXTEND_CLICK_ADD_TO_SCENE: 'EXTEND_CLICK_ADD_TO_SCENE',       // (legacy - ไม่ใช้แล้ว)
    EXTEND_CLICK_SWITCH_BUILDER: 'EXTEND_CLICK_SWITCH_BUILDER',   // (legacy - ไม่ใช้แล้ว)
    EXTEND_SELECT_LAST_CLIP: 'EXTEND_SELECT_LAST_CLIP',           // (legacy - ไม่ใช้แล้ว)
    EXTEND_CLICK_ADD_CLIP: 'EXTEND_CLICK_ADD_CLIP',               // (legacy - ไม่ใช้แล้ว)
    EXTEND_CLICK_EXTEND_MENU: 'EXTEND_CLICK_EXTEND_MENU',         // (legacy - ไม่ใช้แล้ว)
    EXTEND_WAIT_TEXTAREA: 'EXTEND_WAIT_TEXTAREA',                 // (legacy - ไม่ใช้แล้ว)
    EXTEND_FILL_PROMPT: 'EXTEND_FILL_PROMPT',                     // 10. ใส่ Video Prompt 2
    EXTEND_CLICK_CREATE: 'EXTEND_CLICK_CREATE',                   // 11. กดปุ่ม "Create"
    EXTEND_WAIT_GENERATE: 'EXTEND_WAIT_GENERATE',                 // 12. รอ GEN VDO เสร็จ
    EXTEND_GET_BLOB_URL: 'EXTEND_GET_BLOB_URL',                   // 13. ดึง storage URL ของวิดีโอ
    EXTEND_COMPLETE: 'EXTEND_COMPLETE',                           // 14. Extend เสร็จสิ้น
    // Legacy Extended states (backward compatible)
    EXTENDED_WAIT_SCENEBUILDER: 'EXTENDED_WAIT_SCENEBUILDER',
    EXTENDED_CLICK_ADD_CLIP: 'EXTENDED_CLICK_ADD_CLIP',
    EXTENDED_FILL_PROMPT: 'EXTENDED_FILL_PROMPT',
    EXTENDED_CLICK_GENERATE: 'EXTENDED_CLICK_GENERATE',
    EXTENDED_WAIT_VIDEO: 'EXTENDED_WAIT_VIDEO',
    EXTENDED_CLICK_PLAY: 'EXTENDED_CLICK_PLAY',
    EXTENDED_GET_BLOB_URL: 'EXTENDED_GET_BLOB_URL',
    // Common
    DONE: 'DONE',
    ERROR: 'ERROR'
  };

  let currentState = STATES.IDLE;
  let automationData = null;
  let currentMode = 'image'; // 'image' หรือ 'video'
  let userUploadResolve = null; // สำหรับรอ user อัพโหลดรูป
  let shouldStop = false; // สำหรับหยุดการทำงาน
  let shouldPause = false; // สำหรับหยุดชั่วคราว
  let currentSessionId = null; // สำหรับป้องกัน Race Condition ระหว่าง Row
  let isRunning = false; // ป้องกันการทำงานซ้อนทับ
  // ✅ NEW: Debounce duplicate STOP messages
  let stopMessageReceived = false;
  let stopMessageTimestamp = 0;
  // ✅ NEW: Track video generation start time per session
  window._generationStartTime = null;
  // ✅ FIX: Save rowId when video gen starts (prevents overwrite race condition)
  let savedVideoRowId = null;
  // ✅ NEW: Global video ID tracking to prevent duplicates across session
  window._allSeenVideoIds = window._allSeenVideoIds || new Set();
  // ✅ NEW: Track retry loop to prevent infinite VIDEO_FILL_PROMPT ↔ VIDEO_CLICK_GENERATE cycles
  window._lastRetryTimestamp = null;
  window._consecutiveRetriesInSameSecond = 0;
  // ✅ NEW: Track Extend retry loop to prevent infinite cycles
  window._lastExtendRetryTimestamp = null;
  window._consecutiveExtendRetriesInSameSecond = 0;

  // Helper: ส่งสถานะการทำงานไปแสดงใน Activity Log ของ Viral mode / side panel
  function sendStepStatus(message, logType) {
    try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_STATUS', data: { rowId: savedVideoRowId || automationData?.rowId, message: message, logType: logType || 'info' } }); } catch(e) {}
  }

  // Master Stop Listener - React immediately when stop flag changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sora_stop_requested?.newValue === true) {
      log('🛑 Storage stop flag detected - stopping immediately', 'warning');
      shouldStop = true;
      shouldPause = false;
      currentState = STATES.IDLE;
      isRunning = false;
    }
  });

  // ========== Expose Shared State via ctx ==========
  ctx.state = {
    get currentState() { return currentState; },
    set currentState(v) { currentState = v; },
    get automationData() { return automationData; },
    set automationData(v) { automationData = v; },
    get currentMode() { return currentMode; },
    set currentMode(v) { currentMode = v; },
    get shouldStop() { return shouldStop; },
    set shouldStop(v) { shouldStop = v; },
    get shouldPause() { return shouldPause; },
    set shouldPause(v) { shouldPause = v; },
    get isRunning() { return isRunning; },
    set isRunning(v) { isRunning = v; },
    get currentSessionId() { return currentSessionId; },
    set currentSessionId(v) { currentSessionId = v; },
    get savedVideoRowId() { return savedVideoRowId; },
    set savedVideoRowId(v) { savedVideoRowId = v; },
    get userUploadResolve() { return userUploadResolve; },
    set userUploadResolve(v) { userUploadResolve = v; },
    get stopMessageReceived() { return stopMessageReceived; },
    set stopMessageReceived(v) { stopMessageReceived = v; },
    get stopMessageTimestamp() { return stopMessageTimestamp; },
    set stopMessageTimestamp(v) { stopMessageTimestamp = v; },
  };


  // ========== Translations (เพิ่มภาษาใหม่ที่นี่) ==========
  const TRANSLATIONS = {
    createImage: ['Create Image', 'Créer une image', 'สร้างรูปภาพ'],
    framesToVideo: ['Frames', 'Frames to Video', 'Images vers vidéo', 'เฟรมเป็นวิดีโอ'],
    landscape: ['Landscape', 'Paysage', 'แนวนอน'],
    portrait: ['Portrait', 'Portrait', 'แนวตั้ง'],
    outputsPerPrompt: ['Outputs per prompt', 'Résultats par prompt', 'เอาต์พุตต่อพรอมต์'],
    model: ['Model', 'Modèle', 'โมเดล'],
    nanoBananaPro: ['Nano Banana Pro', '🍌 Nano Banana Pro'],
  };

  // Helper: ตรวจสอบว่า text มีคำใดคำหนึ่งใน array หรือไม่
  function matchesAny(text, keys) {
    return keys.some(key => text.includes(key));
  }

  // Helper: ดึง Video ID จาก URL (เพื่อเปรียบเทียบ video ใหม่กับเก่า)
  // URL: https://storage.googleapis.com/ai-sandbox-videofx/video/{VIDEO_ID}?GoogleAccessId=...
  function extractVideoId(url) {
    if (!url) return '';
    const match = url.match(/\/video\/([a-f0-9-]+)/);
    return match ? match[1] : url;
  }

  // ========== Utility Functions ==========

  function delay(ms) {
    return new Promise((resolve, reject) => {
      // แบ่ง delay เป็นช่วงเล็กๆ เพื่อตรวจสอบ shouldStop และ shouldPause
      const checkInterval = 100; // ตรวจทุก 100ms
      let elapsed = 0;
      let storageCheckElapsed = 0;
      let pauseLogged = false; // ป้องกัน log รัว
      let intervalId = null; // Declare outside for cleanup

      // Cleanup function to ensure interval is always cleared
      const cleanup = () => {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
      };

      intervalId = setInterval(async () => {
        // Check if stopped
        if (shouldStop) {
          cleanup();
          log('⏹️ Delay ถูกหยุด', 'warning');
          reject(new Error('STOPPED'));
          return;
        }

        // Check storage every 200ms for faster stop response
        storageCheckElapsed += checkInterval;
        if (storageCheckElapsed >= 200) {
          storageCheckElapsed = 0;
          try {
            const data = await chrome.storage.local.get('sora_stop_requested');
            if (data.sora_stop_requested) {
              shouldStop = true;
              cleanup();
              log('⏹️ Delay ถูกหยุด (จาก storage flag)', 'warning');
              reject(new Error('STOPPED'));
              return;
            }
          } catch (e) { /* ignore */ }
        }

        // Wait while paused
        if (shouldPause && !shouldStop) {
          if (!pauseLogged) {
            log('⏸️ หยุดชั่วคราว - กด Resume เพื่อทำต่อ', 'warning');
            pauseLogged = true;
          }
          return; // ไม่นับ elapsed ขณะ pause
        }

        // Reset pause log flag when resumed
        if (!shouldPause && pauseLogged) {
          log('▶️ ทำงานต่อ...', 'info');
          pauseLogged = false;
        }

        // Check stop again after pause
        if (shouldStop) {
          cleanup();
          reject(new Error('STOPPED'));
          return;
        }

        elapsed += checkInterval;

        if (elapsed >= ms) {
          cleanup();
          resolve();
        }
      }, checkInterval);
    });
  }

  // Async check with storage (for critical points where message might not reach)
  async function checkStopWithStorage() {
    if (shouldStop) {
      throw new Error('STOPPED');
    }
    // Also check storage flag for cases where message didn't reach
    try {
      const data = await chrome.storage.local.get('sora_stop_requested');
      if (data.sora_stop_requested) {
        shouldStop = true;
        throw new Error('STOPPED');
      }
    } catch (e) {
      if (e.message === 'STOPPED') throw e;
      // Ignore other errors (storage access issues)
    }
  }

  function log(message, type = 'info') {
    const prefix = {
      info: '🎨',
      success: '✅',
      error: '❌',
      warning: '⚠️',
      step: '👉'
    }[type] || '📝';

    console.log(`${prefix} [Google Flow] ${message}`);

    // ส่ง log กลับไป background script
    try {
      chrome.runtime.sendMessage({
        type: 'AISTUDIO_LOG',
        message: message,
        logType: type
      });
    } catch (e) {
      // Ignore if extension context is invalid
    }
  }

  // Human-like click
  function humanClick(element) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Mouse events sequence
    const mouseEvents = ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'];

    mouseEvents.forEach(eventType => {
      const event = new MouseEvent(eventType, {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y
      });
      element.dispatchEvent(event);
    });

    return true;
  }

  // Find element by text content
  function findElementByText(selector, text) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (el.textContent.includes(text)) {
        return el;
      }
    }
    return null;
  }

  // Find element by icon text (Google Symbols/Material Icons)
  function findButtonByIcon(iconText) {
    // รวม material-icons-outlined ด้วย
    const icons = document.querySelectorAll('i.google-symbols, i.material-icons, i.material-icons-outlined');
    for (const icon of icons) {
      if (icon.textContent.trim() === iconText) {
        // Find parent button
        const button = icon.closest('button');
        if (button) return button;
      }
    }
    return null;
  }

  // Wait for element to appear (with slowMode support)
  async function waitForElement(selectorOrFinder, timeout = DELAYS.WAIT_FOR_ELEMENT) {
    // Read slowMode from chrome.storage to increase timeout
    let effectiveTimeout = timeout;
    try {
      const { slowComputerMode } = await chrome.storage.local.get('slowComputerMode');
      if (slowComputerMode) {
        effectiveTimeout = timeout * 2;
        console.log(`[waitForElement] Slow Mode: timeout ${timeout}ms → ${effectiveTimeout}ms`);
      }
    } catch (e) {
      // Ignore storage read errors
    }

    const startTime = Date.now();

    while (Date.now() - startTime < effectiveTimeout) {
      let element;

      if (typeof selectorOrFinder === 'function') {
        element = selectorOrFinder();
      } else {
        element = document.querySelector(selectorOrFinder);
      }

      if (element) return element;

      await delay(200);
    }

    return null;
  }

  /**
   * ✅ NEW: Comprehensive error detection for generation failures
   * Returns: { hasError: boolean, errorMessage: string }
   */
  /**
   * Snapshot error elements ที่มีอยู่แล้วบนหน้า ก่อนเริ่ม generate
   * เพื่อป้องกัน false positive จาก error div เก่าที่ค้างอยู่
   */
  function snapshotExistingErrors() {
    const existing = new Set();
    // 1. จับ element ที่มี class error/failed
    const errorElements = document.querySelectorAll('[class*="error"], [class*="Error"], [class*="failed"], [class*="Failed"]');
    for (const el of errorElements) {
      const text = el.innerText?.trim() || el.textContent?.trim();
      if (text) existing.add(el);
    }
    // 2. จับ div ที่มี error text โดยตรง (Method 5 style — styled-component ที่ class ไม่มีคำว่า error)
    const directErrorPhrases = ['audio generation failed', 'video generation failed', 'generation failed', 'not been charged', 'please try a different prompt', 'third-party content providers', 'edit your prompt and try again'];
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      if (div.querySelector('div')) continue;
      const text = (div.innerText || div.textContent || '').trim().toLowerCase();
      if (text && text.length >= 15 && text.length <= 300) {
        for (const phrase of directErrorPhrases) {
          if (text.includes(phrase)) {
            existing.add(div);
            break;
          }
        }
      }
    }
    return existing;
  }

  function detectGenerationError(existingErrorElements) {
    // Method 1: Check for error class elements
    const errorElements = document.querySelectorAll('[class*="error"], [class*="Error"], [class*="failed"], [class*="Failed"]');

    for (const el of errorElements) {
      // Skip grecaptcha errors
      if (el.className && el.className.includes('grecaptcha')) continue;

      // Skip error elements ที่มีอยู่แล้วก่อนเริ่ม generate (ของเก่า)
      if (existingErrorElements && existingErrorElements.has(el)) continue;

      // Check if visible
      const computedStyle = window.getComputedStyle(el);
      const isVisible = el.offsetParent !== null ||
                       computedStyle.display !== 'none' ||
                       computedStyle.visibility !== 'hidden';

      const text = el.innerText?.trim() || el.textContent?.trim();

      if (text) {
        // Check for specific error phrases
        const errorPhrases = [
          'generation failed',
          'audio generation failed',
          'video generation failed',
          'failed generation',
          'not been charged',
          'please try a different prompt',
          'something went wrong',
          "couldn't generate image",
          'might violate',
          'prominent people',
          'policies',
          'third-party content providers',  // ลิขสิทธิ์บุคคลที่สาม
          'edit your prompt and try again',
          'high demand',           // Server overload - retry หลังรอ
          'experiencing high demand',
          'try again in a few minutes'
        ];

        const lowerText = text.toLowerCase();
        for (const phrase of errorPhrases) {
          if (lowerText.includes(phrase)) {
            return {
              hasError: true,
              errorMessage: text.substring(0, 200)
            };
          }
        }
      }
    }

    // Method 2 (removed): "Failed Generation" label scan — caused false positives

    // Method 3: Check for aria-label errors
    const ariaErrors = document.querySelectorAll('[aria-label*="error"], [aria-label*="failed"], [role="alert"]');
    for (const el of ariaErrors) {
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.toLowerCase().includes('fail')) {
        return {
          hasError: true,
          errorMessage: ariaLabel
        };
      }
    }

    // Method 4: Check for error icons with warning/error indicators
    const iconElements = document.querySelectorAll('[class*="icon"], svg, [data-icon]');
    for (const icon of iconElements) {
      const parent = icon.closest('[class*="error"], [class*="failed"], [class*="alert"]');
      if (parent) {
        const text = parent.innerText?.trim() || parent.textContent?.trim();
        if (text && text.length > 10) {
          return {
            hasError: true,
            errorMessage: text.substring(0, 200)
          };
        }
      }
    }

    // Method 5: ค้นหา error text โดยตรงจาก div (จับ styled-component ที่ class ไม่มีคำว่า error/failed)
    // เช่น class="sc-f6076f05-2 fxdhrw" ที่แสดง "Audio generation failed..."
    const allDivsForError = document.querySelectorAll('div');
    for (const div of allDivsForError) {
      // เฉพาะ leaf div (ไม่มี child div) เพื่อจับ error label ตรงๆ
      if (div.querySelector('div')) continue;
      // Skip div ที่มีอยู่แล้วก่อนเริ่ม generate (ของเก่า)
      if (existingErrorElements && existingErrorElements.has(div)) continue;
      const text = (div.innerText || div.textContent || '').trim();
      if (!text || text.length < 15 || text.length > 300) continue;

      const lowerText = text.toLowerCase();
      const directErrorPhrases = [
        'audio generation failed',
        'video generation failed',
        'generation failed',
        'not been charged',
        'please try a different prompt'
      ];
      for (const phrase of directErrorPhrases) {
        if (lowerText.includes(phrase)) {
          // ต้อง visible จริง
          const rect = div.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            log(`[Error Detection] ✅ พบ error text ใน div: "${text.substring(0, 80)}..."`, 'warning');
            return {
              hasError: true,
              errorMessage: text.substring(0, 200)
            };
          }
        }
      }
    }

    // Method 6: Check Sonner toast notifications (bottom-right notifications)
    const sonnerToaster = document.querySelector('[data-sonner-toaster="true"]');
    if (sonnerToaster) {
      // Toast items usually appear as <li> elements inside the toaster
      const toastItems = sonnerToaster.querySelectorAll('li');

      for (const toast of toastItems) {
        const text = (toast.innerText || toast.textContent || '').trim();

        if (text) {
          const lowerText = text.toLowerCase();

          // Check for error phrases in toast notifications
          const toastErrorPhrases = [
            'generation failed',
            'audio generation failed',
            'video generation failed',
            'failed generation',
            'not been charged',
            'please try a different prompt',
            'something went wrong',
            'error occurred'
          ];

          for (const phrase of toastErrorPhrases) {
            if (lowerText.includes(phrase)) {
              log('[Error Detection] Found error in Sonner toast: ' + text.substring(0, 100), 'warning');
              return {
                hasError: true,
                errorMessage: text.substring(0, 200)
              };
            }
          }
        }
      }
    }

    return { hasError: false, errorMessage: '' };
  }

  // ========== Check Daily Limit ==========

  // ตรวจจับ Daily Limit message บน image overlay
  function checkDailyLimit() {
    // หา div ที่มี class sc-f6076f05 (Daily Limit overlay)
    const limitDiv = document.querySelector('div[class*="sc-f6076f05"]');
    if (limitDiv) {
      const text = limitDiv.textContent?.toLowerCase() || '';
      if (text.includes('daily limit')) {
        return true;
      }
    }
    return false;
  }

  // แสดง Popup แจ้งเตือน Daily Limit สวยๆ
  function showDailyLimitPopup() {
    // ลบ popup เก่าถ้ามี
    const existingPopup = document.getElementById('daily-limit-popup');
    if (existingPopup) existingPopup.remove();

    // สร้าง overlay + popup
    const overlay = document.createElement('div');
    overlay.id = 'daily-limit-popup';
    overlay.innerHTML = `
      <style>
        #daily-limit-popup {
          position: fixed;
          inset: 0;
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(8px);
          animation: dlp-fade-in 0.3s ease-out;
        }
        @keyframes dlp-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dlp-scale-in {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes dlp-glow {
          0%, 100% { box-shadow: 0 0 30px rgba(255, 179, 0, 0.4), 0 0 60px rgba(255, 179, 0, 0.2); }
          50% { box-shadow: 0 0 40px rgba(255, 179, 0, 0.6), 0 0 80px rgba(255, 179, 0, 0.3); }
        }
        .dlp-card {
          background: linear-gradient(145deg, rgba(30, 30, 30, 0.95), rgba(20, 20, 20, 0.98));
          border: 1px solid rgba(255, 179, 0, 0.3);
          border-radius: 20px;
          padding: 32px 40px;
          max-width: 420px;
          text-align: center;
          animation: dlp-scale-in 0.3s ease-out, dlp-glow 2s infinite;
        }
        .dlp-icon {
          font-size: 64px;
          margin-bottom: 16px;
          display: block;
        }
        .dlp-title {
          color: #FFB300;
          font-size: 24px;
          font-weight: 700;
          margin: 0 0 12px 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .dlp-message {
          color: #E0E0E0;
          font-size: 16px;
          line-height: 1.6;
          margin: 0 0 24px 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .dlp-btn {
          background: linear-gradient(135deg, #FFB300, #FF9500);
          color: #1A1A1A;
          border: none;
          border-radius: 12px;
          padding: 14px 32px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .dlp-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(255, 179, 0, 0.4);
        }
      </style>
      <div class="dlp-card">
        <span class="dlp-icon">🍌</span>
        <h2 class="dlp-title">ถึงลิมิตวันนี้แล้ว!</h2>
        <p class="dlp-message">
          ไม่ต้องอัพเกรด<br>
          รอวันถัดไปได้เลย
        </p>
        <button class="dlp-btn" onclick="document.getElementById('daily-limit-popup').remove()">
          เข้าใจแล้ว
        </button>
      </div>
    `;

    document.body.appendChild(overlay);

    // ปิด popup เมื่อคลิก overlay
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ========== Find Generated Image ==========

  // หาภาพที่ generate แล้วจาก DOM (กรองภาพเก่าออก)
  // excludeSrcs = Set ของ src ที่มีอยู่ก่อนกด Generate
  function findGeneratedImage(excludeSrcs = new Set()) {
    // Helper: ตรวจว่าเป็นภาพใหม่หรือไม่
    const isNewImage = (src) => {
      if (!src) return false;
      if (excludeSrcs.has(src)) return false;  // ภาพเดิม
      if (src.includes('placeholder')) return false;
      if (src.includes('icon')) return false;
      if (src.includes('avatar')) return false;
      if (src.includes('logo')) return false;
      return true;
    };

    // วิธี 1: หาจาก container class (Google Flow) — เลือกตัวล่าสุด (ท้ายสุดใน DOM)
    const imgContainers = document.querySelectorAll('div[class*="sc-1e4e26a0-7"]');
    for (let i = imgContainers.length - 1; i >= 0; i--) {
      const img = imgContainers[i].querySelector('img');
      if (img && isNewImage(img.src)) {
        return img.src;
      }
    }

    // วิธี 2: หาจาก storage.googleapis.com (รูปที่ generate แล้ว)
    const storageImgs = document.querySelectorAll('img[src*="storage.googleapis.com"]');
    // วน loop หาภาพใหม่ (จากท้ายไปหน้า)
    for (let i = storageImgs.length - 1; i >= 0; i--) {
      if (isNewImage(storageImgs[i].src)) {
        return storageImgs[i].src;
      }
    }

    // วิธี 3: หาจาก blob: URL (รูปที่เพิ่ง generate)
    const blobImgs = document.querySelectorAll('img[src^="blob:"]');
    for (let i = blobImgs.length - 1; i >= 0; i--) {
      if (isNewImage(blobImgs[i].src)) {
        return blobImgs[i].src;
      }
    }

    // วิธี 4: หาจาก data: URL
    const dataImgs = document.querySelectorAll('img[src^="data:image"]');
    for (let i = dataImgs.length - 1; i >= 0; i--) {
      if (isNewImage(dataImgs[i].src)) {
        return dataImgs[i].src;
      }
    }

    // วิธี 5: หา img ใน response/output area
    const responseAreas = document.querySelectorAll('[class*="response"], [class*="output"], [class*="result"], [class*="generated"]');
    for (const area of responseAreas) {
      const img = area.querySelector('img');
      if (img && isNewImage(img.src)) {
        return img.src;
      }
    }

    // วิธี 6: หา img ที่มี size ใหญ่ (ภาพที่ generate มักใหญ่)
    const allImgs = document.querySelectorAll('img');
    for (const img of allImgs) {
      if (isNewImage(img.src) &&
        img.naturalWidth > 200 &&
        img.naturalHeight > 200) {
        // ตรวจว่าไม่ใช่รูป upload เดิม
        const parent = img.closest('[class*="upload"], [class*="input"]');
        if (!parent) {
          return img.src;
        }
      }
    }

    return '';
  }

  // ========== Find Generated Video (เหมือน findGeneratedImage) ==========

  function findGeneratedVideo(excludeSrcs = new Set()) {
    // Helper: ตรวจว่าเป็น video ใหม่หรือไม่
    const isNewVideo = (src) => {
      if (!src) return false;
      if (excludeSrcs.has(src)) return false; // video เดิม
      // เช็ค global seen IDs ด้วย
      const videoId = extractVideoId(src);
      if (window._allSeenVideoIds && window._allSeenVideoIds.has(videoId)) return false;
      // ตรวจอายุ video (ต้องไม่โผล่เร็วเกินไป)
      const videoAge = Date.now() - (window._generationStartTime || Date.now());
      if (videoAge < 1000) return false;
      return true;
    };

    // วิธี 1: หาจาก storage.googleapis.com/ai-sandbox-videofx/video (URL เฉพาะ)
    const videofxVideos = document.querySelectorAll('video[src*="storage.googleapis.com/ai-sandbox-videofx/video"]');
    for (let i = videofxVideos.length - 1; i >= 0; i--) {
      if (isNewVideo(videofxVideos[i].src)) {
        return videofxVideos[i].src;
      }
    }

    // วิธี 2: หาจาก storage.googleapis.com (กว้างขึ้น)
    const storageVideos = document.querySelectorAll('video[src*="storage.googleapis.com"]');
    for (let i = storageVideos.length - 1; i >= 0; i--) {
      if (isNewVideo(storageVideos[i].src)) {
        return storageVideos[i].src;
      }
    }

    // วิธี 3: หาจาก blob: URL
    const blobVideos = document.querySelectorAll('video[src^="blob:"]');
    for (let i = blobVideos.length - 1; i >= 0; i--) {
      if (isNewVideo(blobVideos[i].src)) {
        return blobVideos[i].src;
      }
    }

    // วิธี 4: หา video ที่มี <source> element (บาง player ใช้ source แทน src)
    const allVideos = document.querySelectorAll('video');
    for (let i = allVideos.length - 1; i >= 0; i--) {
      const video = allVideos[i];
      // เช็ค src ตรง
      if (video.src && isNewVideo(video.src)) {
        return video.src;
      }
      // เช็ค <source> elements
      const sources = video.querySelectorAll('source[src]');
      for (const source of sources) {
        if (isNewVideo(source.src)) {
          return source.src;
        }
      }
      // เช็ค currentSrc (ที่กำลังเล่นจริง)
      if (video.currentSrc && isNewVideo(video.currentSrc)) {
        return video.currentSrc;
      }
    }

    // วิธี 5: หา video ใน response/output area
    const responseAreas = document.querySelectorAll('[class*="response"], [class*="output"], [class*="result"], [class*="generated"]');
    for (const area of responseAreas) {
      const video = area.querySelector('video');
      if (video) {
        const src = video.src || video.currentSrc;
        if (isNewVideo(src)) {
          return src;
        }
      }
    }

    return '';
  }

  // ========== Auto Upload Image from URL ==========

  // Fetch image from URL and convert to File object
  async function fetchImageAsFile(imageUrl, filename = 'image.png') {
    try {
      log(`กำลังดาวน์โหลดรูปจาก URL: ${imageUrl.substring(0, 80)}...`, 'info');

      // Fetch image via background script (to bypass CORS)
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'FETCH_IMAGE_AS_BLOB',
          url: imageUrl
        }, (response) => {
          if (response?.success) {
            resolve(response);
          } else {
            reject(new Error(response?.error || 'Failed to fetch image'));
          }
        });
      });

      // Convert base64 to blob
      const base64Data = response.data;
      const mimeType = response.mimeType || 'image/png';

      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });

      // Create File object
      const file = new File([blob], filename, { type: mimeType });
      log(`ดาวน์โหลดรูปสำเร็จ: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, 'success');

      return file;
    } catch (error) {
      log(`ไม่สามารถดาวน์โหลดรูป: ${error.message}`, 'error');
      return null;
    }
  }

  // Upload file to hidden file input
  async function uploadFileToInput(file) {
    try {
      // หา file input ที่อาจซ่อนอยู่
      const fileInputs = document.querySelectorAll('input[type="file"]');
      log(`พบ file input ${fileInputs.length} อัน`, 'info');

      if (fileInputs.length === 0) {
        log('ไม่พบ file input', 'warning');
        return false;
      }

      // ใช้ input ตัวล่าสุด (มักเป็นตัวที่เพิ่งเปิด)
      const fileInput = fileInputs[fileInputs.length - 1];

      // Create DataTransfer to set files
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Trigger events
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));

      log('อัพโหลดรูปเข้า file input แล้ว', 'success');
      return true;
    } catch (error) {
      log(`ไม่สามารถอัพโหลดรูป: ${error.message}`, 'error');
      return false;
    }
  }

  // Convert base64 data URL to File object
  function base64ToFile(base64DataUrl, filename = 'image.png') {
    try {
      const arr = base64DataUrl.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], filename, { type: mime });
    } catch (error) {
      log(`ไม่สามารถแปลง base64 เป็น File: ${error.message}`, 'error');
      return null;
    }
  }

  // Check if string is a URL (not base64)
  function isUrl(str) {
    return str && (str.startsWith('http://') || str.startsWith('https://'));
  }

  // Fetch URL and convert to File object
  async function urlToFile(url, filename = 'image.png') {
    try {
      log(`│  🌐 กำลัง fetch รูปจาก URL...`, 'info');
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const mimeType = blob.type || 'image/png';
      const file = new File([blob], filename, { type: mimeType });
      log(`│  ✅ Fetch สำเร็จ: ${(file.size / 1024).toFixed(1)} KB`, 'success');
      return file;
    } catch (error) {
      log(`ไม่สามารถ fetch รูปจาก URL: ${error.message}`, 'error');
      return null;
    }
  }

  // Convert image (URL or base64) to File
  async function imageToFile(imageData, filename = 'image.png') {
    if (!imageData) return null;

    if (isUrl(imageData)) {
      return await urlToFile(imageData, filename);
    } else {
      return base64ToFile(imageData, filename);
    }
  }


  // ========== Expose Utilities to ctx ==========
  ctx.STATES = STATES;
  ctx.DELAYS = DELAYS;
  ctx.TRANSLATIONS = TRANSLATIONS;
  ctx.matchesAny = matchesAny;
  ctx.extractVideoId = extractVideoId;
  ctx.log = log;
  ctx.delay = delay;
  ctx.waitForElement = waitForElement;
  ctx.humanClick = humanClick;
  ctx.findElementByText = findElementByText;
  ctx.findButtonByIcon = findButtonByIcon;
  ctx.detectGenerationError = detectGenerationError;
  ctx.snapshotExistingErrors = snapshotExistingErrors;
  ctx.checkDailyLimit = checkDailyLimit;
  ctx.showDailyLimitPopup = showDailyLimitPopup;
  ctx.fetchImageAsFile = fetchImageAsFile;
  ctx.uploadFileToInput = uploadFileToInput;
  ctx.base64ToFile = base64ToFile;
  ctx.isUrl = isUrl;
  ctx.urlToFile = urlToFile;
  ctx.imageToFile = imageToFile;
  ctx.findGeneratedImage = findGeneratedImage;
  ctx.clearFlowCache = clearFlowCache;
  // ctx.isAlreadyInCreateImageMode — ลบแล้ว (UI ใหม่ไม่มี Create Image combobox)

  ctx.selectFirstImageInPanel = selectFirstImageInPanel;
  ctx.selectImageInPanel = selectImageInPanel;

  // 99% stuck detection
  ctx.STUCK_99_TIMEOUT = STUCK_99_TIMEOUT;
  ctx.handleStuckAt99 = handleStuckAt99;

  // Handler registry - Video+Extend script จะ register handlers ที่นี่
  ctx.handlers = ctx.handlers || {};



  // ========== State Handlers ==========

  // isAlreadyInCreateImageMode() — ลบแล้ว: UI ใหม่ไม่มี "Create Image" combobox

  async function handleOpenConfigDropdown() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 1/9: เปิด Config Dropdown', 'step');
    sendStepStatus('Step 1/9: เปิด Config Dropdown', 'info');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // หา config dropdown button (อยู่ข้าง Create button)
    // Image mode: <button aria-haspopup="menu">🍌 Nano Banana Pro <i>crop_9_16</i> x1 <div data-type="button-overlay"></div></button>
    // Video mode: <button aria-haspopup="menu">Video <i>crop_16_9</i> x1 <div data-type="button-overlay"></div></button>

    // ใช้ waitForElement รอ page render (สำหรับ fresh tab ที่ยัง render ไม่เสร็จ)
    const configBtn = await waitForElement(() => {
      // วิธี 1: หา button[aria-haspopup="menu"] ที่มี icon crop_9_16 หรือ crop_16_9 (เจาะจงที่สุด)
      const menuBtns = document.querySelectorAll('button[aria-haspopup="menu"]');
      for (const btn of menuBtns) {
        const icon = btn.querySelector('i.google-symbols, i.material-icons');
        const iconText = icon?.textContent?.trim() || '';
        if (iconText === 'crop_9_16' || iconText === 'crop_16_9') {
          log('พบ Config dropdown จาก aspect ratio icon', 'info');
          return btn;
        }
      }
      // วิธี 2: หา button[aria-haspopup="menu"] ที่มี text "x1"-"x4"
      for (const btn of menuBtns) {
        const text = btn.textContent || '';
        if (/x[1-4]/.test(text)) {
          log('พบ Config dropdown จาก xN text', 'info');
          return btn;
        }
      }
      // วิธี 3: หา button ที่อยู่ข้าง Create button (arrow_forward)
      const createBtn = findButtonByIcon('arrow_forward');
      if (createBtn) {
        const sibling = createBtn.previousElementSibling;
        if (sibling && sibling.tagName === 'BUTTON' && sibling.getAttribute('aria-haspopup') === 'menu') {
          log('พบ Config dropdown จาก sibling ของ Create button', 'info');
          return sibling;
        }
      }
      return null;
    }, 15000);

    if (!configBtn) {
      log('ไม่พบ Config dropdown - ข้ามขั้นตอนนี้', 'warning');
      return STATES.SELECT_IMAGE_MODE;
    }

    // เช็คว่าเปิดอยู่แล้วหรือไม่
    const state = configBtn.getAttribute('data-state') || '';
    const expanded = configBtn.getAttribute('aria-expanded');
    if (state === 'open' || expanded === 'true') {
      log('Config dropdown เปิดอยู่แล้ว - ข้ามขั้นตอนนี้', 'info');
      return STATES.SELECT_IMAGE_MODE;
    }

    // กด Config dropdown — ส่ง message ไป background.js เพื่อ executeScript ใน MAIN world
    // (inline <script> โดน CSP บล็อก, isolated world click ไม่ trigger React/Radix handler)
    log('ส่ง CLICK_CONFIG_DROPDOWN ไป background.js (MAIN world)...', 'info');
    const clickResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CLICK_CONFIG_DROPDOWN' }, (response) => {
        if (chrome.runtime.lastError) {
          log('sendMessage error: ' + chrome.runtime.lastError.message, 'error');
          resolve(false);
          return;
        }
        const success = response && response.success;
        log(`CLICK_CONFIG_DROPDOWN result: ${success}`, 'info');
        resolve(success);
      });
    });

    if (clickResult) {
      log('กด Config dropdown (MAIN world) สำเร็จ!', 'success');
    } else {
      log('MAIN world click ไม่สำเร็จ - ลอง humanClick fallback', 'warning');
      humanClick(configBtn);
    }

    await delay(1500);

    // เช็คว่าเปิดสำเร็จไหม
    const afterState = configBtn.getAttribute('data-state') || '';
    const afterExpanded = configBtn.getAttribute('aria-expanded');
    if (afterState === 'open' || afterExpanded === 'true') {
      log('Config dropdown เปิดสำเร็จ!', 'success');
    } else {
      log(`ยังไม่เปิด (state=${afterState}, expanded=${afterExpanded}) - ลอง humanClick อีกครั้ง`, 'warning');
      humanClick(configBtn);
      await delay(1500);
    }

    await delay(DELAYS.AFTER_CLICK);
    return STATES.SELECT_IMAGE_MODE;
  }

  async function handleSelectImageMode() {
    const isVideo = currentMode === 'video';
    const tabLabel = isVideo ? 'Video' : 'Image';
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log(`📍 Step 2/9: กด tab ${tabLabel}`, 'step');
    sendStepStatus(`Step 2/9: เลือกโหมด ${tabLabel}`, 'info');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // Snapshot รูปที่มีอยู่ก่อน UI เปลี่ยน
    ctx.earlyImgSrcs = new Set();
    document.querySelectorAll('img').forEach(img => {
      if (img.src) ctx.earlyImgSrcs.add(img.src);
    });
    log(`📸 Early snapshot: จดจำภาพเดิม ${ctx.earlyImgSrcs.size} รูป (ก่อน UI เปลี่ยน)`, 'info');

    // กำหนด target ตาม mode
    const triggerId = isVideo ? 'trigger-VIDEO' : 'trigger-IMAGE';
    const iconName = isVideo ? 'videocam' : 'image';
    const textMatches = isVideo ? ['Video', 'Videos'] : ['Image', 'Images'];

    let targetButton = null;
    const tabBtns8s = document.querySelectorAll('button[role="tab"]');

    // วิธี 1: button[role="tab"] ที่มี id ตรงกับ trigger
    for (const tab of tabBtns8s) {
      const tabId = tab.id || '';
      if (tabId.includes(triggerId)) {
        targetButton = tab;
        log(`พบ tab จาก id ${triggerId}`, 'info');
        break;
      }
    }
    // วิธี 2: button[role="tab"] ที่มี icon ตรง
    if (!targetButton) {
      for (const tab of tabBtns8s) {
        const icon = tab.querySelector('i.google-symbols');
        if (icon && icon.textContent.trim() === iconName) {
          targetButton = tab;
          log(`พบ tab จาก icon "${iconName}"`, 'info');
          break;
        }
      }
    }
    // วิธี 3: button[role="tab"] ที่มี text ตรง
    if (!targetButton) {
      for (const tab of tabBtns8s) {
        const text = tab.textContent?.trim() || '';
        if (textMatches.some(m => text === m || text.endsWith(m))) {
          targetButton = tab;
          log(`พบ tab จาก text "${text}"`, 'info');
          break;
        }
      }
    }

    if (!targetButton) {
      log(`ไม่พบ ${tabLabel} tab — ข้ามไป SET_MODEL`, 'info');
      return STATES.SET_MODEL;
    }

    const tabState = targetButton.getAttribute('data-state') || '';
    const tabSelected = targetButton.getAttribute('aria-selected');
    if (tabState === 'active' || tabSelected === 'true') {
      log(`${tabLabel} tab ถูกเลือกอยู่แล้ว`, 'success');
    } else {
      humanClick(targetButton);
      log(`กด ${tabLabel} tab แล้ว`, 'success');
    }

    await delay(DELAYS.AFTER_CLICK);

    // Video mode: กด Frames tab เพิ่ม (sub-tab ภายใน Video)
    // DOM: [Ingredients tab] [Frames tab]
    // Element: <button role="tab" id="...-trigger-VIDEO_FRAMES"><i>crop_free</i>Frames</button>
    if (isVideo) {
      log('🔍 หาปุ่ม Frames tab...', 'info');
      await delay(500); // รอ sub-tabs โหลด

      let framesTab = null;
      const subTabs = document.querySelectorAll('button[role="tab"]');

      // วิธี 1: id มี trigger-VIDEO_FRAMES
      for (const tab of subTabs) {
        if ((tab.id || '').includes('trigger-VIDEO_FRAMES')) {
          framesTab = tab;
          log('พบ Frames tab จาก id trigger-VIDEO_FRAMES', 'info');
          break;
        }
      }
      // วิธี 2: icon crop_free
      if (!framesTab) {
        for (const tab of subTabs) {
          const icon = tab.querySelector('i.google-symbols');
          if (icon && icon.textContent.trim() === 'crop_free') {
            framesTab = tab;
            log('พบ Frames tab จาก icon crop_free', 'info');
            break;
          }
        }
      }
      // วิธี 3: text "Frames"
      if (!framesTab) {
        for (const tab of subTabs) {
          const text = tab.textContent?.trim() || '';
          if (text === 'Frames' || text.endsWith('Frames')) {
            framesTab = tab;
            log('พบ Frames tab จาก text', 'info');
            break;
          }
        }
      }

      if (framesTab) {
        const frState = framesTab.getAttribute('data-state') || '';
        const frSelected = framesTab.getAttribute('aria-selected');
        if (frState === 'active' || frSelected === 'true') {
          log('Frames tab ถูกเลือกอยู่แล้ว', 'success');
        } else {
          humanClick(framesTab);
          log('กด Frames tab แล้ว', 'success');
        }
        await delay(DELAYS.AFTER_CLICK);
      } else {
        log('ไม่พบ Frames tab — ข้ามไป', 'warning');
      }
    }

    return STATES.SET_MODEL;
  }

  // handleSelectCreateImage() — ลบแล้ว: UI ใหม่ไม่มี "Create Image" dropdown
  // ตั้งค่าผ่าน Config Dropdown (OPEN_CONFIG_DROPDOWN → SET_MODEL → ...) แทน

  async function handleClickAddButtons() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 7/9: กดปุ่ม Add + อัปรูปผ่าน Assets Panel', 'step');
    sendStepStatus('Step 7/9: อัปรูป Start Frame', 'info');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    const isVideo = currentMode === 'video';

    // เตรียมรายการรูปที่จะ upload
    const imagesToUpload = [];

    if (isVideo) {
      // Video mode: ใช้ภาพจาก Image Gen result (lastPictureUrl)
      const imageUrl = ctx.lastPictureUrl || window._lastPictureUrl || automationData?.pictureUrl || automationData?.productImageUrl;
      if (imageUrl) {
        imagesToUpload.push({ name: 'ภาพจาก Image Gen', data: imageUrl });
        log(`Video mode: ใช้ภาพจาก Image Gen (${imageUrl.substring(0, 60)}...)`, 'info');
      } else {
        log('Video mode: ไม่พบภาพจาก Image Gen (lastPictureUrl) — ข้ามการ upload', 'warning');
      }
    } else {
      // Image mode: ดึงรูปจาก chrome.storage.local ที่เก็บไว้ตอน Product Set
      let savedImages = null;
      try {
        const projectUrl = automationData?.projectUrl || window.location.href;
        const storageKey = 'flow_ingredient_images_' + projectUrl;
        const result = await chrome.storage.local.get(storageKey);
        savedImages = result[storageKey] || null;
        if (savedImages) {
          log(`พบรูป ingredient ที่เก็บไว้: ตัวละคร=${savedImages.characterImageUrl ? 'มี' : 'ไม่มี'}, สินค้า=${savedImages.productImageUrl ? 'มี' : 'ไม่มี'}`, 'info');
        } else {
          log('ไม่พบรูป ingredient ใน storage — จะลองดึงจาก automationData แทน', 'warning');
        }
      } catch (e) {
        log(`อ่าน storage ไม่ได้: ${e.message}`, 'warning');
      }

      if (savedImages?.characterImageUrl) imagesToUpload.push({ name: 'ตัวละคร', data: savedImages.characterImageUrl });
      if (savedImages?.productImageUrl) imagesToUpload.push({ name: 'สินค้า', data: savedImages.productImageUrl });

      // Fallback: ดึงรูปจาก automationData โดยตรง (จาก Viral mode / story-pipeline.js)
      if (imagesToUpload.length === 0) {
        log(`[Debug] automationData keys: ${Object.keys(automationData || {}).join(', ')}`, 'info');
        log(`[Debug] characterImageUrl: ${automationData?.characterImageUrl ? 'มี (' + automationData.characterImageUrl.substring(0, 30) + '...)' : 'ไม่มี'}`, 'info');
        log(`[Debug] productImageUrl: ${automationData?.productImageUrl ? 'มี (' + automationData.productImageUrl.substring(0, 30) + '...)' : 'ไม่มี'}`, 'info');
        if (automationData?.characterImageUrl) imagesToUpload.push({ name: 'ตัวละคร', data: automationData.characterImageUrl });
        if (automationData?.productImageUrl) imagesToUpload.push({ name: 'สินค้า', data: automationData.productImageUrl });
        if (imagesToUpload.length > 0) log(`พบรูป ingredient จาก automationData: ${imagesToUpload.length} รูป`, 'info');
      }
    }

    // === Video mode: กด Start div → Upload ===
    // === Image mode: กด Add button → Upload ===
    if (isVideo) {
      // Video mode: หา "Start" div (Frames layout: [Start] [Swap ↔] [End])
      // Element: <div aria-haspopup="dialog" data-state="closed">Start</div>
      function findStartDiv() {
        // วิธี 1: div[aria-haspopup="dialog"] ที่มี text "Start"
        const haspopupDivs = document.querySelectorAll('div[aria-haspopup="dialog"]');
        for (const div of haspopupDivs) {
          if (div.textContent?.trim() === 'Start') return div;
        }
        // วิธี 2: div ที่มี text "Start" ใน container ที่มี swap_horiz
        const swapBtns = document.querySelectorAll('button');
        for (const btn of swapBtns) {
          const icon = btn.querySelector('i');
          if (icon && icon.textContent?.trim() === 'swap_horiz') {
            const container = btn.parentElement;
            if (container) {
              const startDiv = container.querySelector('div[aria-haspopup="dialog"]');
              if (startDiv && startDiv.textContent?.trim() === 'Start') return startDiv;
            }
          }
        }
        return null;
      }

      if (imagesToUpload.length > 0) {
        const startDiv = findStartDiv();
        if (!startDiv) {
          log('ไม่พบ Start div — ข้ามไป FILL_PROMPT', 'warning');
          return STATES.FILL_PROMPT;
        }

        log('กด Start div...', 'info');
        humanClick(startDiv);
        log('กด Start div แล้ว — รอ Assets Panel เปิด...', 'info');

        // รอ Assets Panel เปิด
        const panelOpened = await waitForElement(() => {
          const searchInput = document.querySelector('input[placeholder*="Search for Assets"]');
          if (searchInput) return searchInput;
          const spans = document.querySelectorAll('span');
          for (const span of spans) {
            if (span.textContent?.includes('Recently Used')) return span;
          }
          // Video mode: อาจเปิด Upload dialog โดยตรง
          const uploadBtns = document.querySelectorAll('button');
          for (const btn of uploadBtns) {
            const span = btn.querySelector('span');
            if (span && span.textContent.trim() === 'Upload image') return btn;
          }
          return null;
        }, 5000);

        if (!panelOpened) {
          log('Assets Panel / Upload dialog ไม่เปิด — ข้ามไป', 'warning');
        } else {
          log('Panel/Dialog เปิดแล้ว', 'success');
          await delay(500);

          // กดปุ่ม Upload
          const uploadBtn = await waitForElement(() => {
            const btns = document.querySelectorAll('button');
            for (const btn of btns) {
              const span = btn.querySelector('span');
              if (span && span.textContent.trim() === 'Upload image') return btn;
            }
            for (const btn of btns) {
              const icon = btn.querySelector('i.google-symbols');
              if (icon && icon.textContent.trim() === 'upload') return btn;
            }
            return null;
          }, 3000);

          if (uploadBtn) {
            humanClick(uploadBtn);
            log('กดปุ่ม Upload แล้ว', 'success');
            await delay(1000);
          }

          // แปลง image → File → upload ผ่าน file input
          const imageData = imagesToUpload[0].data;
          const file = await imageToFile(imageData, 'start_frame.png');

          // Baseline snapshot ก่อน upload
          const baselineImgs = document.querySelectorAll('img[alt="Generated image"]').length;

          if (file) {
            log(`แปลงรูปสำเร็จ: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, 'success');
            const uploaded = await uploadFileToInput(file);
            if (uploaded) {
              log('อัปรูป Start frame เข้า file input สำเร็จ', 'success');
            } else {
              log('อัปรูป Start frame ล้มเหลว — ไม่พบ file input', 'warning');
            }
          } else {
            log('แปลงรูป Start frame ล้มเหลว', 'warning');
          }

          // รอ upload เสร็จ
          log('⏳ รอ upload Start frame เสร็จ...', 'info');
          await delay(3000);
          let sawProgress = false;
          let noProgressCount = 0;
          for (let p = 0; p < 60; p++) {
            await delay(1000);
            let hasProgress = false, progressText = '';
            for (const el of document.querySelectorAll('div')) {
              const text = el.textContent?.trim() || '';
              if (/^\d+%$/.test(text)) { hasProgress = true; progressText = text; break; }
            }
            if (hasProgress) { sawProgress = true; noProgressCount = 0; }
            else if (sawProgress) { noProgressCount++; }

            if (hasProgress) { log(`[${p + 1}/60] ยังอัพโหลดอยู่... ${progressText}`, 'info'); continue; }
            if (sawProgress && noProgressCount < 3) { log(`[${p + 1}/60] รอยืนยัน... (${noProgressCount}/3)`, 'info'); continue; }
            if (sawProgress && noProgressCount >= 3) { log('✅ Upload Start frame progress จบแล้ว = upload สำเร็จ', 'success'); break; }

            const curImgs = document.querySelectorAll('img[alt="Generated image"]').length;
            if (curImgs > baselineImgs) {
              log(`✅ อัพโหลด Start frame เสร็จแล้ว! (img: ${baselineImgs}→${curImgs})`, 'success');
              break;
            }
            // ถ้า Start div เปลี่ยนจาก "Start" เป็นมีรูปข้างใน = upload สำเร็จ
            const startAfter = findStartDiv();
            if (!startAfter) {
              log('✅ Start div หายไป/เปลี่ยนแล้ว = upload สำเร็จ', 'success');
              break;
            }
            log(`[${p + 1}/60] รอ... (img: ${curImgs})`, 'info');
          }
        }
        // === End Frame: กด End div → Upload รูปเดียวกัน ===
        if (automationData?.skipEndFrame) {
          log('⏭️ ข้าม End Frame (mode 8s — skipEndFrame=true)', 'info');
        } else {
        log('── End Frame ──', 'info');
        await delay(1500);

        function findEndDiv() {
          const haspopupDivs = document.querySelectorAll('div[aria-haspopup="dialog"]');
          for (const div of haspopupDivs) {
            if (div.textContent?.trim() === 'End') return div;
          }
          // fallback: หา End ใน container ที่มี swap_horiz
          const swapBtns = document.querySelectorAll('button');
          for (const btn of swapBtns) {
            const icon = btn.querySelector('i');
            if (icon && icon.textContent?.trim() === 'swap_horiz') {
              const container = btn.parentElement;
              if (container) {
                const endDiv = container.querySelector('div[aria-haspopup="dialog"]');
                if (endDiv && endDiv.textContent?.trim() === 'End') return endDiv;
              }
            }
          }
          return null;
        }

        const endDiv = findEndDiv();
        if (!endDiv) {
          log('ไม่พบ End div — ข้ามไป', 'warning');
        } else {
          log('กด End div...', 'info');
          humanClick(endDiv);
          log('กด End div แล้ว — รอ Assets Panel เปิด...', 'info');

          const endPanelOpened = await waitForElement(() => {
            const searchInput = document.querySelector('input[placeholder*="Search for Assets"]');
            if (searchInput) return searchInput;
            const spans = document.querySelectorAll('span');
            for (const span of spans) {
              if (span.textContent?.includes('Recently Used')) return span;
            }
            const uploadBtns = document.querySelectorAll('button');
            for (const btn of uploadBtns) {
              const span = btn.querySelector('span');
              if (span && span.textContent.trim() === 'Upload image') return btn;
            }
            return null;
          }, 5000);

          if (!endPanelOpened) {
            log('End: Assets Panel / Upload dialog ไม่เปิด — ข้าม', 'warning');
          } else {
            log('End: Panel/Dialog เปิดแล้ว', 'success');
            await delay(500);

            // กดปุ่ม Upload
            const endUploadBtn = await waitForElement(() => {
              const btns = document.querySelectorAll('button');
              for (const btn of btns) {
                const span = btn.querySelector('span');
                if (span && span.textContent.trim() === 'Upload image') return btn;
              }
              for (const btn of btns) {
                const icon = btn.querySelector('i.google-symbols');
                if (icon && icon.textContent.trim() === 'upload') return btn;
              }
              return null;
            }, 3000);

            if (endUploadBtn) {
              humanClick(endUploadBtn);
              log('End: กดปุ่ม Upload แล้ว', 'success');
              await delay(1000);
            }

            // Upload รูปเดียวกัน
            const endImageData = imagesToUpload[0].data;
            const endFile = await imageToFile(endImageData, 'end_frame.png');

            const endBaselineImgs = document.querySelectorAll('img[alt="Generated image"]').length;

            if (endFile) {
              log(`End: แปลงรูปสำเร็จ: ${endFile.name} (${(endFile.size / 1024).toFixed(1)} KB)`, 'success');
              const endUploaded = await uploadFileToInput(endFile);
              if (endUploaded) {
                log('End: อัปรูป End frame เข้า file input สำเร็จ', 'success');
              } else {
                log('End: อัปรูป End frame ล้มเหลว — ไม่พบ file input', 'warning');
              }
            } else {
              log('End: แปลงรูป End frame ล้มเหลว', 'warning');
            }

            // รอ upload เสร็จ
            log('⏳ รอ upload End frame เสร็จ...', 'info');
            await delay(3000);
            let endSawProgress = false;
            let endNoProgressCount = 0;
            for (let p = 0; p < 60; p++) {
              await delay(1000);
              let hasProgress = false, progressText = '';
              for (const el of document.querySelectorAll('div')) {
                const text = el.textContent?.trim() || '';
                if (/^\d+%$/.test(text)) { hasProgress = true; progressText = text; break; }
              }
              if (hasProgress) { endSawProgress = true; endNoProgressCount = 0; }
              else if (endSawProgress) { endNoProgressCount++; }

              if (hasProgress) { log(`End: [${p + 1}/60] ยังอัพโหลดอยู่... ${progressText}`, 'info'); continue; }
              if (endSawProgress && endNoProgressCount < 3) { log(`End: [${p + 1}/60] รอยืนยัน... (${endNoProgressCount}/3)`, 'info'); continue; }
              if (endSawProgress && endNoProgressCount >= 3) { log('✅ Upload End frame progress จบแล้ว = upload สำเร็จ', 'success'); break; }

              const curImgs = document.querySelectorAll('img[alt="Generated image"]').length;
              if (curImgs > endBaselineImgs) {
                log(`✅ อัพโหลด End frame เสร็จแล้ว! (img: ${endBaselineImgs}→${curImgs})`, 'success');
                break;
              }
              const endAfter = findEndDiv();
              if (!endAfter) {
                log('✅ End div หายไป/เปลี่ยนแล้ว = upload สำเร็จ', 'success');
                break;
              }
              log(`End: [${p + 1}/60] รอ... (img: ${curImgs})`, 'info');
            }
          }
        }
        } // end else skipEndFrame
      } else {
        log('Video mode: ไม่มีรูปให้ upload — ข้ามไป', 'warning');
      }

      return STATES.FILL_PROMPT;
    }

    // === Image mode (เหมือนเดิม): กด Add button → Upload ===
    // หาปุ่ม Add จาก button[aria-haspopup="dialog"] + icon "add_2"
    function findAddButtons() {
      const btns = [];
      // วิธี 1: button[aria-haspopup="dialog"] ที่มี icon "add_2" (UI ใหม่)
      const dialogBtns = document.querySelectorAll('button[aria-haspopup="dialog"]');
      for (const btn of dialogBtns) {
        const icon = btn.querySelector('i.google-symbols');
        if (icon && icon.textContent.trim() === 'add_2') btns.push(btn);
      }
      // วิธี 2: button ที่มี hidden span "Create" + icon "add_2"
      if (btns.length === 0) {
        const allBtns = document.querySelectorAll('button');
        for (const btn of allBtns) {
          const span = btn.querySelector('span');
          const icon = btn.querySelector('i.google-symbols');
          if (span && span.textContent.trim() === 'Create' && icon && icon.textContent.trim() === 'add_2') btns.push(btn);
        }
      }
      // วิธี 3 (fallback): icon "add_2" ใน button ใดๆ
      if (btns.length === 0) {
        const allIcons = document.querySelectorAll('i.google-symbols');
        for (const icon of allIcons) {
          if (icon.textContent.trim() === 'add_2') {
            const button = icon.closest('button');
            if (button) btns.push(button);
          }
        }
      }
      return btns;
    }

    const addButtons = findAddButtons();
    log(`พบปุ่ม Add จำนวน ${addButtons.length} ปุ่ม`, 'info');

    if (addButtons.length === 0) {
      log('ไม่พบปุ่ม Add', 'warning');
      return STATES.FILL_PROMPT;
    }

    // ถ้ามีรูปจาก Product Set → กด Add แล้ว Upload ทีละรูป
    if (imagesToUpload.length > 0) {
      for (let i = 0; i < imagesToUpload.length; i++) {
        // หาปุ่ม Add ใหม่ทุกรอบ (เพราะ DOM อาจเปลี่ยนหลัง upload)
        const currentAddBtns = findAddButtons();
        if (currentAddBtns.length === 0) {
          log(`ไม่พบปุ่ม Add สำหรับรูปที่ ${i + 1}`, 'warning');
          break;
        }

        log(`── รอบ ${i + 1}/${imagesToUpload.length}: อัปรูป${imagesToUpload[i].name} ──`, 'info');
        humanClick(currentAddBtns[0]);
        log('กดปุ่ม Add แล้ว — รอ Assets Panel เปิด...', 'info');

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

        if (!panelOpened) {
          log('Assets Panel ไม่เปิด — ข้ามไป', 'warning');
          await delay(DELAYS.AFTER_CLICK);
          continue;
        }
        log('Assets Panel เปิดแล้ว', 'success');
        await delay(500);

        // กดปุ่ม Upload (⬆ icon) ใน Assets Panel
        let uploadBtnClicked = false;
        const uploadBtn = await waitForElement(() => {
          const btns = document.querySelectorAll('button');
          // วิธี 1: button ที่มี hidden span "Upload image" (UI ใหม่)
          for (const btn of btns) {
            const span = btn.querySelector('span');
            if (span && span.textContent.trim() === 'Upload image') return btn;
          }
          // วิธี 2: button ที่มี icon "upload" (google-symbols)
          for (const btn of btns) {
            const icon = btn.querySelector('i.google-symbols');
            if (icon && icon.textContent.trim() === 'upload') return btn;
          }
          // วิธี 3 (fallback): icon "file_upload" หรือ "cloud_upload"
          for (const btn of btns) {
            const icon = btn.querySelector('i.google-symbols, i.material-icons');
            const iconText = icon?.textContent?.trim() || '';
            if (iconText === 'file_upload' || iconText === 'cloud_upload') return btn;
          }
          return null;
        }, 3000);

        if (uploadBtn) {
          humanClick(uploadBtn);
          uploadBtnClicked = true;
          log('กดปุ่ม Upload ใน Assets Panel แล้ว', 'success');
          await delay(1000);
        } else {
          log('ไม่พบปุ่ม Upload ใน Assets Panel', 'warning');
        }

        // แปลง image data เป็น File แล้ว upload ผ่าน file input
        const imageData = imagesToUpload[i].data;
        const filename = imagesToUpload[i].name === 'สินค้า' ? 'product.png' : 'character.png';
        const file = await imageToFile(imageData, filename);

        // Baseline snapshot ก่อน upload
        const baselineImgs = document.querySelectorAll('img[alt="Generated image"]').length;
        const baselineCancel = Array.from(document.querySelectorAll('i.google-symbols')).filter(ic => ic.textContent.trim() === 'cancel').length;

        if (file) {
          log(`แปลงรูปสำเร็จ: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, 'success');
          const uploaded = await uploadFileToInput(file);
          if (uploaded) {
            log(`อัปรูป${imagesToUpload[i].name}เข้า file input สำเร็จ`, 'success');
          } else {
            log(`อัปรูป${imagesToUpload[i].name}ล้มเหลว — ไม่พบ file input`, 'warning');
          }
        } else {
          log(`แปลงรูป${imagesToUpload[i].name}ล้มเหลว`, 'warning');
        }

        // รอ upload เสร็จ (polling เทียบ baseline เหมือน Product Set)
        log(`⏳ รอ upload ${imagesToUpload[i].name}เสร็จ...`, 'info');
        await delay(3000); // รอ DOM stabilize
        let sawProgress = false;
        let noProgressCount = 0;
        for (let p = 0; p < 60; p++) {
          await delay(1000);
          let hasProgress = false, progressText = '';
          for (const el of document.querySelectorAll('div')) {
            const text = el.textContent?.trim() || '';
            if (/^\d+%$/.test(text)) { hasProgress = true; progressText = text; break; }
          }
          if (hasProgress) { sawProgress = true; noProgressCount = 0; }
          else if (sawProgress) { noProgressCount++; }

          if (hasProgress) { log(`[${p + 1}/60] ยังอัพโหลดอยู่... ${progressText}`, 'info'); continue; }
          if (sawProgress && noProgressCount < 3) { log(`[${p + 1}/60] รอยืนยัน... (${noProgressCount}/3)`, 'info'); continue; }
          if (sawProgress && noProgressCount >= 3) { log(`✅ Upload ${imagesToUpload[i].name} progress จบแล้ว = upload สำเร็จ`, 'success'); break; }

          const curImgs = document.querySelectorAll('img[alt="Generated image"]').length;
          if (curImgs > baselineImgs) {
            log(`✅ อัพโหลด${imagesToUpload[i].name}เสร็จแล้ว! (img: ${baselineImgs}→${curImgs})`, 'success');
            break;
          }
          log(`[${p + 1}/60] รอ... (img: ${curImgs})`, 'info');
        }
      }
    } else {
      // ไม่มีรูปจาก Product Set / automationData — ข้ามไป (ไม่เลือก img element จาก panel)
      log('ไม่มีรูป ingredient ให้ upload — ข้ามไป FILL_PROMPT', 'info');
    }

    return STATES.FILL_PROMPT;
  }

  // Helper function: เลือกภาพในช่องที่เปิดอยู่ แล้วไป Settings
  async function selectImageInPanel() {
    log('กำลังหาภาพในช่องเพื่อเลือก...', 'info');

    // วิธี 1: หา img element ที่อยู่ใน grid/gallery panel
    const imageContainers = document.querySelectorAll('[class*="gallery"] img, [class*="grid"] img, [class*="panel"] img, [class*="picker"] img');

    if (imageContainers.length > 0) {
      // เลือกภาพแรก
      const firstImage = imageContainers[0];
      humanClick(firstImage);
      log('เลือกภาพในช่องแล้ว (จาก container)', 'success');
      return true;
    }

    // วิธี 2: หา img ที่อยู่ใน div ที่ clickable (ไม่ใช่ใน button add)
    const allImages = document.querySelectorAll('img');
    for (const img of allImages) {
      // ข้าม img ที่อยู่ใน button
      if (img.closest('button')) continue;

      // หา img ที่อยู่ใน div ที่ดูเหมือน gallery item
      const parent = img.parentElement;
      if (parent && parent.tagName === 'DIV') {
        const rect = img.getBoundingClientRect();
        // ตรวจสอบว่า img มีขนาดพอสมควร (ไม่ใช่ icon เล็กๆ)
        if (rect.width > 50 && rect.height > 50) {
          humanClick(img);
          log('เลือกภาพในช่องแล้ว (จาก img element)', 'success');
          return true;
        }
      }
    }

    // วิธี 3: หา div ที่มี background-image
    const divsWithBg = document.querySelectorAll('div[style*="background-image"]');
    for (const div of divsWithBg) {
      const rect = div.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 50) {
        humanClick(div);
        log('เลือกภาพในช่องแล้ว (จาก div background)', 'success');
        return true;
      }
    }

    // วิธี 4: หา element ที่มี role="option" หรือ data-* ที่ดูเหมือน selectable item
    const selectableItems = document.querySelectorAll('[role="option"], [role="listitem"], [data-selected], [data-selectable]');
    for (const item of selectableItems) {
      const rect = item.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.top > 0) {
        humanClick(item);
        log('เลือกภาพในช่องแล้ว (จาก selectable item)', 'success');
        return true;
      }
    }

    log('ไม่พบภาพในช่องให้เลือก - อาจต้อง upload เอง', 'warning');
    return false;
  }

  // Helper function สำหรับ Step 3: เลือกภาพแรกใน panel (สำหรับ Frames to Video)
  async function selectFirstImageInPanel() {
    log('กำลังหาภาพแรกใน panel...', 'info');

    // รอให้ panel โหลดภาพ
    await delay(500);

    // วิธี 1: หาจาก span ที่มีข้อความ "A media asset previously uploaded"
    const allSpans = document.querySelectorAll('span');
    for (const span of allSpans) {
      if (span.textContent?.includes('A media asset previously uploaded')) {
        // หา parent button
        const button = span.closest('button');
        if (button) {
          humanClick(button);
          log('เลือกภาพจาก media asset button แล้ว', 'success');
          return true;
        }
      }
    }

    // วิธี 2: หาจาก button.sc-fbea20b2 (media asset button ของ Google Flow)
    const mediaButtons = document.querySelectorAll('button[class*="sc-fbea20b2"]');
    if (mediaButtons.length > 0) {
      const firstButton = mediaButtons[0];
      humanClick(firstButton);
      log('เลือกภาพแรกจาก media button แล้ว', 'success');
      return true;
    }

    // วิธี 3: หา img ที่อยู่ใน panel/gallery/grid
    const panelImages = document.querySelectorAll('[class*="gallery"] img, [class*="grid"] img, [class*="panel"] img, [class*="picker"] img, [class*="media"] img');
    if (panelImages.length > 0) {
      const firstImg = panelImages[0];
      const clickableParent = firstImg.closest('button') || firstImg.closest('[role="button"]') || firstImg.parentElement;
      humanClick(clickableParent || firstImg);
      log('เลือกภาพแรกจาก panel images แล้ว', 'success');
      return true;
    }

    // วิธี 4: หา img ที่มีขนาดพอสมควร (ไม่ใช่ icon)
    const allImages = document.querySelectorAll('img');
    for (const img of allImages) {
      const rect = img.getBoundingClientRect();
      // ต้องเป็นภาพที่มองเห็น และมีขนาดมากกว่า 50x50 (ไม่ใช่ icon)
      if (rect.width > 50 && rect.height > 50 && rect.top > 0) {
        // ข้าม img ที่อยู่ใน header/nav/toolbar
        const parent = img.closest('header, nav, [class*="toolbar"]');
        if (parent) continue;

        const clickableParent = img.closest('button') || img.closest('[role="button"]') || img.parentElement;
        humanClick(clickableParent || img);
        log('เลือกภาพแรกจาก img element แล้ว', 'success');
        return true;
      }
    }

    // วิธี 5: หา div ที่มี background-image
    const divsWithBg = document.querySelectorAll('div[style*="background-image"]');
    for (const div of divsWithBg) {
      const rect = div.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 50 && rect.top > 0) {
        humanClick(div);
        log('เลือกภาพแรกจาก div background แล้ว', 'success');
        return true;
      }
    }

    log('ไม่พบภาพใน panel', 'warning');
    return false;
  }

  async function handleOpenSettings() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4/9: เปิด Settings', 'step');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // หาปุ่ม Settings (icon: tune)
    const settingsButton = findButtonByIcon('tune');

    if (!settingsButton) {
      log('ไม่พบปุ่ม Settings', 'error');
      return STATES.ERROR;
    }

    humanClick(settingsButton);
    log('กดปุ่ม Settings แล้ว', 'success');

    await delay(DELAYS.AFTER_CLICK);
    return STATES.SET_MODEL;
  }

  async function handleSetModel() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

    const isVideo = currentMode === 'video';
    let targetModel;

    if (isVideo) {
      const { useVeoLowerPriority } = await chrome.storage.local.get('useVeoLowerPriority');
      targetModel = useVeoLowerPriority ? 'Veo 3.1 - Lower Priority' : 'Veo 3.1 - Fast';
    } else {
      // Read useNanoBanana setting from chrome.storage
      const { useNanoBanana } = await chrome.storage.local.get('useNanoBanana');
      targetModel = useNanoBanana ? 'Nano Banana 2' : 'Nano Banana Pro';
    }

    log(`📍 Step 3/9: ตั้งค่า Model → ${targetModel}`, 'step');
    sendStepStatus(`Step 3/9: ตั้ง Model → ${targetModel}`, 'info');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // หา dropdown Model
    // UI ใหม่: <button aria-haspopup="menu">Imagen 4 <i>arrow_drop_down</i> <div data-type="button-overlay"></div></button>
    let modelDropdown = null;

    // วิธี 1: button[aria-haspopup="menu"] ที่มี icon "arrow_drop_down" (เจาะจงที่สุด)
    const menuBtns = document.querySelectorAll('button[aria-haspopup="menu"]');
    for (const btn of menuBtns) {
      const icon = btn.querySelector('i.google-symbols, i.material-icons');
      const iconText = icon?.textContent?.trim() || '';
      if (iconText === 'arrow_drop_down') {
        modelDropdown = btn;
        log('พบ dropdown Model จาก arrow_drop_down icon', 'info');
        break;
      }
    }

    // วิธี 2: button[aria-haspopup="menu"] ที่มี text model name
    if (!modelDropdown) {
      for (const btn of menuBtns) {
        const text = btn.textContent || '';
        if (text.includes('Banana') || text.includes('Imagen') || text.includes('Veo')) {
          modelDropdown = btn;
          log('พบ dropdown Model จาก model name text', 'info');
          break;
        }
      }
    }

    // วิธี 3 (legacy): button[role="combobox"]
    if (!modelDropdown) {
      const comboboxes = document.querySelectorAll('button[role="combobox"]');
      for (const btn of comboboxes) {
        const text = btn.textContent || '';
        if (matchesAny(text, TRANSLATIONS.model) || text.includes('Banana') || text.includes('Imagen')) {
          modelDropdown = btn;
          log('พบ dropdown Model จาก combobox fallback', 'info');
          break;
        }
      }
    }

    if (!modelDropdown) {
      log('ไม่พบ dropdown Model - ข้ามไป', 'warning');
      return STATES.SET_ASPECT_RATIO;
    }

    // กด Model dropdown ผ่าน MAIN world (เหมือน Config Dropdown — มี overlay บัง)
    log('ส่ง CLICK_MODEL_DROPDOWN ไป background.js (MAIN world)...', 'info');
    const modelClickResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CLICK_MODEL_DROPDOWN' }, (response) => {
        if (chrome.runtime.lastError) {
          log('sendMessage error: ' + chrome.runtime.lastError.message, 'error');
          resolve(false);
          return;
        }
        resolve(response && response.success);
      });
    });
    if (modelClickResult) {
      log('กด dropdown Model (MAIN world) สำเร็จ!', 'success');
    } else {
      log('MAIN world ไม่สำเร็จ - ลอง humanClick', 'warning');
      humanClick(modelDropdown);
    }

    await delay(DELAYS.AFTER_CLICK);
    await delay(1000);

    // หา target model option
    let targetModelOption = null;

    // ฟังก์ชันเช็คว่า text ตรงกับ target model หรือไม่
    function matchesTargetModel(text) {
      if (isVideo) {
        // Video: หา model ตาม targetModel ที่เลือก
        if (targetModel.includes('Lower Priority')) {
          return text.includes('Veo 3.1') && text.includes('Lower Priority');
        }
        return text.includes('Veo 3.1') && text.includes('Fast');
      } else {
        // Image: Nano Banana หรือ Nano Banana Pro
        if (targetModel === 'Nano Banana') {
          return text.includes('Nano Banana') && !text.includes('Pro');
        } else {
          return text.includes('Nano Banana Pro');
        }
      }
    }

    // วิธี 1: หาจาก role="option" หรือ role="menuitem"
    const options = document.querySelectorAll('[role="option"], [role="menuitem"], [data-radix-collection-item]');
    for (const opt of options) {
      const optText = opt.textContent || '';
      if (matchesTargetModel(optText)) {
        targetModelOption = opt;
        log(`พบ ${targetModel} จาก role="option"`, 'info');
        break;
      }
    }

    // วิธี 2: หาจาก div ที่มี text
    if (!targetModelOption) {
      const divs = document.querySelectorAll('div');
      for (const div of divs) {
        const text = div.textContent?.trim() || '';
        if (matchesTargetModel(text) && div.children.length <= 3) {
          targetModelOption = div;
          log(`พบ ${targetModel} จาก div text match`, 'info');
          break;
        }
      }
    }

    // วิธี 3: หาจาก span
    if (!targetModelOption) {
      const spans = document.querySelectorAll('span');
      for (const span of spans) {
        const spanText = span.textContent || '';
        if (matchesTargetModel(spanText)) {
          targetModelOption = span.closest('[role="menuitem"]') || span.closest('div') || span;
          log(`พบ ${targetModel} จาก span`, 'info');
          break;
        }
      }
    }

    if (targetModelOption) {
      log(`กำลังกด ${targetModel} option: ${targetModelOption.tagName}.${targetModelOption.className}`, 'info');
      targetModelOption.click();
      await delay(200);
      humanClick(targetModelOption);
      log(`เลือก ${targetModel} แล้ว`, 'success');
    } else {
      log(`ไม่พบตัวเลือก ${targetModel}`, 'warning');
    }

    await delay(DELAYS.AFTER_CLICK);
    return STATES.SET_ASPECT_RATIO;
  }

  async function handleSetAspectRatio() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4/9: ตั้งค่า Aspect Ratio → Portrait (9:16)', 'step');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // === วิธีใหม่: หา Portrait tab (button[role="tab"]) ===
    let portraitTab = null;

    // วิธี 1: หาจาก button[role="tab"] ที่มี text "Portrait" หรือ icon "crop_9_16" หรือ id มี "PORTRAIT"
    const tabs = document.querySelectorAll('button[role="tab"], button[role="radio"]');
    for (const tab of tabs) {
      const text = tab.textContent?.trim().toLowerCase() || '';
      const icon = tab.querySelector('i.google-symbols, i.material-icons');
      const tabId = tab.id || '';
      if (text.includes('portrait') || icon?.textContent?.trim() === 'crop_9_16' || tabId.includes('PORTRAIT')) {
        portraitTab = tab;
        log('พบ Portrait tab', 'info');
        break;
      }
    }

    if (portraitTab) {
      // เช็คว่า Portrait ถูกเลือกแล้วหรือยัง
      const state = portraitTab.getAttribute('data-state') || '';
      if (state === 'active' || state === 'on' || portraitTab.getAttribute('aria-selected') === 'true') {
        log('Portrait ถูกเลือกแล้ว - ข้ามขั้นตอนนี้', 'success');
        await delay(DELAYS.AFTER_CLICK);
        return STATES.SET_OUTPUT_COUNT;
      }

      humanClick(portraitTab);
      log('กด Portrait tab แล้ว', 'success');
      await delay(DELAYS.AFTER_CLICK);
      return STATES.SET_OUTPUT_COUNT;
    }

    // === Fallback: วิธีเก่า combobox dropdown ===
    log('ไม่พบ Portrait tab - ลอง combobox fallback', 'info');
    let aspectRatioDropdown = null;
    const comboboxes = document.querySelectorAll('button[role="combobox"]');
    for (const btn of comboboxes) {
      const text = btn.textContent || '';
      if (text.includes('Aspect Ratio') || matchesAny(text, TRANSLATIONS.landscape) || matchesAny(text, TRANSLATIONS.portrait)) {
        aspectRatioDropdown = btn;
        break;
      }
    }

    if (!aspectRatioDropdown) {
      log('ไม่พบ dropdown Aspect Ratio', 'warning');
      return STATES.SET_OUTPUT_COUNT;
    }

    humanClick(aspectRatioDropdown);
    log('กด dropdown Aspect Ratio แล้ว', 'success');
    await delay(DELAYS.AFTER_CLICK);
    await delay(1000);

    const options = document.querySelectorAll('[role="option"], [data-radix-collection-item]');
    for (const opt of options) {
      if (opt.textContent?.includes('Portrait')) {
        humanClick(opt);
        log('เลือก Portrait (9:16) แล้ว', 'success');
        break;
      }
    }

    await delay(DELAYS.AFTER_CLICK);
    return STATES.SET_OUTPUT_COUNT;
  }

  async function handleSetOutputCount() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 5/9: ตั้งค่า Outputs per prompt → 1', 'step');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // === วิธีใหม่: หา tab "x1" (button[role="tab"]) ===
    const tabs = document.querySelectorAll('button[role="tab"], button[role="radio"]');
    for (const tab of tabs) {
      const text = tab.textContent?.trim() || '';
      const tabId = tab.id || '';
      if (text === 'x1' || tabId.includes('trigger-1')) {
        const state = tab.getAttribute('data-state') || '';
        if (state === 'active' || state === 'on' || tab.getAttribute('aria-selected') === 'true') {
          log('Output x1 ถูกเลือกแล้ว - ข้ามขั้นตอนนี้', 'success');
          return STATES.CLOSE_CONFIG_DROPDOWN;
        }
        humanClick(tab);
        log('กด tab x1 แล้ว', 'success');
        await delay(DELAYS.AFTER_CLICK);
        return STATES.CLOSE_CONFIG_DROPDOWN;
      }
    }

    // === Fallback: combobox dropdown ===
    log('ไม่พบ tab x1 - ลอง combobox fallback', 'info');
    let outputsDropdown = null;
    const comboboxes = document.querySelectorAll('button[role="combobox"]');
    for (const btn of comboboxes) {
      const text = btn.textContent || '';
      if (text.includes('Outputs') || text.includes('per prompt')) {
        outputsDropdown = btn;
        break;
      }
    }
    if (!outputsDropdown && comboboxes.length >= 2) {
      outputsDropdown = comboboxes[1];
    }
    if (!outputsDropdown) {
      log('ไม่พบ dropdown Outputs per prompt', 'warning');
      return STATES.CLOSE_CONFIG_DROPDOWN;
    }
    humanClick(outputsDropdown);
    await delay(DELAYS.AFTER_CLICK);
    await delay(1000);
    const options = document.querySelectorAll('[role="option"], [data-radix-collection-item]');
    for (const opt of options) {
      if (opt.textContent?.trim() === '1') {
        humanClick(opt);
        log('เลือก 1 แล้ว (combobox)', 'success');
        break;
      }
    }
    await delay(DELAYS.AFTER_CLICK);
    return STATES.CLOSE_CONFIG_DROPDOWN;
  }

  // Step 6/9: กดปิด Config Dropdown
  async function handleCloseConfigDropdown() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 6/9: กดปิด Config Dropdown', 'step');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // หา config dropdown button ที่เปิดอยู่ (data-state="open" หรือ aria-expanded="true")
    const menuBtns = document.querySelectorAll('button[aria-haspopup="menu"]');
    let configBtn = null;

    for (const btn of menuBtns) {
      const icon = btn.querySelector('i.google-symbols, i.material-icons');
      const iconText = icon?.textContent?.trim() || '';
      if (iconText === 'crop_9_16' || iconText === 'crop_16_9') {
        configBtn = btn;
        break;
      }
    }

    if (!configBtn) {
      log('ไม่พบ Config dropdown - ข้ามขั้นตอนนี้', 'warning');
      return STATES.CLICK_ADD_BUTTONS;
    }

    const state = configBtn.getAttribute('data-state') || '';
    const expanded = configBtn.getAttribute('aria-expanded');
    if (state === 'closed' || expanded === 'false') {
      log('Config dropdown ปิดอยู่แล้ว - ข้ามขั้นตอนนี้', 'info');
      return STATES.CLICK_ADD_BUTTONS;
    }

    // ส่ง CLICK_CONFIG_DROPDOWN ไป background.js เพื่อ toggle ปิด
    log('ส่ง CLICK_CONFIG_DROPDOWN ไป background.js เพื่อปิด...', 'info');
    const clickResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CLICK_CONFIG_DROPDOWN' }, (response) => {
        if (chrome.runtime.lastError) {
          log('sendMessage error: ' + chrome.runtime.lastError.message, 'error');
          resolve(false);
          return;
        }
        resolve(response && response.success);
      });
    });

    if (clickResult) {
      log('กดปิด Config dropdown สำเร็จ!', 'success');
    } else {
      log('MAIN world click ไม่สำเร็จ - ลอง humanClick fallback', 'warning');
      humanClick(configBtn);
    }

    await delay(DELAYS.AFTER_CLICK);
    return STATES.CLICK_ADD_BUTTONS;
  }

  // กดปุ่ม Settings อีกครั้งก่อนกรอก Prompt (legacy — ไม่ใช้ใน UI ใหม่)
  async function handleClickSettingsBeforePrompt() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 6.5/8: กดปุ่ม Settings ก่อนกรอก Prompt', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    // หาปุ่ม Settings (icon: tune)
    let settingsButton = null;
    const icons = document.querySelectorAll('i.material-icons, i.google-symbols');

    for (const icon of icons) {
      if (icon.textContent.trim() === 'tune') {
        const button = icon.closest('button');
        if (button) {
          settingsButton = button;
          break;
        }
      }
    }

    if (settingsButton) {
      humanClick(settingsButton);
      log('กดปุ่ม Settings (tune) แล้ว', 'success');
      await delay(DELAYS.AFTER_CLICK);
    } else {
      log('ไม่พบปุ่ม Settings (tune) - ข้ามไป', 'warning');
    }

    return STATES.FILL_PROMPT;
  }

  async function handleFillPrompt() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 8/9: ใส่ Prompt', 'step');
    sendStepStatus('Step 8/9: ใส่ Prompt', 'info');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    const isVideo = currentMode === 'video';
    let prompt;
    if (isVideo) {
      const extendCount = window._extendCurrentCount || 0;
      if (extendCount === 0) {
        prompt = automationData?.videoPrompt;
      } else if (extendCount === 1) {
        prompt = automationData?.videoPrompt2 || automationData?.extendVideoPrompts?.[0] || automationData?.videoPrompt;
      } else {
        prompt = automationData?.extendVideoPrompts?.[extendCount - 2] || automationData?.videoPrompt2 || automationData?.videoPrompt;
      }
      log(`🎬 Video prompt (extend #${extendCount}): ${prompt?.substring(0, 50)}...`, 'info');
    } else {
      prompt = automationData?.imagePrompt;
    }
    if (!prompt) {
      log(`❌ ไม่มี prompt ใน automationData — ไม่สามารถสร้างได้`, 'error');
      return STATES.ERROR;
    }

    // ขั้นตอน 1: คลิก editor ให้ active ก่อน
    const slateEditorClick = document.querySelector('div[role="textbox"][data-slate-editor="true"]');
    if (slateEditorClick) {
      log('👆 คลิก editor ให้ active...', 'info');
      humanClick(slateEditorClick);
      await delay(500);
      slateEditorClick.focus();
      await delay(300);
      log('✅ Editor active แล้ว', 'success');
    }

    // ขั้นตอน 2: ใส่ prompt ผ่าน MAIN world
    const promptHolder = document.createElement('div');
    promptHolder.id = '__fill_prompt_data';
    promptHolder.setAttribute('data-prompt', prompt);
    promptHolder.style.display = 'none';
    document.body.appendChild(promptHolder);

    log('กำลังใส่ prompt (MAIN world)...', 'info');
    const fillResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'FILL_PROMPT_MAIN' }, (resp) => {
        resolve(resp || { success: false, error: 'no response' });
      });
    });
    // ลบ holder ถ้ายังอยู่
    const leftoverHolder = document.getElementById('__fill_prompt_data');
    if (leftoverHolder) leftoverHolder.remove();

    if (fillResult.success) {
      log(`ใส่ Prompt สำเร็จ (MAIN: ${fillResult.method}, ${prompt.length} ตัวอักษร)`, 'success');
    } else {
      log(`MAIN world failed: ${fillResult.error || fillResult.method} → fallback`, 'warning');

      // Fallback: Slate isolated world
      let slateEditor = document.querySelector('div[role="textbox"][data-slate-editor="true"]');
      if (slateEditor) {
        slateEditor.focus();
        await delay(300);
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, prompt);
        log(`ใส่ Prompt แล้ว (isolated fallback, ${prompt.length} ตัวอักษร)`, 'success');
      } else {
        // Fallback: textarea เก่า
        let textarea = document.getElementById('PINHOLE_TEXT_AREA_ELEMENT_ID');
        if (!textarea) textarea = document.querySelector('textarea');

        if (!textarea) {
          log('ไม่พบ editor หรือ textarea สำหรับใส่ Prompt', 'error');
          return STATES.ERROR;
        }

        textarea.focus();
        await delay(200);
        textarea.value = '';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.value = prompt;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        log(`ใส่ Prompt แล้ว (textarea, ${prompt.length} ตัวอักษร)`, 'success');
      }
    }

    await delay(DELAYS.AFTER_CLICK);
    return STATES.CLICK_GENERATE;
  }

  async function handleClickGenerate() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

    const isVideo = currentMode === 'video';
    const genLabel = isVideo ? 'วิดีโอ' : 'ภาพ';

    log(`📍 Step 9/9: กดปุ่ม Generate และรอ${genLabel}`, 'step');
    sendStepStatus(`Step 9/9: กด Generate รอ${genLabel}`, 'info');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // หาปุ่ม Generate (icon: arrow_forward + span "Create")
    let generateButton = findButtonByIcon('arrow_forward');
    // Fallback: หา button ที่มี span "Create" + icon arrow_forward
    if (!generateButton) {
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const icon = btn.querySelector('i.google-symbols');
        if (icon && icon.textContent.trim() === 'arrow_forward') {
          generateButton = btn;
          break;
        }
      }
    }

    if (!generateButton) {
      log('ไม่พบปุ่ม Generate', 'error');
      return STATES.ERROR;
    }

    // Snapshot error elements ก่อนกด Generate
    const existingErrorElements = snapshotExistingErrors();
    log(`📸 Snapshot error elements เดิม: ${existingErrorElements.size} อัน`, 'info');

    if (isVideo) {
      // ===== VIDEO MODE (ใช้ findGeneratedVideo เหมือน Image mode) =====
      // จับ existing video srcs ก่อนกด Generate (เหมือน Image mode จับ existingImgSrcs)
      const existingVideoSrcs = new Set();
      document.querySelectorAll('video').forEach(v => {
        if (v.src) existingVideoSrcs.add(v.src);
        if (v.currentSrc) existingVideoSrcs.add(v.currentSrc);
        v.querySelectorAll('source[src]').forEach(s => existingVideoSrcs.add(s.src));
      });
      log(`📊 มี video เดิม ${existingVideoSrcs.size} อัน`, 'info');

      window._generationStartTime = Date.now();
      humanClick(generateButton);
      log('กดปุ่ม Generate แล้ว!', 'success');

      const maxWaitTime = automationData?.videoGenDelay || DELAYS.GEN_VIDEO_WAIT;
      const pollInterval = 5000;
      let elapsed = 0;
      let videoUrl = '';
      let pollCount = 0;
      let hasSeenProgress = false;
      let progressGoneCount = 0;

      log(`🔍 เริ่มรอวิดีโอใหม่ (Progress polling, max ${maxWaitTime / 1000} วินาที)...`, 'info');

      while (elapsed < maxWaitTime) {
        if (shouldStop) { log('🛑 หยุดการทำงานระหว่างรอ video', 'warning'); throw new Error('STOPPED'); }
        await checkStopWithStorage();
        pollCount++;

        // ตรวจจับ Daily Limit
        if (checkDailyLimit()) {
          log('🍌 ตรวจพบ Daily Limit! หยุดทำงานทั้งหมด', 'warning');
          showDailyLimitPopup();
          isRunning = false;
          currentState = STATES.IDLE;
          try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_COMPLETE', success: false, rowId: savedVideoRowId || automationData?.rowId, error: 'DAILY_LIMIT_REACHED' }); } catch (e) {}
          return STATES.IDLE;
        }

        // ดึง Progress % จาก UI
        let realProgress = null;
        let status = 'waiting';
        for (const div of document.querySelectorAll('div')) {
          const text = div.innerText?.trim();
          if (text && /^\d+%$/.test(text)) { realProgress = parseInt(text); status = 'generating'; break; }
        }

        if (realProgress !== null && realProgress > 0) {
          if (!hasSeenProgress) log(`🚀 เริ่ม generate จริงแล้ว! (progress: ${realProgress}%)`, 'info');
          hasSeenProgress = true;
          progressGoneCount = 0;

          // ตรวจจับ 99% ค้าง
          if (realProgress === 99) {
            if (stuckAt99StartTime === null) {
              stuckAt99StartTime = Date.now();
              log(`⚠️ Progress ถึง 99% - เริ่มจับเวลา...`, 'warning');
            } else {
              const stuckDuration = Date.now() - stuckAt99StartTime;
              if (stuckDuration >= STUCK_99_TIMEOUT) {
                log(`⚠️ 99% ค้างนานเกิน ${STUCK_99_TIMEOUT / 1000} วินาที! กำลังล้าง cookies...`, 'error');
                await handleStuckAt99();
                return STATES.ERROR;
              }
            }
          } else {
            stuckAt99StartTime = null;
          }
        }

        // ตรวจจับ Generation Error (เช็คทุกรอบเหมือน image mode)
        const vidGenError = detectGenerationError(existingErrorElements);
        if (vidGenError.hasError) {
          window._videoGenRetryCount = (window._videoGenRetryCount || 0) + 1;
          log(`⚠️ [Video Gen] Error: "${vidGenError.errorMessage}" (retry ${window._videoGenRetryCount}/5)`, 'warning');

          if (window._videoGenRetryCount >= 5) {
            log(`❌ [Video Gen] retry 5 ครั้งแล้ว - หยุด`, 'error');
            window._videoGenRetryCount = 0;
            try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_COMPLETE', success: false, rowId: savedVideoRowId || automationData?.rowId, error: vidGenError.errorMessage }); } catch (e) {}
            isRunning = false;
            return STATES.IDLE;
          }

          // ปิด error popup/toast
          const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') || document.querySelector('button[aria-label="Close"]');
          if (dismissBtn) { dismissBtn.click(); await delay(500); }

          // retry: กด Generate อีกครั้ง
          if (vidGenError.errorMessage.toLowerCase().includes("couldn't generate")) {
            log(`🔄 กด Generate อีกครั้ง...`, 'info');
            const retryGenBtn = Array.from(document.querySelectorAll('button')).find(b => {
              const icon = b.querySelector('i');
              return icon && icon.textContent.includes('arrow_forward');
            });
            if (retryGenBtn) { retryGenBtn.click(); hasSeenProgress = false; progressGoneCount = 0; await delay(3000); continue; }
          }

          await delay(3000);
          log(`🔄 [Video Gen] กลับไป retry video generation...`, 'info');
          return STATES.CLICK_GENERATE;
        }

        // ถ้าเคยเห็น progress แล้วหายไป = น่าจะ Gen เสร็จ (เหมือน Image mode)
        if (hasSeenProgress && realProgress === null) {
          progressGoneCount++;
          log(`Progress หายไป (${progressGoneCount}/2)...`, 'info');
          if (progressGoneCount >= 2) {
            videoUrl = findGeneratedVideo(existingVideoSrcs);
            if (videoUrl) {
              const videoId = extractVideoId(videoUrl);
              window._allSeenVideoIds.add(videoId);
              log(`✅ พบวิดีโอแล้วหลังรอ ${elapsed / 1000} วินาที! (poll ครั้งที่ ${pollCount})`, 'success');
              log(`🎬 URL: ${videoUrl.substring(0, 100)}...`, 'info');
              window._videoGenRetryCount = 0;
              break;
            }
          }
        }

        // ยังไม่เห็น progress → ลองหา video เผื่อเสร็จเร็ว (เหมือน Image mode)
        if (!hasSeenProgress && elapsed > 10000) {
          videoUrl = findGeneratedVideo(existingVideoSrcs);
          if (videoUrl) {
            const videoId = extractVideoId(videoUrl);
            window._allSeenVideoIds.add(videoId);
            log(`✅ พบวิดีโอแล้วหลังรอ ${elapsed / 1000} วินาที! (poll ครั้งที่ ${pollCount})`, 'success');
            log(`🎬 URL: ${videoUrl.substring(0, 100)}...`, 'info');
            window._videoGenRetryCount = 0;
            break;
          }
        }

        // Send progress update to React app + log ทุก 15 วินาที
        const progress = realProgress !== null ? realProgress : Math.min(Math.round((elapsed / maxWaitTime) * 100), 99);
        const progressSource = realProgress !== null ? 'UI' : 'calc';
        if (elapsed % 15000 < pollInterval) {
          log(`📊 Video polling: ${progress}% [${progressSource}] — ${Math.round(elapsed / 1000)}s/${Math.round(maxWaitTime / 1000)}s — ${status}`, 'info');
        }
        try {
          chrome.runtime.sendMessage({ type: 'VIDEO_GEN_PROGRESS', data: { rowId: savedVideoRowId || automationData?.rowId, progress, elapsed: elapsed / 1000, maxWait: maxWaitTime / 1000, status, step: 'Step3' } });
        } catch (e) {}

        await delay(pollInterval);
        elapsed += pollInterval;
      }

      // Fallback: หมดเวลา ลองหา video อีกรอบ (ใช้ findGeneratedVideo ซึ่งมี fallback หลายวิธี)
      if (!videoUrl) {
        log('⚠️ หมดเวลา polling - ลองหา video ใหม่ (findGeneratedVideo fallback)...', 'warning');
        videoUrl = findGeneratedVideo(existingVideoSrcs);
        if (videoUrl) {
          const videoId = extractVideoId(videoUrl);
          window._allSeenVideoIds.add(videoId);
          log(`พบ Video ใหม่จาก fallback! URL: ${videoUrl.substring(0, 100)}...`, 'success');
        } else {
          log('❌ หมดเวลา polling และไม่พบ video ใหม่', 'error');
        }
      }

      // ส่ง videoUrl กลับ (เลือก message type ตาม extend count)
      if (videoUrl) {
        const rowIdToSend = savedVideoRowId || automationData?.rowId;
        const extendCount = window._extendCurrentCount || 0;

        if (extendCount > 0 && automationData?.extendedMode) {
          // Extend clip → ส่ง EXTENDED_VIDEO_URL_RESULT
          log(`ส่ง Extend Video URL #${extendCount} กลับ...`, 'info');
          try {
            chrome.runtime.sendMessage({
              type: 'EXTENDED_VIDEO_URL_RESULT',
              data: { rowId: rowIdToSend, url: videoUrl, videoExtendUrl: videoUrl, success: true, extendCount: extendCount }
            });
          } catch (e) { log('ไม่สามารถส่ง Extend Video URL ได้: ' + e.message, 'warning'); }
        } else {
          // First clip → ส่ง VIDEO_URL_RESULT (เหมือนเดิม)
          log('ส่ง Video URL กลับไปอัพเดทตาราง...', 'info');
          try {
            chrome.runtime.sendMessage({ type: 'VIDEO_URL_RESULT', data: { rowId: rowIdToSend, videoUrl: videoUrl } });
          } catch (e) { log('ไม่สามารถส่ง Video URL ได้: ' + e.message, 'warning'); }
        }
        chrome.storage.local.remove('google_flow_retry_data').catch(() => {});
      } else {
        const elapsedSec = Math.round(elapsed / 1000);
        log(`❌ ไม่พบวิดีโอหลังรอ ${elapsedSec} วินาที (poll ${pollCount} ครั้ง)`, 'error');
        try { chrome.runtime.sendMessage({ type: 'VIDEO_GEN_COMPLETE', success: false, rowId: savedVideoRowId || automationData?.rowId, error: `Video not found after ${elapsedSec} seconds` }); } catch (e) {}
      }

      // ตรวจสอบ Extended Mode — วน 9 steps จนครบ
      // _extendCurrentCount: 0=base video, 1=extend#1, 2=extend#2, ...
      // targetExtends = extendClipCount - 1 (จำนวน extend ที่ต้องทำ)
      log(`🔍 Extend check: extendedMode=${automationData?.extendedMode}, extendClipCount=${automationData?.extendClipCount}, videoUrl=${videoUrl ? 'มี' : 'ไม่มี'}`, 'info');
      if (automationData?.extendedMode && videoUrl) {
        const targetExtends = (automationData?.extendClipCount || 2) - 1;
        const currentCount = window._extendCurrentCount || 0;
        log(`🎬 Extend: clip ${currentCount + 1}/${targetExtends + 1} (extend ${currentCount}/${targetExtends})`, 'info');

        if (currentCount < targetExtends) {
          // ยังไม่ครบ → increment แล้ววนกลับ
          window._extendCurrentCount = currentCount + 1;
          log(`🔄 ยังเหลืออีก ${targetExtends - currentCount} clip → วนกลับ OPEN_CONFIG_DROPDOWN (9 steps)`, 'info');
          return STATES.OPEN_CONFIG_DROPDOWN;
        }
        log('🎬 Extended Mode: ครบทุก clip แล้ว!', 'success');
      }

      log('จบ Step 3 - GEN วิดีโอ', 'success');
      return STATES.DONE;

    } else {
      // ===== IMAGE MODE (เหมือนเดิม) =====
      // ก่อนกด Generate: จดจำภาพที่มีอยู่แล้ว
      const existingImgSrcs = new Set();
      document.querySelectorAll('img').forEach(img => {
        if (img.src) existingImgSrcs.add(img.src);
      });
      if (ctx.earlyImgSrcs) {
        for (const src of ctx.earlyImgSrcs) existingImgSrcs.add(src);
      }
      log(`📸 จดจำภาพเดิม ${existingImgSrcs.size} รูป (รวม early snapshot)`, 'info');

      humanClick(generateButton);
      log('กดปุ่ม Generate แล้ว!', 'success');

      const maxWaitTime = DELAYS.GEN_IMAGE_WAIT;
      const pollInterval = 5000;
      let elapsed = 0;
      let pictureUrl = '';
      let pollCount = 0;
      let hasSeenProgress = false;
      let progressGoneCount = 0;

      log(`🔍 เริ่มรอภาพใหม่ (Progress polling, max ${maxWaitTime / 1000} วินาที)...`, 'info');

      while (elapsed < maxWaitTime) {
        if (shouldStop) { log('🛑 หยุดการทำงานระหว่างรอภาพ', 'warning'); throw new Error('STOPPED'); }
        await checkStopWithStorage();
        pollCount++;

        // ตรวจจับ Daily Limit
        if (checkDailyLimit()) {
          log('🍌 ตรวจพบ Daily Limit! หยุดทำงานทั้งหมด', 'warning');
          showDailyLimitPopup();
          isRunning = false;
          currentState = STATES.IDLE;
          try { chrome.runtime.sendMessage({ type: 'AISTUDIO_GEN_COMPLETE', success: false, error: 'DAILY_LIMIT_REACHED' }); } catch (e) {}
          return STATES.IDLE;
        }

        // ดึง Progress % จาก UI
        let realProgress = null;
        for (const div of document.querySelectorAll('div')) {
          const text = div.innerText?.trim();
          if (text && /^\d+%$/.test(text)) { realProgress = parseInt(text); break; }
        }

        if (realProgress !== null && realProgress > 0) {
          if (!hasSeenProgress) log(`🚀 เริ่ม generate จริงแล้ว! (progress: ${realProgress}%)`, 'info');
          hasSeenProgress = true;
          progressGoneCount = 0;

          // ตรวจจับ 99% ค้าง
          if (realProgress === 99) {
            if (stuckAt99StartTime === null) {
              stuckAt99StartTime = Date.now();
              log(`⚠️ Progress ถึง 99% - เริ่มจับเวลา...`, 'warning');
            } else {
              const stuckDuration = Date.now() - stuckAt99StartTime;
              if (stuckDuration >= STUCK_99_TIMEOUT) {
                log(`⚠️ 99% ค้างนานเกิน ${STUCK_99_TIMEOUT / 1000} วินาที! กำลังล้าง cookies...`, 'error');
                await handleStuckAt99();
                return STATES.ERROR;
              }
            }
          } else {
            stuckAt99StartTime = null;
          }
        }

        // ตรวจจับ Generation Error
        const imgGenError = detectGenerationError(existingErrorElements);
        if (imgGenError.hasError) {
          window._imageGenRetryCount = (window._imageGenRetryCount || 0) + 1;
          log(`⚠️ [Image Gen] Error: "${imgGenError.errorMessage}" (retry ${window._imageGenRetryCount}/5)`, 'warning');
          sendStepStatus(`Image Gen Error (retry ${window._imageGenRetryCount}/5): ${(imgGenError.errorMessage || '').substring(0, 50)}`, 'warning');

          if (window._imageGenRetryCount >= 5) {
            log(`❌ [Image Gen] retry 5 ครั้งแล้ว - ข้ามแถวนี้`, 'error');
            sendStepStatus('Image Gen retry 5 ครั้งแล้ว - ข้ามแถวนี้', 'error');
            window._imageGenRetryCount = 0;
            return STATES.ERROR;
          }

          const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') || document.querySelector('button[aria-label="Close"]');
          if (dismissBtn) { dismissBtn.click(); await delay(500); }

          if (imgGenError.errorMessage.toLowerCase().includes("couldn't generate")) {
            log(`🔄 กด Generate อีกครั้ง...`, 'info');
            const retryGenBtn = Array.from(document.querySelectorAll('button')).find(b => {
              const icon = b.querySelector('i');
              return icon && icon.textContent.includes('arrow_forward');
            });
            if (retryGenBtn) { retryGenBtn.click(); hasSeenProgress = false; progressGoneCount = 0; await delay(3000); continue; }
          }

          await delay(3000);
          log(`🔄 [Image Gen] กลับไป retry image generation...`, 'info');
          return STATES.CLICK_GENERATE;
        }

        // ถ้าเคยเห็น progress แล้วหายไป = น่าจะ Gen เสร็จ
        if (hasSeenProgress && realProgress === null) {
          progressGoneCount++;
          log(`Progress หายไป (${progressGoneCount}/2)...`, 'info');
          if (progressGoneCount >= 2) {
            pictureUrl = findGeneratedImage(existingImgSrcs);
            if (pictureUrl) {
              log(`✅ พบภาพแล้วหลังรอ ${elapsed / 1000} วินาที! (poll ครั้งที่ ${pollCount})`, 'success');
              log(`📷 URL: ${pictureUrl.substring(0, 100)}...`, 'info');
              window._imageGenRetryCount = 0;
              ctx.lastPictureUrl = pictureUrl;
              window._lastPictureUrl = pictureUrl;
              break;
            }
          }
        }

        // ยังไม่เห็น progress → ลอง findGeneratedImage เผื่อเสร็จเร็ว
        if (!hasSeenProgress && elapsed > 10000) {
          pictureUrl = findGeneratedImage(existingImgSrcs);
          if (pictureUrl) {
            log(`✅ พบภาพแล้วหลังรอ ${elapsed / 1000} วินาที! (poll ครั้งที่ ${pollCount})`, 'success');
            log(`📷 URL: ${pictureUrl.substring(0, 100)}...`, 'info');
            window._imageGenRetryCount = 0;
            ctx.lastPictureUrl = pictureUrl;
            window._lastPictureUrl = pictureUrl;
            break;
          }
        }

        if (elapsed % 15000 === 0) {
          const status = hasSeenProgress ? `generating (${realProgress || '?'}%)` : 'waiting';
          log(`⏳ ${elapsed / 1000}/${maxWaitTime / 1000}s - ${status}`, 'info');
        }

        await delay(pollInterval);
        elapsed += pollInterval;
      }

      // ส่ง pictureUrl กลับไปให้ background script
      if (pictureUrl) {
        log('ส่ง Picture URL กลับไปอัพเดทตาราง...', 'info');
        try {
          chrome.runtime.sendMessage({ type: 'AISTUDIO_PICTURE_URL', data: { rowId: automationData?.rowId, pictureUrl: pictureUrl } });
          chrome.storage.local.remove('google_flow_retry_data').catch(() => {});
        } catch (e) { log('ไม่สามารถส่ง Picture URL ได้: ' + e.message, 'warning'); }
      } else {
        const elapsedSec = Math.round(elapsed / 1000);
        log(`❌ ไม่พบภาพหลังรอ ${elapsedSec} วินาที (poll ${pollCount} ครั้ง)`, 'error');
        try { chrome.runtime.sendMessage({ type: 'AISTUDIO_GEN_COMPLETE', success: false, error: `Image not found after ${elapsedSec} seconds` }); } catch (e) {}
      }

      log('จบ Step 2 - GEN ภาพ', 'success');
      return STATES.DONE;
    }
  }

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

    // วิธี 3: หาจาก radio buttons ที่มี text Videos
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
    log('📍 Video Step 2/8: เลือกแท็บ Frames', 'step');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

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

      // วิธี 2 (legacy): หาจาก combobox dropdown + "Frames to Video" option
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

  async function handleVideoAddToPrompt() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Video Step 3/8: กดปุ่ม Add To Prompt', 'step');
    log(`⏱️ รอ ${DELAYS.BETWEEN_STEPS}ms ก่อนเริ่ม...`, 'info');

    await delay(DELAYS.BETWEEN_STEPS);

    // หาปุ่ม Add To Prompt
    // วิธี 1: ใช้ selector ที่ผู้ใช้ให้มา
    let addToPromptBtn = document.querySelector('button.sc-c177465c-1.fXPYwM.sc-1e4e26a0-1.kqWfmg');

    // วิธี 2: หาจาก icon 'prompt_suggestion'
    if (!addToPromptBtn) {
      addToPromptBtn = findButtonByIcon('prompt_suggestion');
    }

    // วิธี 3: หาจาก text 'Add To Prompt'
    if (!addToPromptBtn) {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.includes('Add To Prompt') || btn.textContent?.includes('Add to Prompt')) {
          addToPromptBtn = btn;
          break;
        }
      }
    }

    if (!addToPromptBtn) {
      log('ไม่พบปุ่ม Add To Prompt', 'error');
      return STATES.ERROR;
    }

    humanClick(addToPromptBtn);
    log('กดปุ่ม Add To Prompt แล้ว', 'success');

    await delay(DELAYS.AFTER_CLICK);
    await delay(1000); // รอหน้าจอ update

    return STATES.VIDEO_OPEN_SETTINGS;
  }

  async function handleVideoOpenSettings() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Video Step 4/7: เปิด Settings', 'step');
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

    // ถ้าอยู่ใน extend mode → ไปใส่ extend prompt แทน
    if (window._isExtendMode) {
      log('🔀 Extend mode: ไปใส่ Extend Prompt', 'info');
      return STATES.EXTEND_FILL_PROMPT;
    }

    return STATES.VIDEO_FILL_PROMPT;
  }

  async function handleVideoFillPrompt() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Video Step 6/7: ใส่ Video Prompt', 'step');
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
    const prompt = automationData?.videoPrompt;
    if (!prompt) {
      log('❌ ไม่มี videoPrompt ใน automationData — ไม่สามารถสร้างวิดีโอได้', 'error');
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
            rowId: savedVideoRowId || automationData?.rowId,
            error: 'ไม่พบปุ่ม Generate หลังจากลองใหม่ - UI อาจเปลี่ยนแปลง',
            skipRow: true // ข้ามแถวนี้ไป
          }
        });
      } catch (e) { }

      return STATES.ERROR;
    }

    // ⚠️ สำคัญ: จับ existing videos **ก่อน** กด Generate
    // เพื่อไม่ให้ video ที่โผล่มาเร็วจาก cache ถูกนับเป็น "video ใหม่" ผิดๆ
    const existingVideos = document.querySelectorAll('video[src*="storage.googleapis.com/ai-sandbox-videofx/video"]');
    const existingVideoIds = new Set(Array.from(existingVideos).map(v => extractVideoId(v.src)));
    log(`📊 มี video เดิม ${existingVideoIds.size} อัน (IDs: ${[...existingVideoIds].join(', ').substring(0, 80)}...)`, 'info');

    // ✅ NEW: Capture timestamp when generation starts
    window._generationStartTime = Date.now();
    log(`⏱️ เริ่มจับเวลา generation ที่ ${window._generationStartTime}`, 'info');

    humanClick(generateButton);
    log('กดปุ่ม Generate แล้ว!', 'success');

    // Polling แทน Blind wait - ตรวจหา video ทุก 5 วินาที
    const videoWaitTime = automationData?.videoGenDelay || DELAYS.GEN_VIDEO_WAIT;
    const POLL_INTERVAL = 5000; // 5 วินาที
    let elapsed = 0;
    let videoUrl = '';
    let hasSeenProgress = false; // ⚠️ ต้องเห็น progress > 0% ก่อนถึงจะยอมรับ video

    log(`⏳ เริ่ม Polling หา video (Max ${videoWaitTime / 1000} วินาที, ตรวจทุก ${POLL_INTERVAL / 1000} วินาที)`, 'info');

    while (elapsed < videoWaitTime) {
      // 0. เช็ค stop flag ทันทีที่ต้นทุก iteration
      if (shouldStop) {
        log('🛑 หยุดการทำงานระหว่างรอ video', 'warning');
        throw new Error('STOPPED');
      }
      // เช็ค storage ทุก iteration เพื่อให้หยุดเร็วขึ้น
      await checkStopWithStorage();

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
      }

      // 2. Check for new video element - ต้องรอ progress หายไปก่อน!
      const videos = document.querySelectorAll('video[src*="storage.googleapis.com/ai-sandbox-videofx/video"]');

      // หา video ใหม่ที่ไม่เคยมีมาก่อน (เปรียบเทียบด้วย Video ID)
      // ⚠️ สำคัญ: ยอมรับเฉพาะเมื่อ:
      //    1. เคยเห็น progress > 0% (hasSeenProgress = true)
      //    2. progress หายไปแล้ว (realProgress === null) = generation เสร็จ
      const progressGone = hasSeenProgress && realProgress === null;
      if (progressGone) {
        // ✅ Hybrid Detection: ตรวจทั้ง video และ error พร้อมกัน

        // ✅ 1. ตรวจ video ก่อน (collect new videos)
        log(`[Step3] 📊 Global tracking has ${window._allSeenVideoIds.size} videos`, 'info');

        for (const video of videos) {
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
            log(`[Step3] ✅ Found new video: ${videoId} (age: ${(videoAge / 1000).toFixed(1)}s)`, 'success');
            break;
          }
        }

        // ✅ 2. ตรวจ error
        const errorCheck = detectGenerationError();

        // ✅ 3. ตัดสินใจด้วย Hybrid Logic
        if (videoUrl) {
          // ✅ มี video ใหม่ → สำเร็จ (ignore error ถ้ามี)
          if (errorCheck.hasError) {
            log(`[Step3] ⚠️ Video สำเร็จแต่มี error label (ignore): ${errorCheck.errorMessage}`, 'warning');
          }
          log(`[Step3] ✅ Video generation successful!`, 'success');
          // videoUrl will be sent outside this block (line 2210+)
        } else {
          // ❌ ไม่มี video
          if (errorCheck.hasError) {
            // ❌ มี error + ไม่มี video → Retry
            log('[Step3] ❌ Error detected (no video): ' + errorCheck.errorMessage, 'error');

            // ส่ง error กลับไป React เพื่อให้ React retry
            try {
              chrome.runtime.sendMessage({
                type: 'VIDEO_GEN_COMPLETE',
                success: false,
                rowId: savedVideoRowId || automationData?.rowId,
                error: errorCheck.errorMessage
              });
            } catch (e) { }

            // หยุดการทำงาน รอ React retry ใหม่
            isRunning = false;
            return STATES.IDLE;
          }
          // else: ⏳ ไม่มี error + ไม่มี video → Continue polling (do nothing)
        }
      }

      if (videoUrl) {
        log(`🎉 Video generation เสร็จใน ${elapsed / 1000} วินาที (เร็วกว่า max ${(videoWaitTime - elapsed) / 1000} วินาที)`, 'success');
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
            rowId: savedVideoRowId || automationData?.rowId,
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
        // ✅ FIX: Use savedVideoRowId to prevent race condition when new scene starts
        const rowIdToSend = savedVideoRowId || automationData?.rowId;
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

    // ตรวจสอบว่าเปิด Extended Mode หรือไม่
    log(`🔍 Debug: extendedMode=${automationData?.extendedMode}, videoPrompt2=${automationData?.videoPrompt2 ? 'มี (' + automationData.videoPrompt2.length + ' chars)' : 'ไม่มี'}`, 'info');

    if (automationData?.extendedMode && automationData?.videoPrompt2) {
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
      log('🎬 Extended Mode: เริ่ม Step 4 Extend Video (กดแท็บ Videos → เลือก video)', 'step');
      return STATES.EXTEND_CLICK_SCENEBUILDER;  // ไป Step 4.0 กดแท็บ Videos → เลือก video
    }

    log('รอครบแล้ว - จบ Step 3 (ไม่มี Extended หรือ videoPrompt2)', 'success');

    return STATES.DONE;
  }

  // ========== Step 4: Extend Video Handlers (กดแท็บ Videos → เลือก video → Extend) ==========

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

    // 1. หาจาก button[role="tab"] หรือ button[role="radio"] ที่มี text "Videos"
    const radioButtons = document.querySelectorAll('button[role="tab"], button[role="radio"]');
    for (const btn of radioButtons) {
      if (btn.textContent.trim() === 'Videos' || btn.textContent.includes('Videos')) {
        videosTab = btn;
        log('พบแท็บ Videos จาก button[role="tab/radio"]', 'info');
        break;
      }
    }

    // 2. หาจาก class pattern sc-61287434
    if (!videosTab) {
      const scButtons = document.querySelectorAll('button[class*="sc-61287434"]');
      for (const btn of scButtons) {
        if (btn.textContent.includes('Videos')) {
          videosTab = btn;
          log('พบแท็บ Videos จาก class sc-61287434', 'info');
          break;
        }
      }
    }

    // 3. หาจาก icon videocam
    if (!videosTab) {
      const icons = document.querySelectorAll('i.google-symbols');
      for (const icon of icons) {
        if (icon.textContent.trim() === 'videocam') {
          videosTab = icon.closest('button');
          if (videosTab) {
            log('พบแท็บ Videos จาก icon videocam', 'info');
            break;
          }
        }
      }
    }

    // 4. หาจาก text "Videos" ใน button ทั่วไป
    if (!videosTab) {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (text === 'Videos') {
          videosTab = btn;
          log('พบแท็บ Videos จาก text exact match', 'info');
          break;
        }
      }
    }

    // 5. waitForElement fallback
    if (!videosTab) {
      log('⏳ รอ 5 วินาที ให้แท็บ Videos โหลด...', 'info');
      videosTab = await waitForElement(
        () => [...document.querySelectorAll('button')].find(
          btn => btn.textContent.includes('Videos')
        ),
        5000
      );
      if (videosTab) log('พบแท็บ Videos จาก waitForElement', 'info');
    }

    if (!videosTab) {
      log('⚠️ ไม่พบแท็บ "Videos" - ข้ามไป Frames to Video ทันที', 'warning');
      window._isExtendMode = true;
      return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
    }

    humanClick(videosTab);
    log('✅ กดแท็บ "Videos" แล้ว', 'success');

    await delay(2000); // รอให้ video list โหลด

    window._isExtendMode = true;
    return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
  }

  // Step 4.4: คลิกเลือก video ล่าสุด (บนสุด/ซ้ายสุด) ก่อน Add to scene
  async function handleExtendSelectVideo() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.4/14: คลิกเลือก video ล่าสุด (บนสุด)', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    let clicked = false;
    let targetVideo = null;

    // ========== Method 1: เรียงตามตำแหน่ง Y (บนสุด) ==========
    const allVideos = Array.from(document.querySelectorAll('video[src*="storage.googleapis.com/ai-sandbox-videofx/video"]'));
    log(`พบ video elements ทั้งหมด ${allVideos.length} อัน`, 'info');

    if (allVideos.length > 0) {
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
    return STATES.EXTEND_CLICK_ADD_TO_SCENE;
  }

  // Step 4.5: กดปุ่ม "Add to scene" (transition_push icon)
  async function handleExtendClickAddToScene() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.5/14: กดปุ่ม "Add to scene"', 'step');

    await delay(DELAYS.BETWEEN_STEPS);

    // หาปุ่ม "Add to scene" จาก icon transition_push หรือ text
    let addToSceneBtn = findButtonByIcon('transition_push');

    if (!addToSceneBtn) {
      // ลองหาจาก text "Add to scene"
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.includes('Add to scene')) {
          addToSceneBtn = btn;
          break;
        }
      }
    }

    if (!addToSceneBtn) {
      // ลองหาจาก span ข้างใน button
      const spans = document.querySelectorAll('button span');
      for (const span of spans) {
        if (span.textContent.includes('Add to scene')) {
          addToSceneBtn = span.closest('button');
          break;
        }
      }
    }

    if (!addToSceneBtn) {
      log('❌ ไม่พบปุ่ม "Add to scene"', 'error');
      log('💡 ลองหาปุ่มที่มี icon transition_push หรือ text "Add to scene"', 'info');
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
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.8/14: กดเมนู "Extend…"', 'step');

    // ใช้ waitForElement รอให้ menu โหลด (สูงสุด 5 วินาที)
    const extendMenuItem = await waitForElement(() => {
      // 1. หาจาก role="menuitem" ที่มี text "Extend"
      const menuItems = document.querySelectorAll('div[role="menuitem"]');
      for (const item of menuItems) {
        if (item.textContent.includes('Extend')) {
          return item;
        }
      }

      // 2. หาจาก icon logout (รวม material-icons-outlined)
      const icons = document.querySelectorAll('i.google-symbols, i.material-icons, i.material-icons-outlined');
      for (const icon of icons) {
        if (icon.textContent.trim() === 'logout') {
          const menuItem = icon.closest('div[role="menuitem"]');
          if (menuItem) return menuItem;
        }
      }

      return null;
    }, 5000);

    if (!extendMenuItem) {
      log('❌ ไม่พบเมนู "Extend…" (รอ 5 วินาทีแล้ว)', 'error');
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

  // Step 4.10: ใส่ Video Prompt 2 ลงใน textarea
  async function handleExtendFillPrompt() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.10/14: ใส่ Video Prompt 2', 'step');

    const prompt = automationData?.videoPrompt2 || '';
    if (!prompt) {
      log('❌ ไม่มี videoPrompt2', 'error');
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

    humanClick(createBtn);
    log('✅ กดปุ่ม "Create" แล้ว - เริ่ม Generate VDO', 'success');

    return STATES.EXTEND_WAIT_GENERATE;
  }

  // Step 4.12: รอ GEN VDO เสร็จ (Polling พร้อม Progress %)
  async function handleExtendWaitGenerate() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.12/14: รอ VDO Extend Generate (Polling)', 'step');

    const videoWaitTime = automationData?.videoGenDelay || DELAYS.GEN_VIDEO_WAIT;
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
      // เช็ค stop flag ทันทีที่ต้นทุก iteration
      if (shouldStop) {
        log('🛑 หยุดการทำงานระหว่างรอ extend video', 'warning');
        throw new Error('STOPPED');
      }
      await checkStopWithStorage();

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
      } else if (realProgress === null && lastProgressValue !== null) {
        // Progress หายไป
        log(`[Step4] 🔍 Progress หายไป (was ${lastProgressValue}%)`, 'info');
        lastProgressValue = null;
      }

      // ✅ REMOVED: Error check moved inside progressGone block below
      // This prevents false positives from detecting old errors while generating

      // 2. Check for new video - ต้องรอ progress หายไปก่อน!
      let newVideoUrl = null;
      const progressGone = hasSeenProgress && realProgress === null;

      if (progressGone) {
        log(`[Step4] 🔍 Progress หายไป! รอ 5 วินาทีก่อนหา video...`, 'info');
        await delay(5000); // ✅ EXTENDED: รอให้ video โหลด + error label ปรากฏ (ถ้ามี)

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

        // ✅ 2. ตรวจ error
        const errorCheck = detectGenerationError();

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
                      rowId: savedVideoRowId || automationData?.rowId,
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

            // Check max retries
            if (window._extendRetryCount >= 3) {
              log('[Extend] ❌ ล้มเหลว 3 ครั้งแล้ว - ข้ามแถวนี้', 'error');
              try {
                chrome.runtime.sendMessage({
                  type: 'VIDEO_GEN_ERROR',
                  data: {
                    rowId: savedVideoRowId || automationData?.rowId,
                    error: 'Extend video has Failed label after 3 retries',
                    skipRow: true
                  }
                });
              } catch (e) { }
              return STATES.ERROR;
            }

            // Hide error elements
            log('[Extend] 🧹 กำลังซ่อน error elements...', 'info');
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

            // Wait and reset
            await delay(2000);
            window._generationStartTime = null;
            log('[Extend] 🔄 Reset _generationStartTime สำหรับ retry', 'info');

            // กลับไป Step 1
            log('[Extend] 🔄 กลับไป Step 4.0: กดแท็บ Videos ใหม่', 'info');
            return STATES.EXTEND_CLICK_SCENEBUILDER;

          } else {
            // ✅ มี video + ไม่มี Failed label → SUCCESS
            log(`[Step4] ✅ Extended video generation successful!`, 'success');
          }
          // newVideoUrl will be used outside this block
        } else {
          // ❌ ไม่มี video
          if (errorCheck.hasError) {
            // ❌ มี error + ไม่มี video → Retry
            const errorText = errorCheck.errorMessage;
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
                      rowId: savedVideoRowId || automationData?.rowId,
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

            // Check max retries
            if (window._extendRetryCount >= 3) {
              log('[Extend] ❌ ล้มเหลว 3 ครั้งแล้ว - ข้ามแถวนี้', 'error');

              try {
                chrome.runtime.sendMessage({
                  type: 'VIDEO_GEN_ERROR',
                  data: {
                    rowId: savedVideoRowId || automationData?.rowId,
                    error: 'Extend video generation failed after 3 retries',
                    skipRow: true
                  }
                });
              } catch (e) { }

              return STATES.ERROR;
            }

            // ✅ NEW: Force clear error elements from DOM before retry (copied from Step 3)
            log('[Extend] 🧹 กำลังซ่อน error elements เก่า...', 'info');
            try {
              const errorLabels = document.querySelectorAll('*');
              let hiddenCount = 0;
              for (const el of errorLabels) {
                // ✅ เช็คเฉพาะ direct text nodes (ไม่รวม children) เพื่อป้องกันซ่อน parent containers
                const directText = Array.from(el.childNodes)
                  .filter(node => node.nodeType === Node.TEXT_NODE)
                  .map(node => node.textContent.trim())
                  .join(' ');

                if (directText && (directText.includes('Failed Generation') || directText.includes('generation failed'))) {
                  // Mark as hidden only (ไม่ลบออกจาก DOM เพื่อป้องกันทำลาย page structure)
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

            // ✅ NEW: Wait for UI to settle
            await delay(2000);

            // ✅ NEW: Reset tracking flags to ensure clean retry
            window._generationStartTime = null;
            log('[Extend] 🔄 Reset _generationStartTime สำหรับ retry', 'info');

            // ✅ NEW: กลับไป Step 4.0 เพื่อเริ่มใหม่ทั้งหมด (ใช้ prompt เดิม)
            log('[Extend] 🔄 กลับไป Step 4.0: กดแท็บ Videos ใหม่', 'info');
            return STATES.EXTEND_CLICK_SCENEBUILDER;
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

              try {
                chrome.runtime.sendMessage({
                  type: 'VIDEO_GEN_PROGRESS',
                  data: {
                    rowId: savedVideoRowId || automationData?.rowId,
                    progress: -1,
                    elapsed: elapsed / 1000,
                    maxWait: videoWaitTime / 1000,
                    status: 'warning',
                    warning: 'ไม่พบ video ใหม่หลังจาก generation เสร็จ - กำลังรอต่อ...',
                    step: 'Extend'
                  }
                });
              } catch (e) { }
            }

            // ถ้ารอถึง 120 วินาที (24 รอบ) ถึงจะถือว่า Error
            if (window._progressGoneNoVideoCount >= 24) {
              log(`[Extend] ❌ รอนานเกินไป (2 นาที) - ถือว่า Error`, 'error');

              // ส่ง error message แจ้งผู้ใช้
              try {
                chrome.runtime.sendMessage({
                  type: 'EXTEND_VIDEO_ERROR',
                  data: {
                    rowId: savedVideoRowId || automationData?.rowId,
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
        // เก็บ URL ไว้ให้ handleExtendGetBlobUrl ใช้
        window._extendNewVideoUrl = newVideoUrl;
        break;
      }

      // 3. Send progress update
      const progress = realProgress !== null ? realProgress : Math.min(Math.round((elapsed / videoWaitTime) * 100), 99);
      try {
        chrome.runtime.sendMessage({
          type: 'VIDEO_GEN_PROGRESS',
          data: {
            rowId: savedVideoRowId || automationData?.rowId,
            progress: progress,
            elapsed: elapsed / 1000,
            maxWait: videoWaitTime / 1000,
            status: status,
            step: 'Extend'
          }
        });
        // ลบ log ซ้ำ - ให้ React app log แทน (ผ่าน VIDEO_GEN_PROGRESS message)
      } catch (e) { }

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
    log('📍 Step 4.13/14: ดึง Video URL (ขั้นตอนสุดท้าย)', 'step');

    await delay(2000);

    // =========== ถ้า polling เจอ video ใหม่แล้ว ใช้เลย ===========
    if (window._extendNewVideoUrl) {
      const foundUrl = window._extendNewVideoUrl;
      log(`✅ ใช้ Video URL ที่ polling พบแล้ว: ${foundUrl.substring(0, 80)}...`, 'success');
      // clear เพื่อไม่ให้ใช้ซ้ำ
      window._extendNewVideoUrl = null;
      window._extendExistingBlobUrls = null;
      window._extendExistingStorageIds = null;

      // ถ้าเป็น storage URL (permanent) → ส่งกลับเลย
      if (foundUrl.includes('storage.googleapis.com')) {
        try {
          chrome.runtime.sendMessage({
            type: 'EXTENDED_VIDEO_URL_RESULT',
            data: {
              url: foundUrl,
              videoExtendUrl: foundUrl,
              rowId: savedVideoRowId || automationData?.rowId,
              success: true,
              isPermanent: true
            }
          });
          log('✅ ส่ง Permanent URL กลับเรียบร้อย', 'success');
        } catch (e) {
          log('ไม่สามารถส่ง message กลับได้: ' + e.message, 'warning');
        }
        return STATES.EXTEND_COMPLETE;
      }

      // ถ้าเป็น blob URL → ต้อง fetch และ convert เป็น base64 ก่อน!
      // (blob URL จะหมดอายุเมื่อ navigate ไปหน้าอื่น)
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
        const storageKey = `video_extend_${automationData?.rowId}`;
        await chrome.storage.local.set({
          [storageKey]: {
            base64: base64,
            mimeType: blob.type || 'video/mp4',
            size: blob.size,
            blobUrl: foundUrl
          }
        });

        log(`✅ เก็บ video extend ลง storage แล้ว (key: ${storageKey})`, 'success');

        // ส่ง storage key กลับแทน blob URL
        chrome.runtime.sendMessage({
          type: 'EXTENDED_VIDEO_URL_RESULT',
          data: {
            rowId: savedVideoRowId || automationData?.rowId,
            videoExtendUrl: `storage:${storageKey}`,
            url: `storage:${storageKey}`,
            success: true,
            size: blob.size,
            isPermanent: false,
            storageKey: storageKey
          }
        });
        log('✅ ส่ง storage key กลับเรียบร้อย', 'success');
        return STATES.EXTEND_COMPLETE;

      } catch (e) {
        log(`❌ Error fetching blob: ${e.message}`, 'error');
        chrome.runtime.sendMessage({
          type: 'EXTENDED_VIDEO_URL_RESULT',
          data: {
            rowId: savedVideoRowId || automationData?.rowId,
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

    // =========== ถ้ามี permanent URL → ใช้เลย ไม่ต้อง fetch blob ===========
    if (permanentUrl) {
      log('🎯 ใช้ Permanent URL (storage.googleapis.com)', 'success');

      chrome.runtime.sendMessage({
        type: 'EXTENDED_VIDEO_URL_RESULT',
        data: {
          rowId: savedVideoRowId || automationData?.rowId,
          videoExtendUrl: permanentUrl,
          url: permanentUrl,
          success: true,
          isPermanent: true
        }
      });

      log('✅ ส่ง Permanent URL กลับเรียบร้อย', 'success');

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
        const storageKey = `video_extend_${automationData?.rowId}`;
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
            rowId: savedVideoRowId || automationData?.rowId,
            videoExtendUrl: `storage:${storageKey}`,
            url: `storage:${storageKey}`,
            success: true,
            size: blob.size,
            isPermanent: false,
            storageKey: storageKey
          }
        });

        log('✅ ส่ง storage key กลับเรียบร้อย', 'success');

      } catch (e) {
        log(`❌ Error fetching blob: ${e.message}`, 'error');

        chrome.runtime.sendMessage({
          type: 'EXTENDED_VIDEO_URL_RESULT',
          data: {
            rowId: savedVideoRowId || automationData?.rowId,
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
        rowId: savedVideoRowId || automationData?.rowId,
        success: true
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

    // === Back → Forward เพื่อ refresh UI (แก้ bug clips ค้าง) ===
    log('🔄 กด Back/Forward เพื่อ refresh UI...', 'info');
    history.back();
    await delay(2000); // รอหน้าโหลด
    history.forward();
    await delay(2000); // รอ SceneBuilder โหลดกลับมา

    // === รอบ 2: ลบ clips ที่ยังค้าง (ถ้ามี) ===
    const deletedCount2 = await deleteAllClipsInSceneBuilder();
    if (deletedCount2 > 0) {
      log(`⚠️ รอบ 2: ลบเพิ่มอีก ${deletedCount2} clips (ที่ค้าง)`, 'warning');
      deletedCount += deletedCount2;
    }

    log(`✅ ลบ clips ทั้งหมด ${deletedCount} อัน - SceneBuilder ว่างแล้ว`, 'success');

    // ไปกดย้อนกลับหน้าเว็บ
    return STATES.EXTEND_GO_BACK;
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

  // Step 4.3: กดย้อนกลับหน้าเว็บ
  async function handleExtendGoBack() {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    log('📍 Step 4.3/14: กดย้อนกลับหน้าเว็บ', 'step');

    await delay(500);

    // กดย้อนกลับ
    history.back();
    log('✅ กดย้อนกลับแล้ว - รอหน้าโหลด', 'success');

    await delay(2500); // รอหน้าโหลด
    return STATES.EXTEND_SELECT_VIDEO;
  }

  // ========== Legacy Extended Mode Handlers (backward compatible) ==========

  async function handleExtendedWaitScenebuilder() {
    // Redirect ไป flow ใหม่
    return STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
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

  // ========== Main State Machine ==========

  async function runStateMachine(sessionId = null) {
    log(`เริ่ม State Machine จาก state: ${currentState} (mode: ${currentMode})`, 'info');

    try {
      while (currentState !== STATES.DONE && currentState !== STATES.ERROR && currentState !== STATES.IDLE) {
        // ตรวจสอบว่า session ยังตรงไหม - ถ้าไม่ตรงแปลว่า Row ใหม่เริ่มแล้ว
        if (sessionId && sessionId !== currentSessionId) {
          log(`⚠️ Session ถูกยกเลิก (Row ใหม่เริ่มแล้ว)`, 'warning');
          return; // หยุด loop ทันที ไม่ต้อง set state เพราะ Row ใหม่จะ set เอง
        }

        // ตรวจสอบว่าถูกสั่งหยุดหรือไม่
        if (shouldStop) {
          log('🛑 หยุดการทำงานตามคำสั่ง', 'warning');
          currentState = STATES.IDLE;
          break;
        }

        log(`Current State: ${currentState}`, 'info');

        switch (currentState) {
          // Step 2: Image GEN states
          case STATES.OPEN_CONFIG_DROPDOWN:
            currentState = await handleOpenConfigDropdown();
            break;

          case STATES.SELECT_IMAGE_MODE:
            currentState = await handleSelectImageMode();
            break;

          case STATES.SET_MODEL:
            currentState = await handleSetModel();
            break;

          case STATES.SET_ASPECT_RATIO:
            currentState = await handleSetAspectRatio();
            break;

          case STATES.SET_OUTPUT_COUNT:
            currentState = await handleSetOutputCount();
            break;

          case STATES.CLOSE_CONFIG_DROPDOWN:
            currentState = await handleCloseConfigDropdown();
            break;

          case STATES.CLICK_ADD_BUTTONS:
            currentState = await handleClickAddButtons();
            break;

          case STATES.FILL_PROMPT:
            currentState = await handleFillPrompt();
            break;

          case STATES.CLICK_GENERATE:
            currentState = await handleClickGenerate();
            break;

          // Step 3: Video GEN states
          case STATES.VIDEO_SELECT_MODE:
            currentState = await ctx.handlers.handleVideoSelectMode();
            break;

          case STATES.VIDEO_CLICK_IMAGE:
            currentState = await ctx.handlers.handleVideoClickImage();
            break;

          case STATES.VIDEO_SELECT_FRAMES_TO_VIDEO:
            currentState = await ctx.handlers.handleVideoSelectFramesToVideo();
            break;

          case STATES.VIDEO_ADD_TO_PROMPT:
            currentState = await ctx.handlers.handleVideoAddToPrompt();
            break;

          case STATES.VIDEO_8S_ADD_IMAGE:
            currentState = await ctx.handlers.handleVideo8sAddImage();
            break;

          case STATES.VIDEO_OPEN_SETTINGS:
            currentState = await ctx.handlers.handleVideoOpenSettings();
            break;

          case STATES.VIDEO_SET_ASPECT_RATIO:
            currentState = await ctx.handlers.handleVideoSetAspectRatio();
            break;

          case STATES.VIDEO_SET_OUTPUT_COUNT:
            currentState = await ctx.handlers.handleVideoSetOutputCount();
            break;

          case STATES.VIDEO_FILL_PROMPT:
            log(`[State Machine] 🔄 Entering VIDEO_FILL_PROMPT (retry count: ${window._step3RetryCount || 0})`, 'info');
            currentState = await ctx.handlers.handleVideoFillPrompt();
            log(`[State Machine] ✅ VIDEO_FILL_PROMPT completed → ${currentState}`, 'info');
            break;

          case STATES.VIDEO_CLICK_GENERATE:
            log(`[State Machine] 🔄 Entering VIDEO_CLICK_GENERATE (retry count: ${window._step3RetryCount || 0})`, 'info');
            currentState = await ctx.handlers.handleVideoClickGenerate();
            log(`[State Machine] ✅ VIDEO_CLICK_GENERATE completed → ${currentState}`, 'info');
            break;

          // Step 4: Extend Video States (Flow ใหม่ - ล้าง SceneBuilder ก่อน)
          case STATES.EXTEND_CLICK_SCENEBUILDER:
            currentState = await ctx.handlers.handleExtendClickScenebuilder();
            break;

          case STATES.EXTEND_CLICK_ARRANGE:
          case STATES.EXTEND_DELETE_CLIPS:
          case STATES.EXTEND_GO_BACK:
          case STATES.EXTEND_SELECT_VIDEO:
          case STATES.EXTEND_CLICK_ADD_TO_SCENE:
          case STATES.EXTEND_CLICK_SWITCH_BUILDER:
          case STATES.EXTEND_SELECT_LAST_CLIP:
          case STATES.EXTEND_CLICK_ADD_CLIP:
          case STATES.EXTEND_CLICK_EXTEND_MENU:
          case STATES.EXTEND_WAIT_TEXTAREA:
            // Legacy: ข้ามไป Frames to Video ทันที
            window._isExtendMode = true;
            currentState = STATES.VIDEO_SELECT_FRAMES_TO_VIDEO;
            break;

          case STATES.EXTEND_UPLOAD_IMAGE:
            currentState = await ctx.handlers.handleExtendUploadImage();
            break;

          case STATES.EXTEND_SB_FILL_PROMPT:
            currentState = await ctx.handlers.handleExtendSBFillPrompt();
            break;

          case STATES.EXTEND_SB_CLICK_CREATE:
            currentState = await ctx.handlers.handleExtendSBClickCreate();
            break;

          case STATES.EXTEND_SB_WAIT_GENERATE:
            currentState = await ctx.handlers.handleExtendSBWaitGenerate();
            break;

          case STATES.EXTEND_FILL_PROMPT:
            currentState = await ctx.handlers.handleExtendFillPrompt();
            break;

          case STATES.EXTEND_CLICK_CREATE:
            currentState = await ctx.handlers.handleExtendClickCreate();
            break;

          case STATES.EXTEND_WAIT_GENERATE:
            currentState = await ctx.handlers.handleExtendWaitGenerate();
            break;

          case STATES.EXTEND_GET_BLOB_URL:
            currentState = await ctx.handlers.handleExtendGetBlobUrl();
            break;

          case STATES.EXTEND_COMPLETE:
            log('🎉 Extend Video เสร็จสมบูรณ์!', 'success');
            window._isExtendMode = false; // Clear extend mode flag
            // ส่ง EXTENDED_VIDEO_COMPLETE กลับ React เพื่อให้ Promise resolve
            try {
              chrome.runtime.sendMessage({
                type: 'EXTENDED_VIDEO_COMPLETE',
                data: {
                  rowId: savedVideoRowId || automationData?.rowId,
                  success: true,
                  extendCount: window._extendCurrentCount
                }
              });
            } catch (e) { }
            // ลบ extend state จาก storage
            try { await chrome.storage.local.remove(['google_flow_extend_in_progress', 'google_flow_extend_data']); } catch (e) { }
            isRunning = false;
            return; // จบ state machine สำเร็จ

          // Legacy Extended Mode States (backward compatible)
          case STATES.EXTENDED_WAIT_SCENEBUILDER:
            currentState = await ctx.handlers.handleExtendedWaitScenebuilder();
            break;

          case STATES.EXTENDED_CLICK_ADD_CLIP:
            currentState = await ctx.handlers.handleExtendedClickAddClip();
            break;

          case STATES.EXTENDED_FILL_PROMPT:
            currentState = await ctx.handlers.handleExtendedFillPrompt();
            break;

          case STATES.EXTENDED_CLICK_GENERATE:
            currentState = await ctx.handlers.handleExtendedClickGenerate();
            break;

          case STATES.EXTENDED_WAIT_VIDEO:
            currentState = await ctx.handlers.handleExtendedWaitVideo();
            break;

          case STATES.EXTENDED_CLICK_PLAY:
            currentState = await ctx.handlers.handleExtendedClickPlay();
            break;

          case STATES.EXTENDED_GET_BLOB_URL:
            currentState = await ctx.handlers.handleExtendedGetBlobUrl();
            break;

          default:
            // Fallback: ตรวจสอบ stateHandlers ที่ video-extend script register ไว้
            if (ctx.stateHandlers && ctx.stateHandlers[currentState]) {
              log(`[State Machine] 🔄 Dispatching to ctx.stateHandlers: ${currentState}`, 'info');
              currentState = await ctx.stateHandlers[currentState]();
            } else {
              log(`Unknown state: ${currentState}`, 'error');
              currentState = STATES.ERROR;
            }
        }
      }
    } catch (err) {
      if (err.message === 'STOPPED') {
        log('🛑 หยุดการทำงานเรียบร้อย', 'warning');
        currentState = STATES.IDLE;
      } else {
        // ✅ IMPROVED: Log the specific state that failed
        log(`❌ Error in state [${currentState}]: ${err.message}`, 'error');
        log(`❌ Error stack: ${err.stack || 'no stack'}`, 'error');

        // ✅ NEW: Send error message if in extend mode
        if (currentState && currentState.startsWith('EXTEND_') && automationData?.rowId) {
          try {
            chrome.runtime.sendMessage({
              type: 'EXTEND_VIDEO_ERROR',
              data: {
                rowId: automationData.rowId,
                error: `[${currentState}] ${err.message || 'Unknown error'}`,
                failedState: currentState
              }
            });
            log(`ส่ง EXTEND_VIDEO_ERROR message แล้ว (state: ${currentState})`, 'info');
          } catch (e) {
            // Ignore
          }
        }

        currentState = STATES.ERROR;
        throw err;
      }
    }

    if (currentState === STATES.DONE) {
      const stepName = currentMode === 'video' ? 'Step 3' : 'Step 2';
      log(`🎉 เสร็จสิ้นการทำงาน ${stepName}!`, 'success');
      isRunning = false; // Reset running flag

      // ส่งข้อความกลับไป background
      try {
        const messageType = currentMode === 'video' ? 'VIDEO_GEN_COMPLETE' : 'AISTUDIO_GEN_COMPLETE';
        chrome.runtime.sendMessage({
          type: messageType,
          success: true
        });
      } catch (e) {
        // Ignore
      }

      // ถ้าเป็น extendedMode → ส่ง EXTENDED_VIDEO_COMPLETE ด้วย เพื่อให้ React Step 4 resolve
      if (automationData?.extendedMode && currentMode === 'video') {
        try {
          chrome.runtime.sendMessage({
            type: 'EXTENDED_VIDEO_COMPLETE',
            data: {
              rowId: automationData?.rowId,
              success: true,
              extendCount: window._extendCurrentCount || 0
            }
          });
          log('📤 ส่ง EXTENDED_VIDEO_COMPLETE ให้ React Step 4', 'info');
        } catch (e) {}
      }
    } else if (currentState === STATES.ERROR) {
      log('เกิดข้อผิดพลาดในการทำงาน', 'error');
      isRunning = false; // Reset running flag

      // ✅ NEW: Send error message if in extend mode
      if (automationData?.rowId) {
        // Check if previous state was extend mode
        const wasExtendMode = Object.keys(STATES).some(key =>
          key.startsWith('EXTEND_') && STATES[key] === currentState
        );

        if (wasExtendMode || (automationData.videoPrompt2)) {
          try {
            chrome.runtime.sendMessage({
              type: 'EXTEND_VIDEO_ERROR',
              data: {
                rowId: automationData.rowId,
                error: 'State machine error'
              }
            });
            log('ส่ง EXTEND_VIDEO_ERROR message แล้ว', 'info');
          } catch (e) {
            // Ignore
          }
        }
      }

      try {
        const messageType = currentMode === 'video' ? 'VIDEO_GEN_COMPLETE' : 'AISTUDIO_GEN_COMPLETE';
        chrome.runtime.sendMessage({
          type: messageType,
          success: false,
          error: 'State machine error',
          rowId: savedVideoRowId || automationData?.rowId  // ✅ FIX: Use saved rowId to prevent race condition
        });
      } catch (e) {
        // Ignore
      }
    }
  }


  ctx.runStateMachine = runStateMachine;

  // ========== Message Listener ==========

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log(`Received message: ${message.type}`, 'info');

    // หยุดการทำงาน
    if (message.type === 'STOP_GENERATION') {
      const now = Date.now();

      // ✅ NEW: Debounce duplicate STOP messages within 1 second
      if (stopMessageReceived && (now - stopMessageTimestamp) < 1000) {
        log('[Flow] ⏭️ Duplicate STOP ignored (within 1s)', 'info');
        sendResponse({ success: true, alreadyStopped: true });
        return true;
      }

      // First or valid STOP message
      log('🛑 ได้รับคำสั่งหยุดการทำงาน', 'warning');
      stopMessageReceived = true;
      stopMessageTimestamp = now;
      shouldStop = true;
      shouldPause = false;

      // ✅ NEW: Send error if stopped during extend mode
      const wasInExtendMode = currentState && currentState.startsWith('EXTEND_');
      const savedRowIdForError = automationData?.rowId; // บันทึกไว้ก่อน clear

      currentState = STATES.IDLE;
      isRunning = false; // Reset running flag

      // Clear global tracking เพื่อป้องกัน stale state
      window._allSeenVideoIds.clear();
      window._generationStartTime = null;
      savedVideoRowId = null;
      automationData = null;

      // ถ้ามี userUploadResolve ให้ resolve เพื่อไม่ให้ค้าง
      if (userUploadResolve) {
        userUploadResolve();
        userUploadResolve = null;
      }

      // ✅ NEW: ถ้าหยุดตอน Extend mode ให้ส่ง EXTEND_VIDEO_ERROR ด้วย
      if (wasInExtendMode && savedRowIdForError) {
        try {
          chrome.runtime.sendMessage({
            type: 'EXTEND_VIDEO_ERROR',
            data: {
              rowId: savedRowIdForError,
              error: 'Stopped by user'
            }
          });
          log('ส่ง EXTEND_VIDEO_ERROR message แล้ว', 'info');
        } catch (e) {
          // Ignore
        }
      }

      // ส่ง message กลับไปให้ popup รู้ว่าหยุดแล้ว
      try {
        const messageType = currentMode === 'video' ? 'VIDEO_GEN_COMPLETE' : 'AISTUDIO_GEN_COMPLETE';
        chrome.runtime.sendMessage({
          type: messageType,
          success: false,
          error: 'Stopped by user'
        });
        log('ส่ง message หยุดการทำงานกลับไป popup แล้ว', 'info');
      } catch (e) {
        // Ignore
      }

      // Clear stop flag after 5 seconds (prevent stale flag on next start)
      setTimeout(async () => {
        await chrome.storage.local.remove('sora_stop_requested');
        log('[Flow] ✅ Cleared stop flag after 5 seconds', 'info');
      }, 5000);

      sendResponse({ success: true });
      return true;
    }

    // หยุดชั่วคราว
    if (message.type === 'PAUSE_GENERATION') {
      log('⏸️ ได้รับคำสั่งหยุดชั่วคราว', 'warning');
      shouldPause = true;
      sendResponse({ success: true });
      return true;
    }

    // ทำงานต่อ
    if (message.type === 'RESUME_GENERATION') {
      log('▶️ ได้รับคำสั่งทำงานต่อ', 'info');
      shouldPause = false;
      sendResponse({ success: true });
      return true;
    }


    // Step 2: GEN ภาพ
    if (message.type === 'START_AISTUDIO_GEN') {
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
      log('🎨 ได้รับคำสั่งเริ่มต้น Step 2 (GEN ภาพ)', 'info');

      // ป้องกันการทำงานซ้อนทับ
      if (isRunning) {
        log('⚠️ กำลังทำงานอยู่แล้ว - ไม่เริ่มใหม่', 'warning');
        sendResponse({ success: false, reason: 'already_running' });
        return true;
      }

      // เช็ค storage stop flag ก่อนเริ่ม (กันกรณี stop มาก่อน start)
      chrome.storage.local.get('sora_stop_requested').then((stopData) => {
        if (stopData.sora_stop_requested) {
          log('🛑 มีคำสั่งหยุดรออยู่ - ไม่เริ่มทำงาน', 'warning');
          shouldStop = true;
          sendResponse({ success: false, stopped: true });
          return;
        }

        isRunning = true; // Mark as running
        // สร้าง session ID ใหม่เพื่อยกเลิก state machine เก่า
        currentSessionId = Date.now() + '_' + Math.random();
        const mySessionId = currentSessionId;

        // Reset ALL state flags
        shouldStop = false;
        shouldPause = false;
        currentState = STATES.IDLE; // Reset to IDLE first
        userUploadResolve = null;

        // Set new data
        automationData = message.data || {};
        currentMode = 'image';
        currentState = STATES.OPEN_CONFIG_DROPDOWN;

        // ✅ เก็บ automationData ใน storage สำหรับ retry หลังหน้าจอดำ
        chrome.storage.local.set({
          google_flow_retry_data: {
            ...automationData,
            mode: 'image',
            messageType: 'START_AISTUDIO_GEN'
          }
        }).catch(() => {});

        log(`▶️ เริ่ม State Machine จาก: ${currentState}`, 'info');

        // ✅ NEW: แจ้ง React ว่า Step 2 เริ่มทำงานแล้ว
        try {
          chrome.runtime.sendMessage({
            type: 'STEP2_STARTED',
            data: {
              rowId: automationData?.rowId,
              timestamp: Date.now()
            }
          });
        } catch (e) {
          log('⚠️ ส่ง STEP2_STARTED message ล้มเหลว (ไม่เป็นไร)', 'warning');
        }

        // เริ่ม state machine พร้อม session ID
        runStateMachine(mySessionId);
      });

      sendResponse({ success: true });
      return true; // Keep message channel open for async
    }





    // ========== Delegate to Video+Extend script handlers ==========
    if (ctx.messageHandlers && ctx.messageHandlers.length > 0) {
      log(`[Delegate] Checking ${ctx.messageHandlers.length} handler(s) for: ${message.type}`, 'info');
      for (const handler of ctx.messageHandlers) {
        const handled = handler(message, sender, sendResponse);
        if (handled) {
          log(`[Delegate] ✅ Message ${message.type} handled by video-extend script`, 'info');
          return true;
        }
      }
      log(`[Delegate] ⚠️ Message ${message.type} not handled by any delegated handler`, 'info');
    } else {
      log(`[Delegate] ⚠️ No messageHandlers registered (ctx.messageHandlers=${ctx.messageHandlers ? ctx.messageHandlers.length : 'undefined'})`, 'warning');
    }


    if (message.type === 'PING') {
      sendResponse({ pong: true, script: 'aistudio-content-script' });
    }

    // ========== Trigger Upscale Download (1080p) ==========
    if (message.type === 'TRIGGER_UPSCALE_DOWNLOAD') {
      log('📥 [Upscale] เริ่มกดปุ่ม Upscaled (1080p) Download...', 'info');

      (async () => {
        try {
          // 1. หาปุ่ม Download (button ที่มี icon "download" และ aria-haspopup="menu")
          let downloadBtn = null;
          const allMenuBtns = document.querySelectorAll('button[aria-haspopup="menu"]');
          for (const btn of allMenuBtns) {
            const icon = btn.querySelector('i.google-symbols');
            if (icon && icon.textContent.trim() === 'download') {
              downloadBtn = btn;
              break;
            }
          }

          if (!downloadBtn) {
            log('❌ [Upscale] หาปุ่ม Download ไม่เจอ', 'error');
            sendResponse({ success: false, error: 'Download button not found' });
            return;
          }

          // 2. กดปุ่ม Download เปิด menu
          downloadBtn.click();
          log('✅ [Upscale] กดปุ่ม Download แล้ว - รอ menu เปิด...', 'info');

          // 3. รอให้ dropdown menu แสดง
          await new Promise(r => setTimeout(r, 1000));

          // 4. หา "Upscaled (1080p)" menu item
          const menuItems = document.querySelectorAll('div[role="menuitem"]');
          let upscaleItem = null;
          for (const item of menuItems) {
            if (item.textContent.includes('1080p') || item.textContent.includes('Upscaled')) {
              upscaleItem = item;
              break;
            }
          }

          if (!upscaleItem) {
            log('❌ [Upscale] หา menu item "Upscaled (1080p)" ไม่เจอ', 'error');
            // ปิด menu โดยกดที่อื่น
            document.body.click();
            await new Promise(r => setTimeout(r, 300));
            sendResponse({ success: false, error: 'Upscaled (1080p) menu item not found' });
            return;
          }

          // 5. กด Upscaled (1080p)
          upscaleItem.click();
          log('✅ [Upscale] กด Upscaled (1080p) แล้ว - Google Flow จะ upscale และ download', 'success');

          sendResponse({ success: true });

        } catch (e) {
          log(`❌ [Upscale] Error: ${e.message}`, 'error');
          sendResponse({ success: false, error: e.message });
        }
      })();

      return true; // Keep message channel open for async
    }

    // ========== Product Set: Wait for Image Gen ==========
    // Poll รอ Image Gen เสร็จ (เหมือน Video Gen ใน 8s mode)
    async function handleProductSetWaitForImageGen(existingImgSrcs, rowId) {
      const POLL_INTERVAL = 5000;  // 5 วินาที
      const MAX_WAIT = DELAYS.GEN_IMAGE_WAIT;  // 3 นาที
      let elapsed = 0;
      let hasSeenProgress = false;
      let progressGoneCount = 0;  // นับว่า progress หายไปกี่รอบ

      log(`⏳ เริ่ม Polling รอ Image Gen (Max ${MAX_WAIT / 1000} วินาที, ตรวจทุก ${POLL_INTERVAL / 1000} วินาที)`, 'info');

      // ส่ง progress update ไป React
      const sendProgress = (progress, status) => {
        try {
          chrome.runtime.sendMessage({
            type: 'PRODUCT_SET_GEN_PROGRESS',
            data: { rowId, progress, elapsed: elapsed / 1000, maxWait: MAX_WAIT / 1000, status }
          });
        } catch (e) {
          // Ignore if extension context is invalid
        }
      };

      while (elapsed < MAX_WAIT) {
        // เช็ค stop flag ทันทีที่ต้นทุก iteration
        if (shouldStop) {
          log('🛑 หยุดการทำงานระหว่างรอ image gen', 'warning');
          throw new Error('STOPPED');
        }
        await checkStopWithStorage();

        // 1. ดึง Progress % จาก UI
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
          progressGoneCount = 0;  // Reset counter

          // ✅ ตรวจจับ 99% ค้าง
          if (realProgress === 99) {
            if (stuckAt99StartTime === null) {
              stuckAt99StartTime = Date.now();
              log(`⚠️ [ProductSet] Progress ถึง 99% - เริ่มจับเวลา...`, 'warning');
            } else {
              const stuckDuration = Date.now() - stuckAt99StartTime;
              log(`⏱️ [ProductSet] 99% ค้างมาแล้ว ${(stuckDuration / 1000).toFixed(1)} วินาที (trigger ที่ ${STUCK_99_TIMEOUT / 1000} วินาที)`, 'info');
              if (stuckDuration >= STUCK_99_TIMEOUT) {
                log(`⚠️ [ProductSet] 99% ค้างนานเกิน ${STUCK_99_TIMEOUT / 1000} วินาที! กำลังล้าง cookies...`, 'error');
                await handleStuckAt99();
                return { success: false, error: '99% stuck - reloading page' };
              }
            }
          } else {
            // Reset ถ้า progress ไม่ใช่ 99%
            stuckAt99StartTime = null;
          }
        }

        // ✅ ตรวจจับ "Couldn't generate image" error ระหว่าง polling
        const midPollError = detectGenerationError();
        if (midPollError.hasError && midPollError.errorMessage.toLowerCase().includes("couldn't generate")) {
          log(`⚠️ [ProductSet] ตรวจพบ "Couldn't generate image" - กำลังล้าง cookies และ retry...`, 'error');
          await handleStuckAt99();
          return { success: false, error: "Couldn't generate image - reloading page" };
        }

        // 2. ถ้าเคยเห็น progress แล้วหายไป = น่าจะเสร็จ
        const progressGone = hasSeenProgress && realProgress === null;
        if (progressGone) {
          progressGoneCount++;
          log(`[ProductSet] Progress หายไป (${progressGoneCount}/2)...`, 'info');

          // รอ 2 รอบเพื่อให้แน่ใจว่า Gen เสร็จจริง
          if (progressGoneCount >= 2) {
            // ตรวจหาภาพใหม่
            const newImageUrl = findGeneratedImage(existingImgSrcs);
            if (newImageUrl) {
              log(`[ProductSet] ✅ พบภาพใหม่!`, 'success');
              // ✅ Reset 99% stuck retry count เมื่อสำเร็จ
              chrome.storage.local.set({ google_flow_99_stuck_retry: 0 }).catch(() => {});
              stuckAt99StartTime = null;
              return { success: true, imageUrl: newImageUrl };
            }

            // ตรวจหา error
            const errorCheck = detectGenerationError();
            if (errorCheck.hasError) {
              // ★ ถ้าเป็น "couldn't generate" → กด Generate อีกครั้ง
              if (errorCheck.errorMessage.toLowerCase().includes("couldn't generate")) {
                log(`[ProductSet] ⚠️ Gen ล้มเหลว - กด Generate อีกครั้ง...`, 'warning');
                // กดปิด error dialog (ถ้ามี)
                const dismissBtn = document.querySelector('button[aria-label="Dismiss"]');
                if (dismissBtn) {
                  dismissBtn.click();
                  await delay(500);
                }
                // กด Generate อีกครั้ง
                const genBtns = Array.from(document.querySelectorAll('button'));
                const genBtn = genBtns.find(b => {
                  const icon = b.querySelector('i');
                  return icon && icon.textContent.includes('arrow_forward');
                });
                if (genBtn) {
                  genBtn.click();
                  progressGoneCount = 0;
                  hasSeenProgress = false;
                  log(`[ProductSet] 🔄 กด Generate อีกครั้งแล้ว - รอใหม่...`, 'info');
                  continue; // retry loop
                }
              }
              log(`[ProductSet] ❌ เจอ error: ${errorCheck.errorMessage}`, 'error');
              return { success: false, error: errorCheck.errorMessage };
            }

            // รอเพิ่มอีกนิดเผื่อ image ยังไม่ปรากฏ
            log(`[ProductSet] 🔄 รอภาพปรากฏ...`, 'info');
          }
        }

        // ส่ง progress update
        const displayProgress = realProgress || Math.round((elapsed / MAX_WAIT) * 100);
        sendProgress(displayProgress, status);

        if (elapsed % 15000 === 0) {
          log(`[ProductSet] ⏳ ${elapsed / 1000}/${MAX_WAIT / 1000}s - ${status} (${displayProgress}%)`, 'info');
        }

        await delay(POLL_INTERVAL);
        elapsed += POLL_INTERVAL;
      }

      // Timeout - ลองหาภาพอีกครั้งสุดท้าย
      log(`[ProductSet] ⏰ Timeout - ลองหาภาพครั้งสุดท้าย...`, 'warning');
      const finalImageUrl = findGeneratedImage(existingImgSrcs);
      if (finalImageUrl) {
        log(`[ProductSet] ✅ พบภาพสุดท้าย!`, 'success');
        return { success: true, imageUrl: finalImageUrl };
      }

      // ตรวจ error สุดท้าย
      const finalErrorCheck = detectGenerationError();
      if (finalErrorCheck.hasError) {
        return { success: false, error: finalErrorCheck.errorMessage };
      }

      return { success: false, error: 'Timeout: Image generation took too long' };
    }

    // Product Set: Create project with images
    if (message.type === 'PRODUCT_SET_CREATE_PROJECT') {
      // Reset stop/pause flags ก่อนเริ่ม (กันกรณี shouldStop ค้างจากรอบก่อน)
      shouldStop = false;
      shouldPause = false;

      log('', 'info');
      log('╔══════════════════════════════════════════════════════════════╗', 'info');
      log('║  📦 PRODUCT SET AUTOMATION - เริ่มสร้างโปรเจค                 ║', 'info');
      log('╚══════════════════════════════════════════════════════════════╝', 'info');

      const data = message.data || {};
      const charImgSize = data.characterImageUrl ? Math.round(data.characterImageUrl.length / 1024) : 0;
      const prodImgSize = data.productImageUrl ? Math.round(data.productImageUrl.length / 1024) : 0;

      log(`📋 Row ID: ${data.rowId}`, 'info');
      log(`📷 รูปตัวละคร: ${data.characterImageUrl ? `มี (${charImgSize} KB)` : '❌ ไม่มี'}`, 'info');
      log(`🛍️ รูปสินค้า: ${data.productImageUrl ? `มี (${prodImgSize} KB)` : '❌ ไม่มี'}`, 'info');
      log(`📝 รายละเอียด: ${data.productDetails || '(ไม่มี)'}`, 'info');
      log(`🌐 หน้าปัจจุบัน: ${window.location.href}`, 'info');
      log('─────────────────────────────────────────────────────────────────', 'info');

      const startTime = Date.now();

      // Run automation asynchronously
      (async () => {
        try {
          let projectUrl = window.location.href;

          // ═══════════════════════════════════════════════════════════════
          // STEP 0: ถ้าอยู่ homepage ให้กด "Create with Flow" ก่อน
          // ═══════════════════════════════════════════════════════════════
          const currentUrl = window.location.href;
          const isHomepage = currentUrl === 'https://labs.google/fx/tools/flow' ||
                            currentUrl === 'https://labs.google/fx/tools/flow/' ||
                            currentUrl.match(/^https:\/\/labs\.google\/fx\/?$/);

          if (isHomepage) {
            log('', 'info');
            log('┌─ STEP 0: กดปุ่ม Create with Flow (Homepage) ────────────────', 'info');
            log('│  🏠 ตรวจพบว่าอยู่ที่ Homepage', 'info');
            log('│  🔍 กำลังค้นหาปุ่ม "Create with Flow"...', 'info');

            const createFlowBtn = await waitForElement(() => {
              const btns = Array.from(document.querySelectorAll('button'));
              return btns.find(b => b.textContent.includes('Create with Flow'));
            }, 10000);

            if (createFlowBtn) {
              log('│  ✅ พบปุ่ม "Create with Flow" แล้ว!', 'success');
              const oldUrl = window.location.href;
              log('│  🖱️ กำลังคลิก...', 'info');
              createFlowBtn.click();

              // รอให้ URL เปลี่ยนเป็น project
              log('│  ⏳ รอ URL เปลี่ยนเป็น project (สูงสุด 15 วินาที)...', 'info');
              let urlChanged = false;
              for (let i = 0; i < 30; i++) {
                await delay(500);
                if (window.location.href !== oldUrl && window.location.href.includes('/project/')) {
                  urlChanged = true;
                  projectUrl = window.location.href;
                  log(`│  ✅ URL เปลี่ยนเป็น project แล้ว! (${i * 0.5} วินาที)`, 'success');
                  log(`│  📎 URL ใหม่: ${projectUrl}`, 'success');
                  break;
                }
                if (i % 4 === 3) {
                  log(`│  [${(i + 1) * 0.5}/15 วินาที] รอ URL เปลี่ยน...`, 'info');
                }
              }

              if (!urlChanged) {
                log('│  ⚠️ URL ไม่เปลี่ยน - ลองดำเนินการต่อ', 'warning');
              }

              // รอให้ UI โหลด
              log('│  ⏳ รอ UI โหลด อีก 3 วินาที...', 'info');
              await delay(3000);
            } else {
              log('│  ⚠️ ไม่พบปุ่ม "Create with Flow" - ลองดำเนินการต่อ', 'warning');
            }
            log('└──────────────────────────────────────────────────────────────', 'info');
          }

          // ═══════════════════════════════════════════════════════════════
          // STEP 1/10: New Project
          // ═══════════════════════════════════════════════════════════════
          log('', 'info');
          log('┌─ STEP 1/10: กดปุ่ม New Project ─────────────────────────────', 'info');
          log('│  🔍 กำลังค้นหาปุ่ม "New project"...', 'info');

          const newProjectBtn = await waitForElement(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            return btns.find(b =>
              b.textContent.includes('New project') || b.textContent.includes('New Project')
            );
          }, 10000);

          if (newProjectBtn) {
            log('│  ✅ พบปุ่ม New Project แล้ว!', 'success');
            const oldUrl = window.location.href;
            log(`│  📎 URL ปัจจุบัน: ${oldUrl}`, 'info');
            log('│  🖱️ กำลังคลิก...', 'info');
            newProjectBtn.click();

            // รอให้ URL เปลี่ยน (แสดงว่า navigate ไปหน้าโปรเจคแล้ว)
            log('│  ⏳ รอ URL เปลี่ยน (สูงสุด 15 วินาที)...', 'info');
            let urlChanged = false;
            for (let i = 0; i < 30; i++) {
              await delay(500);
              if (window.location.href !== oldUrl) {
                urlChanged = true;
                projectUrl = window.location.href;
                log(`│  ✅ URL เปลี่ยนแล้ว! (${i * 0.5} วินาที)`, 'success');
                log(`│  📎 URL ใหม่: ${projectUrl}`, 'success');
                break;
              }
              if (i % 4 === 3) {
                log(`│  [${(i + 1) * 0.5}/15 วินาที] รอ URL เปลี่ยน...`, 'info');
              }
            }

            if (!urlChanged) {
              log('│  ⚠️ URL ไม่เปลี่ยนหลังจาก 15 วินาที', 'warning');
              log('│  💡 อาจอยู่ในหน้า project อยู่แล้ว - ดำเนินการต่อ', 'info');
              projectUrl = window.location.href;
            }

            // รอให้ UI โหลด โดยหา Slate editor หรือ Config dropdown
            log('│  ⏳ รอ Project UI โหลด...', 'info');
            let uiReady = false;
            for (let i = 0; i < 20; i++) {
              await delay(500);
              // เช็คหา Slate editor หรือ Config dropdown (UI ใหม่)
              const slateEditor = document.querySelector('div[role="textbox"][data-slate-editor="true"]');
              const configDropdown = document.querySelector('button[aria-haspopup="menu"]');
              // Fallback: textarea เดิม
              const textarea = document.querySelector('textarea#PINHOLE_TEXT_AREA_ELEMENT_ID');

              if (slateEditor || configDropdown || textarea) {
                uiReady = true;
                const found = slateEditor ? 'Slate editor' : configDropdown ? 'Config dropdown' : 'textarea';
                log(`│  ✅ Project UI พร้อมแล้ว! พบ ${found} (${i * 0.5} วินาที)`, 'success');
                break;
              }
              if (i % 4 === 3) {
                log(`│  [${(i + 1) * 0.5}/10 วินาที] รอ UI โหลด... (buttons: ${document.querySelectorAll('button').length})`, 'info');
              }
            }

            if (!uiReady) {
              log('│  ⚠️ UI ไม่โหลดหลังจาก 10 วินาที - ลองดำเนินการต่อ', 'warning');
            }

            // รอเพิ่มอีก 2 วินาทีให้ UI stable
            log('│  ⏳ รอ UI stable อีก 2 วินาที...', 'info');
            await delay(2000);
          } else {
            log('│  ⚠️ ไม่พบปุ่ม New Project', 'warning');
            log('│  💡 อาจอยู่ใน project อยู่แล้ว - ดำเนินการต่อ', 'info');
          }
          log('└──────────────────────────────────────────────────────────────', 'info');

          // ═══════════════════════════════════════════════════════════════
          // STEP 2/10: ตั้งค่า Config
          // ═══════════════════════════════════════════════════════════════
          log('', 'info');
          log('┌─ STEP 2/10: ตั้งค่า Config ━━━━━━━━━━━━━━━━━', 'info');

          let configBtn = null;
          const menuBtns2a = document.querySelectorAll('button[aria-haspopup="menu"]');
          for (const btn of menuBtns2a) {
            const icon = btn.querySelector('i.google-symbols, i.material-icons');
            const iconText = icon?.textContent?.trim() || '';
            if (iconText === 'crop_9_16' || iconText === 'crop_16_9') {
              configBtn = btn;
              log('│  พบ Config dropdown จาก aspect ratio icon', 'info');
              break;
            }
          }
          if (!configBtn) {
            for (const btn of menuBtns2a) {
              const text = btn.textContent || '';
              if (/x[1-4]/.test(text)) {
                configBtn = btn;
                log('│  พบ Config dropdown จาก xN text', 'info');
                break;
              }
            }
          }
          if (!configBtn) {
            const createBtn2a = Array.from(document.querySelectorAll('button')).find(b => {
              const icon = b.querySelector('i');
              return icon && icon.textContent.includes('arrow_forward');
            });
            if (createBtn2a) {
              const sibling = createBtn2a.previousElementSibling;
              if (sibling && sibling.tagName === 'BUTTON' && sibling.getAttribute('aria-haspopup') === 'menu') {
                configBtn = sibling;
                log('│  พบ Config dropdown จาก sibling ของ Create button', 'info');
              }
            }
          }

          if (configBtn) {
            const cfgState = configBtn.getAttribute('data-state') || '';
            const cfgExpanded = configBtn.getAttribute('aria-expanded');
            if (cfgState === 'open' || cfgExpanded === 'true') {
              log('│  ✅ Config dropdown เปิดอยู่แล้ว', 'success');
            } else {
              log('│  🔍 กำลังเปิด Config Dropdown ผ่าน MAIN world...', 'info');
              try {
                const configResult = await Promise.race([
                  chrome.runtime.sendMessage({ type: 'CLICK_CONFIG_DROPDOWN' }),
                  new Promise(r => setTimeout(() => r({ success: false, timeout: true }), 5000))
                ]);
                if (configResult.timeout) {
                  log('│  ⚠️ MAIN world click timeout - ลอง humanClick', 'warning');
                  humanClick(configBtn);
                } else {
                  log(`│  Config Dropdown result: ${JSON.stringify(configResult)}`, 'info');
                }
              } catch (e) {
                log(`│  ⚠️ MAIN world click ล้มเหลว - ลอง humanClick: ${e.message}`, 'warning');
                humanClick(configBtn);
              }
              await delay(1500);

              // เช็คว่าเปิดสำเร็จไหม
              const afterState = configBtn.getAttribute('data-state') || '';
              const afterExpanded = configBtn.getAttribute('aria-expanded');
              if (afterState !== 'open' && afterExpanded !== 'true') {
                log('│  ⚠️ ยังไม่เปิด - ลอง humanClick อีกครั้ง', 'warning');
                humanClick(configBtn);
                await delay(1500);
              }
              log('│  ✅ Config dropdown เปิดแล้ว', 'success');
            }
          } else {
            log('│  ⚠️ ไม่พบ Config dropdown', 'warning');
          }
          log('└──────────────────────────────────────────────────────────────', 'info');

          // ═══════════════════════════════════════════════════════════════
          // STEP 2b: กดเลือก tab Image
          // ═══════════════════════════════════════════════════════════════
          log('', 'info');
          log('┌─ STEP 2/10 ▸ Image tab ──────────────────────────────', 'info');
          log('│  🔍 กำลังค้นหา tab "Image"...', 'info');

          let imageTab2b = null;
          // วิธี 1: button[role="tab"] ที่มี id ลงท้าย trigger-IMAGE
          const tabBtns2b = document.querySelectorAll('button[role="tab"]');
          for (const tab of tabBtns2b) {
            const tabId = tab.id || '';
            if (tabId.includes('trigger-IMAGE')) {
              imageTab2b = tab;
              log('│  พบ tab จาก id trigger-IMAGE', 'info');
              break;
            }
          }
          // วิธี 2: button[role="tab"] ที่มี icon "image"
          if (!imageTab2b) {
            for (const tab of tabBtns2b) {
              const icon = tab.querySelector('i.google-symbols');
              if (icon && icon.textContent.trim() === 'image') {
                imageTab2b = tab;
                log('│  พบ tab จาก icon "image"', 'info');
                break;
              }
            }
          }
          // วิธี 3: button[role="tab"] ที่มี text "Image"
          if (!imageTab2b) {
            for (const tab of tabBtns2b) {
              const text = tab.textContent?.trim() || '';
              if (text === 'Image' || text.endsWith('Image') || text === 'Images' || text.endsWith('Images')) {
                imageTab2b = tab;
                log('│  พบ tab จาก text match', 'info');
                break;
              }
            }
          }

          if (imageTab2b) {
            const tabState2b = imageTab2b.getAttribute('data-state') || '';
            const tabSelected2b = imageTab2b.getAttribute('aria-selected');
            if (tabState2b === 'active' || tabSelected2b === 'true') {
              log('│  ✅ Image tab ถูกเลือกอยู่แล้ว', 'success');
            } else {
              humanClick(imageTab2b);
              log('│  ✅ กด Image tab แล้ว!', 'success');
              await delay(1000);
            }
          } else {
            log('│  ⚠️ ไม่พบ Image tab - อาจอยู่ใน Image mode แล้ว', 'warning');
          }
          log('└──────────────────────────────────────────────────────────────', 'info');

          // ═══════════════════════════════════════════════════════════════
          // STEP 2c: เลือก Model (logic เดียวกับ 8s handleSetModel)
          // ═══════════════════════════════════════════════════════════════
          log('', 'info');
          log('┌─ STEP 2/10 ▸ เลือก Model ────────────────────────────────────', 'info');

          const { useNanoBanana: useNB2c } = await chrome.storage.local.get('useNanoBanana');
          const targetModel2c = useNB2c ? 'Nano Banana' : 'Nano Banana Pro';
          log(`│  🎯 Target Model: ${targetModel2c}`, 'info');

          // หา Model Dropdown (3 วิธี เหมือน 8s)
          let modelDropdown2c = null;
          const menuBtns2c = document.querySelectorAll('button[aria-haspopup="menu"]');

          // วิธี 1: button[aria-haspopup="menu"] + icon "arrow_drop_down"
          for (const btn of menuBtns2c) {
            const icon = btn.querySelector('i.google-symbols, i.material-icons');
            const iconText = icon?.textContent?.trim() || '';
            if (iconText === 'arrow_drop_down') {
              modelDropdown2c = btn;
              log('│  พบ Model dropdown จาก arrow_drop_down icon', 'info');
              break;
            }
          }
          // วิธี 2: button[aria-haspopup="menu"] + model name text
          if (!modelDropdown2c) {
            for (const btn of menuBtns2c) {
              const text = btn.textContent || '';
              if (text.includes('Banana') || text.includes('Imagen') || text.includes('Veo')) {
                modelDropdown2c = btn;
                log('│  พบ Model dropdown จาก model name text', 'info');
                break;
              }
            }
          }
          // วิธี 3 (legacy): button[role="combobox"]
          if (!modelDropdown2c) {
            const comboboxes2c = document.querySelectorAll('button[role="combobox"]');
            for (const btn of comboboxes2c) {
              const text = btn.textContent || '';
              if (text.includes('Banana') || text.includes('Imagen')) {
                modelDropdown2c = btn;
                log('│  พบ Model dropdown จาก combobox fallback', 'info');
                break;
              }
            }
          }

          if (!modelDropdown2c) {
            log('│  ⚠️ ไม่พบ Model dropdown - ข้ามไป', 'warning');
          } else {
            // เปิด Model Dropdown ผ่าน MAIN world
            log('│  🔍 กำลังเปิด Model Dropdown ผ่าน MAIN world...', 'info');
            const modelClickResult2c = await new Promise((resolve) => {
              chrome.runtime.sendMessage({ type: 'CLICK_MODEL_DROPDOWN' }, (response) => {
                if (chrome.runtime.lastError) {
                  log('│  sendMessage error: ' + chrome.runtime.lastError.message, 'error');
                  resolve(false);
                  return;
                }
                resolve(response && response.success);
              });
            });
            if (modelClickResult2c) {
              log('│  กด Model dropdown (MAIN world) สำเร็จ!', 'success');
            } else {
              log('│  MAIN world ไม่สำเร็จ - ลอง humanClick', 'warning');
              humanClick(modelDropdown2c);
            }
            await delay(1500);

            // หา target model option (3 วิธี เหมือน 8s)
            let targetModelOption2c = null;

            // วิธี 1: role="option" / role="menuitem"
            const options2c = document.querySelectorAll('[role="option"], [role="menuitem"], [data-radix-collection-item]');
            for (const opt of options2c) {
              const optText = opt.textContent || '';
              if (useNB2c) {
                if (optText.includes('Nano Banana') && !optText.includes('Pro')) { targetModelOption2c = opt; break; }
              } else {
                if (optText.includes('Nano Banana Pro')) { targetModelOption2c = opt; break; }
              }
            }
            // วิธี 2: div text match
            if (!targetModelOption2c) {
              const divs2c = document.querySelectorAll('div');
              for (const div of divs2c) {
                const text = div.textContent?.trim() || '';
                if (useNB2c) {
                  if (text.includes('Nano Banana') && !text.includes('Pro') && div.children.length <= 3) { targetModelOption2c = div; break; }
                } else {
                  if (text.includes('Nano Banana Pro') && div.children.length <= 3) { targetModelOption2c = div; break; }
                }
              }
            }
            // วิธี 3: span text match
            if (!targetModelOption2c) {
              const spans2c = document.querySelectorAll('span');
              for (const span of spans2c) {
                const spanText = span.textContent || '';
                if (useNB2c) {
                  if (spanText.includes('Nano Banana') && !spanText.includes('Pro')) { targetModelOption2c = span.closest('div') || span; break; }
                } else {
                  if (spanText.includes('Nano Banana Pro')) { targetModelOption2c = span.closest('div') || span; break; }
                }
              }
            }

            if (targetModelOption2c) {
              log(`│  กำลังกด ${targetModel2c}: ${targetModelOption2c.tagName}`, 'info');
              targetModelOption2c.click();
              await delay(200);
              humanClick(targetModelOption2c);
              log(`│  ✅ เลือก Model: ${targetModel2c} แล้ว!`, 'success');
            } else {
              log(`│  ⚠️ ไม่พบ ${targetModel2c} option`, 'warning');
            }
            await delay(500);
          }
          log('└──────────────────────────────────────────────────────────────', 'info');

          // ═══════════════════════════════════════════════════════════════
          // STEP 2d: ตั้งค่า Aspect Ratio → Portrait (9:16)
          // ═══════════════════════════════════════════════════════════════
          log('', 'info');
          log('┌─ STEP 2/10 ▸ Aspect Ratio → Portrait ──────────────────', 'info');

          let portraitTab2d = null;
          const arTabs2d = document.querySelectorAll('button[role="tab"], button[role="radio"]');
          for (const tab of arTabs2d) {
            const text = tab.textContent?.trim().toLowerCase() || '';
            const icon = tab.querySelector('i.google-symbols, i.material-icons');
            const tabId = tab.id || '';
            if (text.includes('portrait') || icon?.textContent?.trim() === 'crop_9_16' || tabId.includes('PORTRAIT')) {
              portraitTab2d = tab;
              break;
            }
          }

          if (portraitTab2d) {
            const ptState = portraitTab2d.getAttribute('data-state') || '';
            if (ptState === 'active' || ptState === 'on' || portraitTab2d.getAttribute('aria-selected') === 'true') {
              log('│  ✅ Portrait ถูกเลือกแล้ว', 'success');
            } else {
              humanClick(portraitTab2d);
              log('│  ✅ กด Portrait tab แล้ว', 'success');
            }
          } else {
            log('│  ⚠️ ไม่พบ Portrait tab', 'warning');
          }
          await delay(500);
          log('└──────────────────────────────────────────────────────────────', 'info');

          // ═══════════════════════════════════════════════════════════════
          // STEP 2e: ตั้งค่า Output Count → x1
          // ═══════════════════════════════════════════════════════════════
          log('', 'info');
          log('┌─ STEP 2/10 ▸ Outputs → x1 ─────────────────────────────', 'info');

          let x1Tab2e = null;
          const ocTabs2e = document.querySelectorAll('button[role="tab"], button[role="radio"]');
          for (const tab of ocTabs2e) {
            const text = tab.textContent?.trim() || '';
            const tabId = tab.id || '';
            if (text === 'x1' || tabId.includes('trigger-1')) {
              x1Tab2e = tab;
              break;
            }
          }

          if (x1Tab2e) {
            const x1State = x1Tab2e.getAttribute('data-state') || '';
            if (x1State === 'active' || x1State === 'on' || x1Tab2e.getAttribute('aria-selected') === 'true') {
              log('│  ✅ Output x1 ถูกเลือกแล้ว', 'success');
            } else {
              humanClick(x1Tab2e);
              log('│  ✅ กด tab x1 แล้ว', 'success');
            }
          } else {
            log('│  ⚠️ ไม่พบ tab x1', 'warning');
          }
          await delay(500);
          log('└──────────────────────────────────────────────────────────────', 'info');

          // ═══════════════════════════════════════════════════════════════
          // STEP 2f: ปิด Config Dropdown
          // ═══════════════════════════════════════════════════════════════
          log('', 'info');
          log('┌─ STEP 2/10 ▸ ปิด Config Dropdown ──────────────────────────────', 'info');

          if (configBtn) {
            const closeState = configBtn.getAttribute('data-state') || '';
            const closeExpanded = configBtn.getAttribute('aria-expanded');
            if (closeState === 'closed' || closeExpanded === 'false') {
              log('│  ✅ Config dropdown ปิดอยู่แล้ว', 'success');
            } else {
              log('│  🔍 กำลังปิด Config Dropdown...', 'info');
              try {
                await chrome.runtime.sendMessage({ type: 'CLICK_CONFIG_DROPDOWN' });
              } catch (e) {
                humanClick(configBtn);
              }
              await delay(500);
              log('│  ✅ ปิด Config Dropdown แล้ว', 'success');
            }
          } else {
            log('│  ⚠️ ไม่มี Config dropdown ให้ปิด', 'warning');
          }
          log('└──────────────────────────────────────────────────────────────', 'info');

          // รอ UI พร้อมหลังปิด Config Dropdown
          await delay(1000);

          // ═══════════════════════════════════════════════════════════════
          // STEP 3/10
          // ═══════════════════════════════════════════════════════════════
          log('', 'info');
          log('┌─ STEP 3/10: กดปุ่ม + เพิ่ม Ingredient #1 ───────────────────', 'info');
          log('│  🔍 กำลังค้นหาปุ่ม + (add)...', 'info');

          // รอจนกว่าจะพบปุ่ม add (แสดงว่าอยู่ใน Create Image mode แล้ว)
          let addSearchAttempt = 0;
          const addBtn1 = await waitForElement(() => {
            addSearchAttempt++;

            // วิธี 1: button[aria-haspopup="dialog"] ที่มี icon "add_2" (UI ใหม่)
            const dialogBtns = document.querySelectorAll('button[aria-haspopup="dialog"]');
            for (const btn of dialogBtns) {
              const icon = btn.querySelector('i.google-symbols');
              if (icon && icon.textContent.trim() === 'add_2') return btn;
            }

            // วิธี 2: button ที่มี hidden span "Create" + icon "add_2"
            const allBtns = document.querySelectorAll('button');
            for (const btn of allBtns) {
              const span = btn.querySelector('span');
              const icon = btn.querySelector('i.google-symbols');
              if (span && span.textContent.trim() === 'Create' && icon && icon.textContent.trim() === 'add_2') return btn;
            }

            // วิธี 3 (fallback): icon "add_2" ใน button ใดๆ
            const icons = document.querySelectorAll('i.google-symbols');
            for (const icon of icons) {
              if (icon.textContent.trim() === 'add_2') {
                const btn = icon.closest('button');
                if (btn) return btn;
              }
            }

            // Log ทุก 10 ครั้ง
            if (addSearchAttempt % 10 === 1) {
              log(`│  [ครั้งที่ ${addSearchAttempt}] dialogBtns: ${dialogBtns.length}, icons: ${icons.length}`, 'info');
            }

            return null;
          }, 25000);

          if (!addBtn1) {
            const allIcons = document.querySelectorAll('i.google-symbols');
            log(`│  ❌ Debug: google-symbols ${allIcons.length} อัน`, 'error');
            throw new Error('ไม่พบปุ่ม + สำหรับเพิ่ม ingredient - อาจยังไม่ได้เลือก Create Image mode');
          }
          log('│  ✅ พบปุ่ม + แล้ว!', 'success');
          log('│  🖱️ คลิก...', 'info');
          addBtn1.click();
          log('│  ⏳ รอ Upload dialog เปิด 2 วินาที...', 'info');
          await delay(2000);
          log('└──────────────────────────────────────────────────────────────', 'info');

          // ═══════════════════════════════════════════════════════════════
          // STEP 4/10: อัพโหลดรูป (ตัวละคร หรือ สินค้า ถ้าไม่มีตัวละคร)
          // ═══════════════════════════════════════════════════════════════
          // Helper: หาปุ่ม Upload Image
          const findUploadBtn = () => {
            const allBtns = document.querySelectorAll('button');
            for (const btn of allBtns) { const span = btn.querySelector('span'); if (span && span.textContent.trim() === 'Upload image') return btn; }
            for (const btn of allBtns) { const icon = btn.querySelector('i.google-symbols'); if (icon && icon.textContent.trim() === 'upload') return btn; }
            for (const btn of allBtns) { const icon = btn.querySelector('i.google-symbols, i.material-icons'); const t = icon?.textContent?.trim() || ''; if (t === 'file_upload' || t === 'cloud_upload') return btn; }
            return null;
          };

          // Helper: Baseline snapshot
          const takeBaseline = () => ({
            imgs: document.querySelectorAll('img[alt="Generated image"]').length,
            cancel: Array.from(document.querySelectorAll('i.google-symbols')).filter(ic => ic.textContent.trim() === 'cancel').length,
            fail: Array.from(document.querySelectorAll('[data-tile-id]')).filter(t => { const w = t.querySelector('i.google-symbols'); return w && w.textContent.trim() === 'warning'; }).length
          });

          // Helper: Poll รอ upload เสร็จ (เทียบ baseline)
          const pollUploadComplete = async (baseline, label) => {
            // รอ DOM stabilize 3 วินาทีก่อน แล้ว re-baseline fail count
            // เพื่อป้องกัน false positive จาก old failed tiles ที่ lazy-load เข้ามา
            await delay(3000);
            const stableBaseline = takeBaseline();
            baseline = { ...baseline, fail: stableBaseline.fail };
            log(`│  📊 Stable baseline: img=${baseline.imgs}, cancel=${baseline.cancel}, fail=${baseline.fail}`, 'info');

            let sawProgress = false;
            let noProgressCount = 0; // นับรอบที่ไม่เห็น progress ติดต่อกัน
            for (let i = 0; i < 60; i++) {
              await delay(1000);
              let hasProgress = false, progressText = '';
              for (const el of document.querySelectorAll('div')) {
                const text = el.textContent?.trim() || '';
                if (/^\d+%$/.test(text)) { hasProgress = true; progressText = text; break; }
              }
              if (hasProgress) {
                sawProgress = true;
                noProgressCount = 0;
              } else if (sawProgress) {
                noProgressCount++;
              }
              const cur = takeBaseline();

              if (hasProgress) { log(`│  [${i + 1}/60] ยังอัพโหลดอยู่... ${progressText}`, 'info'); continue; }

              // หลังเห็น progress แล้ว ต้องรอ progress หายไป 3 รอบติดต่อกันก่อนเช็ค
              // เพราะ cancel icon ปรากฏระหว่างอัพโหลด + progress % อาจหายชั่วขณะ
              if (sawProgress && noProgressCount < 3) {
                log(`│  [${i + 1}/60] รอยืนยัน... (noProgress: ${noProgressCount}/3)`, 'info');
                continue;
              }

              // เช็ค fail หรือ cancel หลัง progress หายไปแล้ว 3 รอบ
              if (sawProgress && cur.fail > baseline.fail) {
                log(`│  ❌ Upload Failed! (fail: ${baseline.fail} → ${cur.fail})`, 'error');
                throw new Error(`${label} Upload Failed - กรุณาลองใหม่`);
              }
              if (sawProgress && cur.cancel > baseline.cancel && cur.imgs === baseline.imgs) {
                log(`│  ❌ Upload Cancelled! (cancel: ${baseline.cancel} → ${cur.cancel})`, 'error');
                throw new Error(`${label} Upload ถูกยกเลิก (อาจผิด Policy) - กรุณาลองใหม่`);
              }
              if (cur.imgs > baseline.imgs) {
                log(`│  ✅ อัพโหลด${label}เสร็จแล้ว! (img: ${baseline.imgs}→${cur.imgs})`, 'success');
                return;
              }
              // Progress เคยขึ้น → หายไป 3+ รอบ → ไม่มี fail/cancel เพิ่ม → อัปสำเร็จ
              // (ingredient image ไม่มี alt="Generated image" จึงนับ imgs ไม่ได้)
              if (sawProgress && noProgressCount >= 3 && cur.cancel <= baseline.cancel && cur.fail <= baseline.fail) {
                log(`│  ✅ อัพโหลด${label}เสร็จแล้ว! (progress จบ, ไม่มี error)`, 'success');
                return;
              }
              log(`│  [${i + 1}/60] รอ... (img: ${cur.imgs}, cancel: ${cur.cancel}, fail: ${cur.fail})`, 'info');
            }
            throw new Error(`${label}อัพโหลดไม่สำเร็จ - timeout 60 วินาที`);
          };

          // เลือกว่าจะอัพรูปอะไรใน STEP 4
          const uploadCharFirst = !!data.characterImageUrl;
          const step4File = uploadCharFirst
            ? await imageToFile(data.characterImageUrl, 'character.png')
            : await imageToFile(data.productImageUrl, 'product.png');
          const step4Label = uploadCharFirst ? 'รูปตัวละคร' : 'รูปสินค้า';
          const step4Size = uploadCharFirst ? charImgSize : prodImgSize;

          log('', 'info');
          log(`┌─ STEP 4/10: อัพโหลด${step4Label} ──────────────────────────────`, 'info');
          if (!uploadCharFirst) {
            log('│  ℹ️ ไม่มีรูปตัวละคร → อัพรูปสินค้าแทน', 'info');
          }
          log(`│  📷 ขนาดรูป: ${step4Size} KB`, 'info');

          if (!step4File) throw new Error(`ไม่สามารถแปลง${step4Label}เป็น File`);
          log(`│  ✅ แปลงสำเร็จ: ${step4File.name} (${(step4File.size / 1024).toFixed(1)} KB)`, 'success');

          log('│  🔍 กำลังค้นหาปุ่ม Upload Image...', 'info');
          const uploadBtn4 = await waitForElement(findUploadBtn, 5000);
          if (uploadBtn4) { log('│  ✅ พบปุ่ม Upload!', 'success'); humanClick(uploadBtn4); await delay(1000); }
          else { log('│  ⚠️ ไม่พบปุ่ม Upload - ลองใส่ file input โดยตรง', 'warning'); }

          const baseline4 = takeBaseline();
          log(`│  📊 Baseline: img=${baseline4.imgs}, cancel=${baseline4.cancel}, fail=${baseline4.fail}`, 'info');

          log('│  📤 กำลังอัพโหลดเข้า file input...', 'info');
          const uploaded4 = await uploadFileToInput(step4File);
          if (!uploaded4) throw new Error(`ไม่สามารถอัพโหลด${step4Label}`);
          log('│  ✅ อัพโหลดเข้า input สำเร็จ!', 'success');
          await delay(1000);
          log('└──────────────────────────────────────────────────────────────', 'info');

          // ═══════════════════════════════════════════════════════════════
          // STEP 5/10: รออัพโหลดเสร็จ
          // ═══════════════════════════════════════════════════════════════
          log('', 'info');
          log(`┌─ STEP 5/10: รออัพโหลด${step4Label}เสร็จ ───────────────────────`, 'info');
          log(`│  ⏳ กำลังรอ... (baseline: img=${baseline4.imgs}, cancel=${baseline4.cancel}, fail=${baseline4.fail})`, 'info');
          await pollUploadComplete(baseline4, step4Label);
          log('└──────────────────────────────────────────────────────────────', 'info');

          // ═══════════════════════════════════════════════════════════════
          // STEP 6-8: เฉพาะเมื่อมีรูปตัวละคร (ต้องอัพรูปสินค้าเพิ่ม)
          // ═══════════════════════════════════════════════════════════════
          if (uploadCharFirst) {
            // STEP 6/10: กด Add #2
            log('', 'info');
            log('┌─ STEP 6/10: กดปุ่ม + เพิ่ม Ingredient #2 ───────────────────', 'info');
            log('│  ⏳ รอ 1 วินาที...', 'info');
            await delay(1000);
            log('│  🔍 กำลังค้นหาปุ่ม + (add_2)...', 'info');
            const addBtn2 = await waitForElement(() => {
              const dialogBtns = document.querySelectorAll('button[aria-haspopup="dialog"]');
              for (const btn of dialogBtns) { const icon = btn.querySelector('i.google-symbols'); if (icon && icon.textContent.trim() === 'add_2') return btn; }
              const allBtns = document.querySelectorAll('button');
              for (const btn of allBtns) { const span = btn.querySelector('span'); const icon = btn.querySelector('i.google-symbols'); if (span && span.textContent.trim() === 'Create' && icon && icon.textContent.trim() === 'add_2') return btn; }
              for (const icon of document.querySelectorAll('i.google-symbols')) { if (icon.textContent.trim() === 'add_2') { const btn = icon.closest('button'); if (btn) return btn; } }
              return null;
            }, 10000);
            if (!addBtn2) throw new Error('ไม่พบปุ่ม + สำหรับเพิ่ม ingredient ที่ 2');
            log('│  ✅ พบปุ่ม + แล้ว!', 'success');
            addBtn2.click();
            log('│  ⏳ รอ dialog เปิด 1.5 วินาที...', 'info');
            await delay(1500);
            log('└──────────────────────────────────────────────────────────────', 'info');

            // STEP 7/10: Upload รูปสินค้า
            log('', 'info');
            log('┌─ STEP 7/10: อัพโหลดรูปสินค้า ───────────────────────────────', 'info');
            log(`│  🛍️ ขนาดรูป: ${prodImgSize} KB`, 'info');
            const productFile = await imageToFile(data.productImageUrl, 'product.png');
            if (!productFile) throw new Error('ไม่สามารถแปลงรูปสินค้าเป็น File');
            log(`│  ✅ แปลงสำเร็จ: ${productFile.name} (${(productFile.size / 1024).toFixed(1)} KB)`, 'success');

            log('│  🔍 กำลังค้นหาปุ่ม Upload Image...', 'info');
            const uploadBtn7 = await waitForElement(findUploadBtn, 5000);
            if (uploadBtn7) { log('│  ✅ พบปุ่ม Upload!', 'success'); humanClick(uploadBtn7); await delay(1000); }
            else { log('│  ⚠️ ไม่พบปุ่ม Upload - ลองใส่ file input โดยตรง', 'warning'); }

            const baseline7 = takeBaseline();
            log(`│  📊 Baseline: img=${baseline7.imgs}, cancel=${baseline7.cancel}, fail=${baseline7.fail}`, 'info');

            log('│  📤 กำลังอัพโหลดเข้า file input...', 'info');
            const uploaded7 = await uploadFileToInput(productFile);
            if (!uploaded7) throw new Error('ไม่สามารถอัพโหลดรูปสินค้า');
            log('│  ✅ อัพโหลดเข้า input สำเร็จ!', 'success');
            await delay(1000);
            log('└──────────────────────────────────────────────────────────────', 'info');

            // STEP 8/10: รออัพโหลดรูปสินค้าเสร็จ
            log('', 'info');
            log('┌─ STEP 8/10: รออัพโหลดรูปสินค้าเสร็จ ───────────────────────', 'info');
            log(`│  ⏳ กำลังรอ... (baseline: img=${baseline7.imgs}, cancel=${baseline7.cancel}, fail=${baseline7.fail})`, 'info');
            await pollUploadComplete(baseline7, 'รูปสินค้า');
            log('└──────────────────────────────────────────────────────────────', 'info');
          } else {
            log('', 'info');
            log('┌─ STEP 6-8: ข้าม (อัพรูปสินค้าใน STEP 4 แล้ว) ──────────────', 'info');
            log('│  ⏩ ไม่มีรูปตัวละคร → ไม่ต้องอัพ ingredient ที่ 2', 'info');
            log('└──────────────────────────────────────────────────────────────', 'info');
          }

          // ═══════════════════════════════════════════════════════════════
          // เก็บรูปไว้ใน chrome.storage.local สำหรับ Image GEN ใช้ทีหลัง
          // ═══════════════════════════════════════════════════════════════
          try {
            const saveProjectUrl = window.location.href;
            const storageKey = 'flow_ingredient_images_' + saveProjectUrl;
            const imagesToSave = {};
            if (data.characterImageUrl) imagesToSave.characterImageUrl = data.characterImageUrl;
            if (data.productImageUrl) imagesToSave.productImageUrl = data.productImageUrl;
            await chrome.storage.local.set({ [storageKey]: imagesToSave });
            log(`💾 เก็บรูป ingredient ไว้ใน storage สำหรับ Image GEN (key: ${storageKey})`, 'success');
          } catch (storageErr) {
            log(`⚠️ เก็บรูปไม่สำเร็จ: ${storageErr.message}`, 'warning');
          }

          await delay(300);

          // ═══════════════════════════════════════════════════════════════
          // STEP 9/10: ใส่ Prompt — ปิดชั่วคราว (Product Set)
          // ═══════════════════════════════════════════════════════════════
          log('', 'info');
          log('┌─ STEP 9/10: ข้าม (ปิดชั่วคราว) ──────────────────────────────', 'info');
          log('│  ⏩ ข้ามการใส่ Prompt', 'info');
          log('└──────────────────────────────────────────────────────────────', 'info');

          // ═══════════════════════════════════════════════════════════════
          // STEP 10/10: Generate — ปิดชั่วคราว (Product Set)
          // ═══════════════════════════════════════════════════════════════
          log('', 'info');
          log('┌─ STEP 10/10: ข้าม (ปิดชั่วคราว) ─────────────────────────────', 'info');
          log('│  ⏩ ข้ามการกด Generate', 'info');
          log('└──────────────────────────────────────────────────────────────', 'info');

          // ═══════════════════════════════════════════════════════════════
          // COMPLETE!
          // ═══════════════════════════════════════════════════════════════
          projectUrl = window.location.href;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

          log('', 'info');
          log('╔══════════════════════════════════════════════════════════════╗', 'success');
          log('║  ✅ AUTOMATION เสร็จสมบูรณ์! (ข้าม Prompt + Generate)        ║', 'success');
          log('╚══════════════════════════════════════════════════════════════╝', 'success');
          log(`⏱️ ใช้เวลาทั้งหมด: ${elapsed} วินาที`, 'info');
          log(`📎 Project URL: ${projectUrl}`, 'info');
          log('', 'info');
          sendResponse({ success: true, projectUrl: projectUrl });

        } catch (error) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          log('', 'error');
          log('╔══════════════════════════════════════════════════════════════╗', 'error');
          log('║  ❌ AUTOMATION ERROR!                                         ║', 'error');
          log('╚══════════════════════════════════════════════════════════════╝', 'error');
          log(`❌ Error: ${error.message}`, 'error');
          log(`⏱️ หยุดหลังจาก: ${elapsed} วินาที`, 'info');
          log('', 'error');
          sendResponse({ success: false, error: error.message, projectUrl: window.location.href });
        }
      })();

      return true; // Keep channel open for async response
    }

    // ไม่ return true สำหรับ message ที่ไม่ได้จัดการ — ป้องกัน channel close error
    return false;
  });

  // ========== Initialization ==========

  // แจ้งว่า script พร้อมทำงาน
  log('Content script ready!', 'success');

  try {
    chrome.runtime.sendMessage({
      type: 'AISTUDIO_CONTENT_SCRIPT_READY'
    });
  } catch (e) {
    // Ignore if extension context is invalid
  }

})(); // End of IIFE - ป้องกัน duplicate execution
