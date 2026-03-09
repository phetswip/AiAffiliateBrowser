/**
 * Story Mode - Pipeline Orchestration (Popup side)
 * Extracted from PD AUTO FLOW v15.1.6
 *
 * จัดการ pipeline ทั้งหมด: AI → สร้างรูป → Scene Builder → Export
 * ทำงานฝั่ง popup ส่ง message ไปหา content script
 */

// ============================================================
// STATE MANAGEMENT
// ============================================================

const storyState = {
  flowTabId: null,          // Tab ID ของ Google Flow
  flowProjectUrl: null,     // URL ของ Flow Project ปัจจุบัน (สำหรับ Resume)
  scenes: [],               // Storyboard scenes จาก AI
  config: {},               // ค่าตั้งค่าปัจจุบัน
  stopped: false,           // ผู้ใช้กดหยุด
  isRunning: false,          // ป้องกัน pipeline รันซ้อน
  imagesCompleted: 0,
  videosCompleted: 0,
  currentPhase: '',         // 'creating_images', 'creating_videos', 'exporting'

  // Loop
  loopEnabled: false,
  loopCount: 3,
  loopUnlimited: false,
  loopDelay: 30,            // seconds
  loopIndex: 0,
  topicsUsed: [],

  // Voice Preview
  selectedSceneIndex: 0,    // Current selected scene for voice preview
  generatedVoices: {},      // { sceneIndex: { audioUrl, text } }

  // Stats
  stats: {
    imagesCreated: 0,
    clipsCreated: 0,
    exportSuccess: 0,
    exportFailed: 0
  },

  // Concatenate Only Mode (ต่อฉากอย่างเดียว - ข้าม Step 1-2)
  concatenateOnlyMode: false,

  // Resume Mode (ทำต่อจากที่ค้าง)
  resumeMode: false,
  lastCompletedSceneIndex: -1
};

// Sequential log counter for Activity Log
let logSeqCounter = 0;

// ============================================================
// AUDIO CONCATENATION (Web Audio API)
// ============================================================

/**
 * รวม audio blobs หลายไฟล์เป็นไฟล์เดียวด้วย Web Audio API
 * @param {Blob[]} blobs - Array ของ audio blobs
 * @returns {Promise<Blob>} - Combined WAV blob
 */
async function concatenateAudioBlobs(blobs) {
  if (blobs.length === 0) throw new Error('No audio blobs to concatenate');
  if (blobs.length === 1) return blobs[0];

  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffers = [];

  // Decode each blob into AudioBuffer
  for (const blob of blobs) {
    const arrayBuffer = await blob.arrayBuffer();
    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      audioBuffers.push(audioBuffer);
    } catch (err) {
      console.warn('[Audio] Failed to decode blob, skipping:', err);
    }
  }

  if (audioBuffers.length === 0) throw new Error('Failed to decode any audio');

  // Calculate total length
  const sampleRate = audioBuffers[0].sampleRate;
  const numberOfChannels = audioBuffers[0].numberOfChannels;
  let totalLength = 0;
  for (const buf of audioBuffers) {
    totalLength += buf.length;
  }

  // Create combined buffer
  const combinedBuffer = audioContext.createBuffer(numberOfChannels, totalLength, sampleRate);

  // Copy data from each buffer
  let offset = 0;
  for (const buf of audioBuffers) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const channelData = combinedBuffer.getChannelData(channel);
      const sourceData = buf.getChannelData(Math.min(channel, buf.numberOfChannels - 1));
      channelData.set(sourceData, offset);
    }
    offset += buf.length;
  }

  // Encode to WAV
  const wavBlob = audioBufferToWav(combinedBuffer);
  audioContext.close();

  return wavBlob;
}

/**
 * แปลง AudioBuffer เป็น WAV Blob
 */
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write interleaved audio data
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// ============================================================
// CUSTOM STYLED POPUP
// ============================================================

/**
 * แสดง Popup แจ้งเตือนแบบ Custom ที่สวยงาม
 * @param {string} message - ข้อความที่จะแสดง
 * @param {string} type - ประเภท: 'warning', 'error', 'success', 'info'
 * @param {string} title - หัวข้อ (optional)
 * @returns {Promise<void>}
 */
function showStoryAlert(message, type = 'warning', title = '') {
  return new Promise((resolve) => {
    // ลบ popup เก่าถ้ามี
    const existingPopup = document.getElementById('storyAlertOverlay');
    if (existingPopup) existingPopup.remove();

    // กำหนดสีตาม type
    const colors = {
      warning: { bg: '#00109E', icon: '⚠️', title: 'แจ้งเตือน' },
      error: { bg: '#ff6b6b', icon: '❌', title: 'ข้อผิดพลาด' },
      success: { bg: '#4ade80', icon: '✅', title: 'สำเร็จ' },
      info: { bg: '#60a5fa', icon: 'ℹ️', title: 'ข้อมูล' }
    };
    const color = colors[type] || colors.warning;
    const displayTitle = title || color.title;

    // สร้าง overlay
    const overlay = document.createElement('div');
    overlay.id = 'storyAlertOverlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      animation: fadeIn 0.2s ease-out;
    `;

    // สร้าง popup box
    const popup = document.createElement('div');
    popup.style.cssText = `
      background: linear-gradient(135deg, #ffffff 0%, #f5f5f5 100%);
      border: 1px solid ${color.bg}40;
      border-radius: 16px;
      padding: 0;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px ${color.bg}20;
      animation: slideIn 0.3s ease-out;
      overflow: hidden;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      background: linear-gradient(90deg, ${color.bg}30 0%, ${color.bg}10 100%);
      padding: 16px 20px;
      border-bottom: 1px solid ${color.bg}30;
      display: flex;
      align-items: center;
      gap: 10px;
    `;
    header.innerHTML = `
      <span style="font-size: 24px;">${color.icon}</span>
      <span style="font-size: 16px; font-weight: 600; color: ${color.bg};">${displayTitle}</span>
    `;

    // Body
    const body = document.createElement('div');
    body.style.cssText = `
      padding: 24px 20px;
      color: #333333;
      font-size: 14px;
      line-height: 1.6;
      text-align: center;
    `;
    body.innerHTML = message.replace(/\n/g, '<br>');

    // Footer with button
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding: 16px 20px;
      border-top: 1px solid rgba(0,0,0,0.1);
      display: flex;
      justify-content: center;
    `;

    const btn = document.createElement('button');
    btn.textContent = 'ตกลง';
    btn.style.cssText = `
      background: linear-gradient(135deg, ${color.bg} 0%, ${color.bg}cc 100%);
      color: #ffffff;
      border: none;
      padding: 10px 40px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 15px ${color.bg}40;
    `;
    btn.onmouseover = () => {
      btn.style.transform = 'translateY(-2px)';
      btn.style.boxShadow = `0 6px 20px ${color.bg}60`;
    };
    btn.onmouseout = () => {
      btn.style.transform = 'translateY(0)';
      btn.style.boxShadow = `0 4px 15px ${color.bg}40`;
    };
    btn.onclick = () => {
      overlay.style.animation = 'fadeOut 0.2s ease-out';
      setTimeout(() => {
        overlay.remove();
        resolve();
      }, 180);
    };

    footer.appendChild(btn);
    popup.appendChild(header);
    popup.appendChild(body);
    popup.appendChild(footer);
    overlay.appendChild(popup);

    // Add CSS animations
    if (!document.getElementById('storyAlertStyles')) {
      const style = document.createElement('style');
      style.id = 'storyAlertStyles';
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes slideIn {
          from { transform: translateY(-20px) scale(0.95); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(overlay);

    // กด ESC หรือ click overlay เพื่อปิด
    overlay.onclick = (e) => {
      if (e.target === overlay) btn.click();
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        btn.click();
        document.removeEventListener('keydown', handleEsc);
      }
    };
    document.addEventListener('keydown', handleEsc);

    // Auto focus button
    setTimeout(() => btn.focus(), 100);
  });
}

// ============================================================
// CHROME MESSAGE HELPER
// ============================================================

/**
 * ส่ง message ไปที่ content script บน Google Flow tab
 * @param {string} action - ชื่อ action
 * @param {Object} params - parameters เพิ่มเติม
 * @param {number} timeout - timeout in ms (default 180000 = 3 min)
 * @returns {Promise<Object>} response from content script
 */
function sendToFlowTab(action, params = {}, timeout = 180000) {
  return new Promise((resolve, reject) => {
    if (!storyState.flowTabId) {
      reject(new Error('ไม่พบ tab Google Flow'));
      return;
    }

    const message = { action, ...params };
    const timer = setTimeout(() => {
      reject(new Error(`Timeout: ${action} (${timeout / 1000}s)`));
    }, timeout);

    chrome.tabs.sendMessage(storyState.flowTabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * ส่ง Image Gen ผ่าน background.js → aistudio-content-script.js (9-step Config Dropdown)
 * เหมือน mode-8s: START_AISTUDIO_GEN → AISTUDIO_PICTURE_URL
 */
function sendImageGenViaBackground(imagePrompt, sceneNum, projectUrl, referenceImages, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const sceneRowId = `story_scene_${Date.now()}_${sceneNum}`;
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error(`Timeout: Image Gen scene ${sceneNum} (${timeout / 1000}s)`));
    }, timeout);

    const listener = (message) => {
      if (message.type === 'AISTUDIO_PICTURE_URL' && message.data?.rowId === sceneRowId) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        resolve({ success: true, imageUrl: message.data.pictureUrl, pictureUrl: message.data.pictureUrl });
      }
      if (message.type === 'AISTUDIO_GEN_COMPLETE' && !message.success) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        reject(new Error(message.error || message.data?.error || 'GEN ภาพล้มเหลว'));
      }
      // แสดงสถานะขั้นตอนใน Activity Log (Image Gen)
      if (message.type === 'VIDEO_GEN_STATUS' && message.data) {
        addCreatorLog(message.data.message || 'สถานะ', message.data.logType || 'info', sceneNum);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // ส่ง reference images (character/product) ให้ content script upload ผ่านปุ่ม Upload
    const msgData = {
      rowId: sceneRowId,
      rowNumber: sceneNum,
      imagePrompt: imagePrompt,
      projectUrl: projectUrl || 'https://aistudio.google.com'
    };
    if (referenceImages && referenceImages.length > 0) {
      // character → characterImageUrl, product → productImageUrl
      for (const ref of referenceImages) {
        if (ref.type === 'character' && ref.base64) msgData.characterImageUrl = ref.base64;
        if (ref.type === 'product' && ref.base64) msgData.productImageUrl = ref.base64;
      }
    }

    chrome.runtime.sendMessage({
      type: 'START_AISTUDIO_GEN',
      data: msgData
    }, (response) => {
      if (chrome.runtime.lastError) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        reject(new Error(chrome.runtime.lastError.message));
      }
    });
  });
}

/**
 * ส่ง Video Gen ผ่าน background.js → aistudio-content-script.js (9-step Config Dropdown)
 * เหมือน mode-8s: START_VIDEO_GEN → VIDEO_URL_RESULT
 */
function sendVideoGenViaBackground(videoPrompt, pictureUrl, sceneNum, projectUrl, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const videoRowId = `story_video_${Date.now()}_${sceneNum}`;
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error(`Timeout: Video Gen scene ${sceneNum} (${timeout / 1000}s)`));
    }, timeout);

    const listener = (message) => {
      if (message.type === 'VIDEO_URL_RESULT' && message.data?.rowId === videoRowId) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        resolve({ success: true, videoUrl: message.data.videoUrl });
      }
      if (message.type === 'VIDEO_GEN_COMPLETE' && !message.success) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        reject(new Error(message.error || message.data?.error || 'GEN วิดีโอล้มเหลว'));
      }
      // แสดงสถานะ retry/error ใน Activity Log (เหมือน mode-8s)
      if (message.type === 'VIDEO_GEN_STATUS' && message.data) {
        const logType = message.data.logType || 'info';
        addCreatorLog(message.data.message || 'สถานะ Video Gen', logType, sceneNum);
      }
      // แสดง progress ระหว่างรอ video generate
      if (message.type === 'VIDEO_GEN_PROGRESS' && message.data) {
        const { progress, elapsed, maxWait, status } = message.data;
        addCreatorLog(`รอวิดีโอ: ${progress}% (${Math.round(elapsed)}s/${Math.round(maxWait)}s)`, 'info', sceneNum);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    chrome.runtime.sendMessage({
      type: 'START_VIDEO_GEN',
      data: {
        rowId: videoRowId,
        rowNumber: sceneNum,
        videoPrompt: videoPrompt,
        pictureUrl: pictureUrl,
        projectUrl: projectUrl || 'https://aistudio.google.com',
        skipEndFrame: true
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        reject(new Error(chrome.runtime.lastError.message));
      }
    });
  });
}

/**
 * หา tab ที่เปิด Google Flow อยู่
 * @returns {Promise<number|null>} tab ID
 */
async function findFlowTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      const flowTab = tabs.find(t => t.url && t.url.includes('labs.google'));
      resolve(flowTab ? flowTab.id : null);
    });
  });
}

// ============================================================
// PROGRESS UI
// ============================================================

function updateStoryProgress(status, percent) {
  const statusEl = document.getElementById('storyProgressStatus');
  const barEl = document.getElementById('storyProgressBar');
  const imgEl = document.getElementById('storyImageProgress');
  const vidEl = document.getElementById('storyVideoProgress');

  if (statusEl) statusEl.textContent = status;
  if (barEl) barEl.style.width = percent + '%';
  if (imgEl) imgEl.textContent = `${storyState.imagesCompleted}/${storyState.scenes.length}`;
  if (vidEl) vidEl.textContent = `${storyState.videosCompleted}/${storyState.scenes.length}`;
}

function addCreatorLog(message, type = 'info', sceneNumber = null) {
  logSeqCounter++;
  console.log(`[StoryMode][${type}]${sceneNumber ? `[Scene ${sceneNumber}]` : ''} ${message}`);

  // แสดงใน UI Log (เหมือน mode-8s ActivityLog)
  const logContainer = document.getElementById('storyLogContainer');
  if (logContainer) {
    // สีข้อความตาม type (เหมือน mode-8s: getLogColor)
    const typeColors = {
      info: '#9ca3af',      // text-muted-foreground
      step: '#9ca3af',
      success: 'var(--brand-color, #FFB300)',  // text-primary
      error: '#ef4444',     // text-destructive
      warning: 'color-mix(in srgb, var(--brand-color, #FFB300) 80%, transparent)'  // text-primary/80
    };
    const msgColor = typeColors[type] || typeColors.info;

    // สร้าง log entry (เหมือน mode-8s: #N + time + [Scene N] + message)
    const time = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logEntry = document.createElement('div');
    logEntry.style.cssText = 'font-size: 12px; padding: 4px 8px; line-height: 1.6;';

    const sceneTag = sceneNumber ? `<span style="color: #9ca3af;"> [Scene ${sceneNumber}]</span>` : '';

    logEntry.innerHTML = `<span style="font-weight: 600; color: color-mix(in srgb, var(--brand-color, #FFB300) 70%, transparent); margin-right: 6px;">#${logSeqCounter}</span><span style="color: #9ca3af;">${time}</span>${sceneTag}<span style="margin-left: 6px; color: ${msgColor};">${message}</span>`;

    // ลบ placeholder
    if (logContainer.children.length === 1 && (logContainer.firstChild.textContent?.includes('รอคำสั่ง') || logContainer.firstChild.textContent?.includes('No activity'))) {
      logContainer.innerHTML = '';
      logSeqCounter = 0;
      logSeqCounter++;
    }

    // เพิ่มที่ด้านบน (ล่าสุดอยู่บนสุด)
    logContainer.insertBefore(logEntry, logContainer.firstChild);
  }

  // ส่ง log ไป React parent (ActivityLog tab)
  try {
    window.parent.postMessage({
      type: 'STORY_LOG',
      data: { seq: logSeqCounter, message, logType: type, sceneNumber }
    }, '*');
  } catch (e) { /* ignore if no parent */ }
}

// Reset log counter (call when starting new pipeline)
function resetLogCounter() {
  logSeqCounter = 0;
}

/**
 * Reset ทุกอย่าง - Form values, State, Log, Preview
 */
function resetAllStoryData() {
  // 1. Reset storyState
  storyState.flowTabId = null;
  storyState.scenes = [];
  storyState.config = {};
  storyState.stopped = false;
  chrome.storage.local.remove('story_stop_requested');
  storyState.isRunning = false;
  storyState.imagesCompleted = 0;
  storyState.videosCompleted = 0;
  storyState.currentPhase = '';
  storyState.loopEnabled = false;
  storyState.loopCount = 3;
  storyState.loopUnlimited = false;
  storyState.loopDelay = 30;
  storyState.loopIndex = 0;
  storyState.topicsUsed = [];
  storyState.selectedSceneIndex = 0;
  storyState.generatedVoices = {};
  storyState.stats = { imagesCreated: 0, clipsCreated: 0, exportSuccess: 0, exportFailed: 0 };

  // 2. Reset form values
  const formResets = [
    { id: 'storyTopic', value: '', type: 'textarea' },
    { id: 'storyDetails', value: '', type: 'textarea' },
    { id: 'storyImageStyle', value: 'pixar_3d', type: 'select' },
    { id: 'storyMood', value: 'random', type: 'select' },
    { id: 'storyLanguage', value: 'th', type: 'select' },
    { id: 'storySceneCount', value: '1', type: 'select' },
    { id: 'storyAspectRatio', value: '9:16', type: 'select' },
    { id: 'storyChar1Name', value: '', type: 'input' },
    { id: 'storyChar1Desc', value: '', type: 'input' },
    { id: 'storyboardLoopEnabled', checked: false, type: 'checkbox' },
    { id: 'storyLoopCount', value: '3', type: 'input' },
    { id: 'storyLoopDelay', value: '30', type: 'input' }
  ];

  formResets.forEach(item => {
    const el = document.getElementById(item.id);
    if (el) {
      if (item.type === 'checkbox') {
        el.checked = item.checked;
      } else {
        el.value = item.value;
      }
    }
  });

  // 3. Clear character image (box 1)
  const charPreview = document.getElementById('storyCharacter1Preview');
  const charPlaceholder = document.getElementById('storyCharacter1Placeholder');
  const charRemoveBtn = document.getElementById('storyRemoveCharacter1');
  const charInput = document.getElementById('storyCharacter1Input');
  if (charPreview) {
    charPreview.style.display = 'none';
    charPreview.src = '';
  }
  if (charPlaceholder) charPlaceholder.style.display = 'flex';
  if (charRemoveBtn) charRemoveBtn.style.display = 'none';
  if (charInput) charInput.value = '';

  // 3.1 Clear additional character boxes (ฉาก 2, 3, ...)
  const additionalCharBoxes = document.getElementById('additionalCharacterBoxes');
  if (additionalCharBoxes) additionalCharBoxes.innerHTML = '';

  // 3.2 Reset label of box 1 to "ตัวละคร" (not "ฉาก 1")
  const charLabel1 = document.getElementById('characterBoxLabel1');
  if (charLabel1) charLabel1.textContent = 'ตัวละคร';

  // 3.3 Reset same-char toggle to OFF (default)
  if (typeof window.setSameCharToggle === 'function') {
    window.setSameCharToggle(false);
    window._sameCharToggleOn = false;
  }

  // 4. Clear storyboard preview
  const previewSection = document.getElementById('storyboardPreviewSection');
  const previewContent = document.getElementById('storyboardPreviewContent');
  const scriptList = document.getElementById('scriptSelectionList');
  if (previewSection) previewSection.style.display = 'none';
  if (previewContent) previewContent.innerHTML = '';
  if (scriptList) scriptList.innerHTML = '';

  // 5. Hide progress section
  const progressSection = document.getElementById('storyProgressSection');
  if (progressSection) progressSection.style.display = 'none';

  // 6. Reset progress bar
  const progressBar = document.getElementById('storyProgressBar');
  const progressStatus = document.getElementById('storyProgressStatus');
  const imageProgress = document.getElementById('storyImageProgress');
  const videoProgress = document.getElementById('storyVideoProgress');
  if (progressBar) progressBar.style.width = '0%';
  if (progressStatus) progressStatus.textContent = 'กำลังเตรียมการ...';
  if (imageProgress) imageProgress.textContent = '0/0';
  if (videoProgress) videoProgress.textContent = '0/0';

  // 7. Clear activity log
  const logContainer = document.getElementById('storyLogContainer');
  if (logContainer) {
    logContainer.innerHTML = '<div class="log-entry" style="padding: 10px 12px; color: #888; border-bottom: 1px solid #2a2a2a;">รอคำสั่ง...</div>';
  }

  // 8. Reset log counter
  resetLogCounter();

  // 9. Hide loop options
  const loopOptionsRow = document.getElementById('storyboardLoopOptionsRow');
  const loopProgress = document.getElementById('storyLoopProgress');
  if (loopOptionsRow) loopOptionsRow.style.display = 'none';
  if (loopProgress) loopProgress.style.display = 'none';

  // 10. Show Run button, hide Stop button
  const runBtn = document.getElementById('storyRunBtn');
  const stopBtn = document.getElementById('storyStopBtn');
  if (runBtn) runBtn.style.display = 'block';
  if (stopBtn) stopBtn.style.display = 'none';

  console.log('[StoryMode] All data reset');
  addCreatorLog('🔄 Reset ทุกอย่างแล้ว', 'info');
}

// ============================================================
// GENERATE STORYBOARD (อ่านค่าจาก form → เรียก AI)
// ============================================================

/**
 * อ่านค่าจาก form แล้วเรียก Gemini AI สร้าง Storyboard
 * ต้องมี StoryboardAI จาก storyboard-ai.js
 */
async function generateStoryboard() {
  // อ่านค่าจากฟอร์ม
  const topic = document.getElementById('storyTopic')?.value?.trim();
  const details = document.getElementById('storyDetails')?.value?.trim() || '';
  const style = document.getElementById('storyImageStyle')?.value || '';
  const mood = document.getElementById('storyMood')?.value || 'random';
  const targetAudience = document.getElementById('storyTargetAudience')?.value || 'general';
  const sceneCount = parseInt(document.getElementById('storySceneCount')?.value) || 4;
  const aspectRatio = document.getElementById('storyAspectRatio')?.value || '9:16';
  const voiceValue = document.getElementById('storyVoice1')?.value || '';
  const language = document.getElementById('storyLanguage')?.value || 'th';
  const isRealisticMode = document.getElementById('storyRealisticMode')?.checked || false;
  const noTextOverlay = document.getElementById('storyNoTextOverlay')?.checked || false;

  // ตรวจ OpenAI/OpenRouter API Key
  const hasOpenAIKey = window.StoryboardAI?.getOpenAIConfig?.() !== null;

  // Character - เช็คก่อน validation (รองรับ multi-character per scene)
  // ตรวจว่ามี character อย่างน้อย 1 ตัว (เช็คแค่ box 1 ก็พอ — toggle ON ใช้ box 1 ทุกฉาก)
  const char1Name = document.getElementById('storyChar1Name')?.value?.trim();
  const char1Preview = document.getElementById('storyCharacter1Preview');
  const hasCharacter = !!(char1Name || (char1Preview?.src && char1Preview.style.display !== 'none'));
  const hasCharacters = hasCharacter;

  // ========== รวบรวม Validation Errors ทั้งหมด (เรียงสั้น→ยาว) ==========
  const errors = [];
  if (!style) errors.push('• Video Style');
  if (!hasCharacter) errors.push('• Character <span style="font-size:11px;color:#aaa;">(ชื่อ หรือ รูป)</span>');
  if (!topic) errors.push('• หัวข้อและเนื้อเรื่อง');
  if (!hasOpenAIKey) errors.push('• OpenAI/OpenRouter API Key <span style="font-size:11px;color:#aaa;">(ไปตั้งค่าที่ Settings)</span>');
  const postTiktokVal = document.getElementById('storyPostTiktok')?.value;
  if (!postTiktokVal) errors.push('• เลือกวิธีลงคลิป');

  // ถ้ามี error แสดง popup รวม
  if (errors.length > 0) {
    await showStoryAlert(
      '<b>กรุณากรอกข้อมูลให้ครบ:</b><br><br>' + errors.join('<br>'),
      'warning',
      'ข้อมูลไม่ครบ'
    );
    addCreatorLog('❌ กรุณากรอกข้อมูลให้ครบ: ' + errors.map(e => e.replace(/<[^>]*>/g, '')).join(', '), 'error');
    return;
  }

  // แปลง voice value เป็น gender (default female สำหรับ Veo 3.1)
  const voiceGender = voiceValue?.startsWith('male') ? 'male' : 'female';

  // Characters - รวบรวมจากทุก box ตามจำนวนฉาก
  const sameCharToggle = window._sameCharToggleOn || false;
  const characters = [];

  if (sameCharToggle) {
    // Toggle ON → ใช้ box 1 เหมือนกันทุกฉาก
    const name = document.getElementById('storyChar1Name')?.value?.trim();
    const desc = document.getElementById('storyChar1Desc')?.value?.trim();
    const preview = document.getElementById('storyCharacter1Preview');
    const hasImage = preview?.src && preview.style.display !== 'none';
    const genderEl = document.getElementById('storyChar1Gender');
    const genderRaw = genderEl?.value || 'random';
    if (name || hasImage) {
      for (let i = 0; i < sceneCount; i++) {
        const gender = genderRaw === 'random' ? (Math.random() < 0.5 ? 'female' : 'male') : genderRaw;
        characters.push({
          name: name || 'ตัวละคร 1',
          desc: desc || '',
          image: hasImage ? preview.src : null,
          gender
        });
      }
    }
  } else {
    // Toggle OFF → ใช้แต่ละ box ตามฉาก (สร้างทุกฉากเพื่อให้ index ตรงกับ scene number)
    for (let i = 1; i <= sceneCount; i++) {
      const name = document.getElementById(`storyChar${i}Name`)?.value?.trim();
      const desc = document.getElementById(`storyChar${i}Desc`)?.value?.trim();
      const preview = document.getElementById(`storyCharacter${i}Preview`);
      const hasImage = preview?.src && preview.style.display !== 'none';
      const genderEl = document.getElementById(`storyChar${i}Gender`);
      const genderRaw = genderEl?.value || 'random';
      const gender = genderRaw === 'random' ? (Math.random() < 0.5 ? 'female' : 'male') : genderRaw;
      // สร้าง entry ทุกฉาก (แม้ไม่มี character) เพื่อให้ index ตรงกับ scene number
      // ป้องกัน product data เลื่อนไปผิดฉาก
      characters.push({
        name: (name || hasImage) ? (name || `ตัวละคร ${i}`) : '',
        desc: desc || '',
        image: hasImage ? preview.src : null,
        gender
      });
    }
  }

  // Product — หาจากทุกฉาก ใช้ตัวแรกที่มีรูปหรือชื่อ
  let product = null;
  for (let pi = 1; pi <= sceneCount; pi++) {
    const pPreview = document.getElementById(`storyProduct${pi}Preview`);
    // อ่านชื่อจาก select dropdown ก่อน → ถ้าเป็น custom ค่อยอ่านจาก input
    const pSelect = document.getElementById(`storyProduct${pi}Select`);
    let pName = '';
    if (pSelect && pSelect.value && pSelect.value !== '' && pSelect.value !== 'custom') {
      // เลือกจาก dropdown → อ่านชื่อจาก option text
      pName = pSelect.options[pSelect.selectedIndex]?.textContent?.trim() || '';
    }
    if (!pName) {
      pName = document.getElementById(`storyProduct${pi}Name`)?.value?.trim() || '';
    }
    const pHasImage = pPreview?.src && pPreview.style.display !== 'none';
    if (pName || pHasImage) {
      product = { name: pName || 'สินค้า', image: pHasImage ? pPreview.src : null, asProp: true, mentionInScript: true, mentionTiming: 'end' };
      break;
    }
  }
  // Fallback: old single product element (storyProductPreview)
  if (!product) {
    const productPreview = document.getElementById('storyProductPreview');
    const productName = document.getElementById('storyProductName')?.value?.trim();
    if (productPreview?.src && productPreview.style.display !== 'none') {
      product = { name: productName || 'สินค้า', image: productPreview.src, asProp: true, mentionInScript: true, mentionTiming: 'end' };
    }
  }

  // Cover text
  let coverText = null;
  if (document.getElementById('storyCoverTextEnabled')?.checked) {
    coverText = {
      enabled: true,
      text: document.getElementById('storyCoverText')?.value?.trim() || '',
      position: document.getElementById('storyCoverTextPosition')?.value || '',
      color: document.getElementById('storyCoverTextColor')?.value || ''
    };
  }

  // Disable button
  const btn = document.getElementById('generateStoryboardBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ AI กำลังคิด Storyboard...'; }

  // ตรวจสอบว่า StoryboardAI โหลดแล้วหรือยัง
  if (!window.StoryboardAI || !window.StoryboardAI.generateStoryboard) {
    addCreatorLog('❌ StoryboardAI ไม่พร้อมใช้งาน — กรุณา Reload หน้า', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🎬 สร้าง Storyboard (AI คิดให้)'; }
    return;
  }

  // ดึง provider ก่อน try/catch เพื่อให้ error message แสดงชื่อ provider ที่ถูกต้อง
  const config = window.StoryboardAI?.getOpenAIConfig?.();
  const providerName = config?.provider === 'openai' ? 'OpenAI' : config?.provider === 'openrouter' ? 'OpenRouter' : 'API';

  try {
    addCreatorLog('🎬 เริ่มสร้าง Storyboard...', 'step');

    // Debug: แสดง provider ที่ใช้
    if (config) {
      addCreatorLog(`🔑 ใช้ ${providerName} (${config.model})`, 'info');
    }

    addCreatorLog('ℹ️ กำลังเรียก AI...', 'info');

    // สร้าง sceneConfigs จาก characters (per-scene gender/character/product)
    const sceneConfigs = characters.map((c, idx) => {
      const si = idx + 1;
      const pPreview = document.getElementById(`storyProduct${si}Preview`);
      // อ่านชื่อ + highlights จาก select dropdown ก่อน → ถ้าเป็น custom ค่อยอ่านจาก input
      const pSelect = document.getElementById(`storyProduct${si}Select`);
      let pName = '';
      let pHighlights = '';
      if (pSelect && pSelect.value && pSelect.value !== '' && pSelect.value !== 'custom') {
        const pIdx = parseInt(pSelect.value);
        const cachedP = (typeof _cachedProducts !== 'undefined' && _cachedProducts) ? _cachedProducts[pIdx] : null;
        pName = cachedP?.name || pSelect.options[pSelect.selectedIndex]?.textContent?.trim() || '';
        pHighlights = cachedP?.highlights || '';
      }
      if (!pName) {
        pName = document.getElementById(`storyProduct${si}Name`)?.value?.trim() || '';
      }
      const pHasImage = pPreview?.src && pPreview.style.display !== 'none';
      return {
        charName: c.name,
        charDesc: c.desc,
        charImage: c.image,
        voiceGender: c.gender || (Math.random() < 0.5 ? 'female' : 'male'),
        product: pName || null,
        productHighlights: pHighlights || null,
        productImage: pHasImage ? pPreview.src : null
      };
    });

    // ถ้า "ใช้สินค้าเดียวกันทุกฉาก" เปิดอยู่ → copy product info จากฉาก 1 ไปทุกฉาก
    // (DOM ฉาก 2+ ถูกลบเมื่อ sameCharToggle เปิด ทำให้ map() อ่านไม่ได้)
    if (window._sameProductToggleOn && sceneConfigs.length > 0 && sceneConfigs[0]) {
      const baseProd = sceneConfigs[0];
      for (let j = 1; j < sceneConfigs.length; j++) {
        if (!sceneConfigs[j].product) sceneConfigs[j].product = baseProd.product;
        if (!sceneConfigs[j].productHighlights) sceneConfigs[j].productHighlights = baseProd.productHighlights;
        if (!sceneConfigs[j].productImage) sceneConfigs[j].productImage = baseProd.productImage;
      }
    }

    // Pad sceneConfigs ให้ครบ sceneCount (กรณีใช้สินค้า/ตัวละครเดียวกันทุกฉาก)
    while (sceneConfigs.length < sceneCount) {
      // Copy product info จากฉาก 1 ไปฉากที่เหลือ
      const base = sceneConfigs[0] || {};
      const si = sceneConfigs.length + 1;
      const pPreview = document.getElementById(`storyProduct${si}Preview`);
      const pSelect = document.getElementById(`storyProduct${si}Select`);
      let pName = '';
      let pHighlights = '';
      if (pSelect && pSelect.value && pSelect.value !== '' && pSelect.value !== 'custom') {
        const pIdx = parseInt(pSelect.value);
        const cachedP = (typeof _cachedProducts !== 'undefined' && _cachedProducts) ? _cachedProducts[pIdx] : null;
        pName = cachedP?.name || pSelect.options[pSelect.selectedIndex]?.textContent?.trim() || '';
        pHighlights = cachedP?.highlights || '';
      }
      if (!pName) pName = document.getElementById(`storyProduct${si}Name`)?.value?.trim() || '';
      const pHasImage = pPreview?.src && pPreview.style.display !== 'none';
      sceneConfigs.push({
        charName: base.charName || '',
        charDesc: base.charDesc || '',
        charImage: base.charImage || null,
        voiceGender: base.voiceGender || 'female',
        product: pName || base.product || null,
        productHighlights: pHighlights || base.productHighlights || null,
        productImage: pHasImage ? pPreview.src : (base.productImage || null)
      });
    }

    const storyboard = await window.StoryboardAI.generateStoryboard({
      topic, details, style, mood, targetAudience,
      sceneCount, aspectRatio, voiceGender, language,
      isRealisticMode, hasCharacters, characters, product,
      noTextOverlay, coverText, sceneConfigs
    });

    // Store result
    storyState.scenes = storyboard.scenes || [];
    storyState.config = {
      ...storyState.config,
      topic, details, style, mood, targetAudience,
      sceneCount, aspectRatio, voiceGender, language,
      isRealisticMode, hasCharacters, characters, product,
      noTextOverlay, coverText, sceneConfigs, storyboard
    };

    // Show preview
    showStoryboardPreview(storyboard);

    addCreatorLog(`✅ สร้าง Storyboard สำเร็จ: ${storyboard.title} (${storyboard.scenes?.length} ฉาก)`, 'success');
  } catch (err) {
    console.error('[StoryMode] generateStoryboard error:', err);
    addCreatorLog('❌ สร้าง Storyboard ล้มเหลว: ' + err.message, 'error');

    // แสดง error จริงจาก API
    const rawError = err.message || 'ไม่ทราบสาเหตุ';
    const lowerError = rawError.toLowerCase();

    let errorMsg = rawError;
    let errorTitle = 'สร้าง Storyboard ล้มเหลว';

    // แปลง error ให้เข้าใจง่าย (แต่ยังแสดง error จริงด้วย)
    if (lowerError.includes('api_key') || lowerError.includes('api key') || lowerError.includes('invalid key')) {
      errorTitle = 'API Key ไม่ถูกต้อง';
      errorMsg = `กรุณาตรวจสอบ ${providerName} API Key ใน Settings<br><br><span style="font-size:10px;color:#aaa;">Error: ${rawError}</span>`;
    } else if (lowerError.includes('fetch') || lowerError.includes('network') || lowerError.includes('failed to fetch')) {
      errorTitle = 'เชื่อมต่อไม่ได้';
      errorMsg = `ไม่สามารถเชื่อมต่อ ${providerName} API<br><br><span style="font-size:10px;color:#aaa;">Error: ${rawError}</span>`;
    } else if (lowerError.includes('quota') || lowerError.includes('limit') || lowerError.includes('429')) {
      errorTitle = 'เกิน Quota';
      errorMsg = `เกิน Quota ของ ${providerName} API<br>กรุณารอสักครู่แล้วลองใหม่<br><br><span style="font-size:10px;color:#aaa;">Error: ${rawError}</span>`;
    } else if (lowerError.includes('permission') || lowerError.includes('403')) {
      errorTitle = 'ไม่มีสิทธิ์';
      errorMsg = `${providerName} API Key ไม่มีสิทธิ์ใช้งาน<br>ลองสร้าง Key ใหม่<br><br><span style="font-size:10px;color:#aaa;">Error: ${rawError}</span>`;
    }

    addCreatorLog(`❌ ${errorTitle}: ${errorMsg.replace(/<[^>]*>/g, '')}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🎬 สร้าง Storyboard (AI คิดให้)'; }
  }
}

// ============================================================
// SHOW STORYBOARD PREVIEW
// ============================================================

function showStoryboardPreview(storyboard) {
  const section = document.getElementById('storyboardPreviewSection');
  const content = document.getElementById('storyboardPreviewContent');
  if (!section || !content) return;

  let html = '';

  // Product Analysis (ถ้ามี)
  if (storyboard.productAnalysis) {
    const pa = storyboard.productAnalysis;
    html += `<div style="margin-bottom: 10px; padding: 8px; background: rgba(76, 175, 80, 0.2); border-radius: 6px;">
      <strong>📊 วิเคราะห์สินค้า:</strong><br>
      วัสดุ: ${pa.material || '-'}<br>
      รูปร่าง: ${pa.shape || '-'}<br>
      สี: ${pa.colors?.join(', ') || '-'}
    </div>`;
  }

  // Characters
  if (storyboard.characters && storyboard.characters.length > 0) {
    html += `<div style="margin-bottom: 10px; padding: 8px; background: rgba(124, 77, 255, 0.2); border-radius: 6px;">
      <strong>👥 ตัวละคร:</strong><br>`;
    storyboard.characters.forEach(c => {
      html += `${c.name}: ${c.appearance}<br>`;
    });
    html += `</div>`;
  }

  // Scenes
  (storyboard.scenes || []).forEach((scene, i) => {
    const typeEmoji = scene.type === 'hook' ? '🎯' : scene.type === 'cta' ? '📢' : '🎬';
    html += `<div style="margin-bottom: 12px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; border-left: 3px solid ${scene.type === 'hook' ? '#ff5722' : scene.type === 'cta' ? '#4caf50' : '#2196f3'};">
      <div style="font-weight: bold; margin-bottom: 4px;">${typeEmoji} ฉากที่ ${scene.sceneNumber}: ${scene.title || ''}</div>
      <div style="font-size: 11px; color: #aaa; margin-bottom: 4px;">${scene.description || ''}</div>
      <div style="font-size: 10px; color: #888;">📷 ${(scene.imagePrompt || scene.photoPrompt || '').substring(0, 80)}...</div>
      <div style="font-size: 10px; color: #888;">🎬 ${(scene.videoPrompt || '').substring(0, 80)}...</div>
      <div style="font-size: 11px; color: #4fc3f7; margin-top: 4px;">🗣️ ${scene.scriptTH || scene.voiceover || ''}</div>
    </div>`;
  });

  content.innerHTML = html;
  // Storyboard Preview ถูกซ่อน — ไม่ต้อง display block

  // Show Script & Voice section
  showScriptVoiceSection(storyboard.scenes || []);
}

// ============================================================
// SCRIPT & VOICE PREVIEW
// ============================================================

/**
 * Toggle edit mode สำหรับ script card — สลับระหว่าง display กับ textarea
 */
function toggleScriptEditMode(card, contentContainer, varIdx, scenes, hasVariations) {
  const isEditing = card.dataset.editing === 'true';

  if (!isEditing) {
    // === เข้า Edit mode ===
    card.dataset.editing = 'true';
    const editBtn = card.querySelector('.script-edit-btn');
    editBtn.textContent = '💾 บันทึก';
    editBtn.style.borderColor = '#FFB300';
    editBtn.style.color = '#FFB300';

    // สร้าง Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'script-cancel-btn';
    cancelBtn.textContent = '✕';
    cancelBtn.title = 'ยกเลิก';
    cancelBtn.style.cssText = `
      background: none; border: 1px solid #555; border-radius: 4px; color: #aaa;
      cursor: pointer; padding: 2px 8px; font-size: 11px; margin-left: 4px;
    `;
    cancelBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      // Revert — ออกจาก edit mode โดยไม่บันทึก
      exitScriptEditMode(card, contentContainer, varIdx, scenes, hasVariations, false);
    });
    editBtn.parentElement.appendChild(cancelBtn);

    // แปลง display → textarea
    const sceneDivs = contentContainer.querySelectorAll('.script-scene-display');
    sceneDivs.forEach((div) => {
      const si = parseInt(div.dataset.sceneIndex);
      const scene = scenes[si];
      if (!scene) return;

      let text;
      if (hasVariations && scene.scriptVariations && scene.scriptVariations[varIdx]) {
        text = scene.scriptVariations[varIdx];
      } else {
        text = scene.scriptTH || scene.voiceover || '';
      }
      text = text.replace(/^แบบที่\s*\d+\s*[:：]\s*/i, '');

      const charLabel = scene.characterName || ('ฉาก ' + (si + 1));
      div.innerHTML = `
        <div style="font-size: 10px; color: #888; margin-bottom: 2px;">${charLabel}:</div>
        <textarea class="script-edit-textarea" data-scene-index="${si}" style="
          width: 100%; min-height: 60px; padding: 6px 8px; font-size: 12px;
          color: #d4d4d4; background: #111; border: 1px solid #555; border-radius: 4px;
          resize: vertical; line-height: 1.5; font-family: inherit;
        ">${text}</textarea>
      `;
    });
  } else {
    // === กดบันทึก ===
    exitScriptEditMode(card, contentContainer, varIdx, scenes, hasVariations, true);
  }
}

/**
 * ออกจาก edit mode — save=true จะบันทึกค่าจาก textarea กลับไปที่ scenes
 */
function exitScriptEditMode(card, contentContainer, varIdx, scenes, hasVariations, save) {
  if (save) {
    // บันทึกค่าจาก textarea กลับไปที่ scenes
    const textareas = contentContainer.querySelectorAll('.script-edit-textarea');
    textareas.forEach((ta) => {
      const si = parseInt(ta.dataset.sceneIndex);
      const scene = scenes[si];
      if (!scene) return;
      const newText = ta.value.trim();
      if (hasVariations && scene.scriptVariations) {
        scene.scriptVariations[varIdx] = newText;
      } else {
        scene.scriptTH = newText;
        scene.voiceover = newText;
      }
    });
    console.log(`[Script] Saved edits for variation ${varIdx + 1}`);
  }

  // Reset UI กลับ display mode
  card.dataset.editing = 'false';
  const editBtn = card.querySelector('.script-edit-btn');
  editBtn.textContent = '✏️ แก้ไข';
  editBtn.style.borderColor = '#555';
  editBtn.style.color = '#aaa';

  // Remove cancel button
  const cancelBtn = card.querySelector('.script-cancel-btn');
  if (cancelBtn) cancelBtn.remove();

  // แปลง textarea → display text
  const sceneDivs = contentContainer.querySelectorAll('.script-scene-display');
  sceneDivs.forEach((div) => {
    const si = parseInt(div.dataset.sceneIndex);
    const scene = scenes[si];
    if (!scene) return;

    let text;
    if (hasVariations && scene.scriptVariations && scene.scriptVariations[varIdx]) {
      text = scene.scriptVariations[varIdx];
    } else {
      text = scene.scriptTH || scene.voiceover || '';
    }
    text = text.replace(/^แบบที่\s*\d+\s*[:：]\s*/i, '');

    const charLabel = scene.characterName || ('ฉาก ' + (si + 1));
    div.innerHTML = `
      <span style="font-size: 10px; color: #888;">${charLabel}:</span>
      <span class="script-text-display" style="font-size: 12px; color: #d4d4d4; line-height: 1.5;">${text}</span>
    `;
  });
}

/**
 * แสดง 4 script variations ให้เลือก
 * AI สร้าง scriptVariations[] 4 แบบต่อฉาก — แสดงเป็น 4 cards ให้ user เลือก 1 แบบ
 * @param {Array} scenes - array ของ scenes จาก storyboard
 */
function showScriptVoiceSection(scenes) {
  const section = document.getElementById('scriptVoiceSection');
  const listContainer = document.getElementById('scriptSelectionList');
  if (!section || !listContainer || !scenes || scenes.length === 0) return;

  listContainer.innerHTML = '';
  storyState.scenes = scenes;
  storyState.selectedVariationIndex = 0;

  // บังคับ 4 cards เสมอ — ถ้า AI ไม่ส่ง scriptVariations มาก็ใช้ scriptTH เป็น fallback
  const hasVariations = scenes.some(s => s.scriptVariations && s.scriptVariations.length > 0);
  const variationCount = 4;
  console.log('[Script] hasVariations:', hasVariations, '| scenes[0].scriptVariations:', scenes[0]?.scriptVariations);

  for (let v = 0; v < variationCount; v++) {
    const card = document.createElement('div');
    card.className = 'script-card';
    card.dataset.index = v;
    card.style.cssText = `
      padding: 12px;
      background: #2a2a2a;
      border: 2px solid ${v === 0 ? '#FFB300' : '#333'};
      border-radius: 8px;
      cursor: pointer;
      transition: border-color 0.2s;
    `;

    // Header with radio + edit button
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
    header.innerHTML = `
      <input type="radio" name="scriptSelection" value="${v}" ${v === 0 ? 'checked' : ''} style="accent-color: #FFB300;">
      <span style="font-size: 13px; font-weight: bold; color: #ffc107; flex: 1;">Script ${v + 1}</span>
      <button class="script-edit-btn" data-variation="${v}" title="แก้ไข Script" style="
        background: none; border: 1px solid #555; border-radius: 4px; color: #aaa;
        cursor: pointer; padding: 2px 8px; font-size: 11px; transition: all 0.2s;
      ">✏️ แก้ไข</button>
    `;

    card.appendChild(header);

    // Content container สำหรับ display/edit mode
    const contentContainer = document.createElement('div');
    contentContainer.className = 'script-content-container';
    contentContainer.dataset.variation = v;

    // แสดง script ทุกฉากของ variation นี้
    scenes.forEach((scene, si) => {
      let text;
      if (hasVariations && scene.scriptVariations && scene.scriptVariations[v] !== undefined) {
        text = scene.scriptVariations[v] || '';
      } else {
        text = scene.scriptTH || scene.voiceover || '';
      }
      // ถ้าบทว่าง (AI ไม่ส่งมา) แสดงข้อความแจ้ง
      if (!text) {
        text = '⚠️ AI ไม่ได้สร้างบทนี้';
      }

      // ลบ "แบบที่ X:" prefix ออก
      text = text.replace(/^แบบที่\s*\d+\s*[:：]\s*/i, '');

      // ใช้ชื่อตัวละครแทน "ฉาก X"
      const charLabel = scene.characterName || ('ฉาก ' + (si + 1));

      const sceneDiv = document.createElement('div');
      sceneDiv.style.cssText = 'margin-bottom: 6px;';
      sceneDiv.className = 'script-scene-display';
      sceneDiv.dataset.sceneIndex = si;
      sceneDiv.innerHTML = `
        <span style="font-size: 10px; color: #888;">${charLabel}:</span>
        <span class="script-text-display" style="font-size: 12px; color: #d4d4d4; line-height: 1.5;">${text}</span>
      `;
      contentContainer.appendChild(sceneDiv);
    });

    card.appendChild(contentContainer);

    // Edit button handler
    const editBtn = header.querySelector('.script-edit-btn');
    editBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      const varIdx = parseInt(this.dataset.variation);
      toggleScriptEditMode(card, contentContainer, varIdx, scenes, hasVariations);
    });

    // Click handler
    card.addEventListener('click', function() {
      const idx = parseInt(this.dataset.index);
      storyState.selectedVariationIndex = idx;
      // Update radio
      listContainer.querySelectorAll('input[name="scriptSelection"]').forEach((r, i) => { r.checked = i === idx; });
      // Update border
      listContainer.querySelectorAll('.script-card').forEach((c, i) => {
        c.style.borderColor = i === idx ? '#FFB300' : '#333';
      });
    });

    listContainer.appendChild(card);
  }

  section.style.display = 'block';
}

// Old createScriptCard and selectScriptCard removed - using new per-scene variations UI

/**
 * อัพเดท TTS preview text
 */
function updateTtsPreview(index) {
  const ttsText = document.getElementById('ttsPreviewText');
  if (!ttsText) return;

  const variation = storyState.scriptVariations?.[index];
  if (!variation) return;

  // Combine all script text
  let combinedText = '';
  [...variation.hook, ...variation.content, ...variation.cta].forEach(scene => {
    const text = scene.scriptTH || scene.voiceover || '';
    if (text) combinedText += text + ' ';
  });

  ttsText.textContent = combinedText.trim();
}

/**
 * เลือก scene card
 */
function selectSceneCard(index) {
  storyState.selectedSceneIndex = index;

  // Update radio buttons
  const radios = document.querySelectorAll('input[name="scriptSelection"]');
  radios.forEach((radio, i) => {
    radio.checked = (i === index);
  });

  // Update card borders
  const cards = document.querySelectorAll('.script-card');
  cards.forEach((card, i) => {
    const isSelected = i === index;
    const currentBorderLeft = card.style.borderLeftColor;
    card.style.borderColor = isSelected ? '#FFB300' : '#333';
    card.style.borderLeftColor = currentBorderLeft; // Preserve left border color
  });

  // If voice already generated, show audio player
  if (storyState.generatedVoices[index]) {
    showAudioPlayer(index);
  }
}

/**
 * Generate voice สำหรับ script ที่เลือก (รวมทุก scene เป็นคลิปเดียว)
 */
async function generateVoiceForSelectedScene() {
  // ===== ใช้ script variation ที่เลือก =====
  const variationIndex = storyState.selectedVariationIndex || 0;
  const scenes = storyState.scenes;
  if (!scenes || scenes.length === 0) return;

  // Apply selected variation to scenes (override scriptTH)
  scenes.forEach(scene => {
    if (scene.scriptVariations && scene.scriptVariations[variationIndex]) {
      scene._selectedScript = scene.scriptVariations[variationIndex];
    } else {
      scene._selectedScript = scene.scriptTH || scene.voiceover || '';
    }
  });

  if (!scenes || scenes.length === 0) return;

  // Get Gemini API Key
  const geminiApiKey = parseStoredKey('geminiApiKey');
  if (!geminiApiKey) {
    await showStoryAlert('กรุณาใส่ <b>Gemini API Key</b> ที่ Settings ก่อน<br><br>ใช้สำหรับสร้างเสียง TTS', 'warning', 'ต้องการ API Key');
    return;
  }

  // Get speaking style (for special voice treatment like viral_roast)
  const speakingStyle = document.getElementById('storyMood')?.value || '';

  // Show TTS preview section with combined text
  const ttsSection = document.getElementById('ttsPreviewSection');
  const ttsText = document.getElementById('ttsPreviewText');
  if (ttsSection && ttsText) {
    // Combine all script text (ใช้ variation ที่เลือก)
    let combinedText = '';
    scenes.forEach(scene => {
      const text = scene._selectedScript || scene.scriptTH || scene.voiceover || '';
      if (text) combinedText += text + ' ';
    });
    ttsText.textContent = combinedText.trim();
    ttsSection.style.display = 'block';
  }

  // Show loading
  const btn = document.getElementById('generateVoiceBtn');
  const btnText = document.getElementById('generateVoiceBtnText');
  const statusEl = document.getElementById('voiceGenStatus');

  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'กำลังสร้างเสียง...';
  if (statusEl) {
    statusEl.style.display = 'block';
  }

  try {
    addCreatorLog(`🎙️ สร้างเสียง Script ${variationIndex + 1} (${scenes.length} ฉาก)...`, 'info');

    // Call Gemini TTS from storyboard-ai.js
    if (!window.StoryboardAI?.generateSpeech) {
      throw new Error('StoryboardAI.generateSpeech ไม่พร้อมใช้งาน');
    }

    // Initial delay to avoid rate limit from previous API calls
    if (statusEl) {
      statusEl.textContent = `เตรียมสร้างเสียง...`;
    }
    await new Promise(r => setTimeout(r, 2000)); // 2 sec initial delay

    // Generate voice for each scene
    const audioBlobs = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const scriptText = scene._selectedScript || scene.scriptTH || scene.voiceover || '';

      if (!scriptText) {
        addCreatorLog(`⚠️ ไม่มีบทพูด - ข้าม`, 'warning', i + 1);
        continue;
      }

      if (statusEl) {
        statusEl.textContent = `กำลังสร้างเสียงฉากที่ ${i + 1}/${scenes.length}...`;
      }

      // อ่าน voiceGender จาก sceneConfigs ของฉากนั้นๆ
      const sceneConfig = storyState.config?.sceneConfigs?.[i];
      const sceneGender = sceneConfig?.voiceGender || 'female';
      const voiceType = sceneGender === 'male' ? 'male-adult' : 'female-adult';

      addCreatorLog(`🎙️ สร้างเสียง (${sceneGender === 'male' ? '👨 ชาย' : '👩 หญิง'})...`, 'info', i + 1);

      // Add delay between requests to avoid rate limits (free tier: 10 req/min)
      if (i > 0) {
        if (statusEl) {
          statusEl.textContent = `รอ 7 วินาที ก่อนฉากที่ ${i + 1}...`;
        }
        await new Promise(r => setTimeout(r, 7000)); // 7 sec delay = ~8 req/min
      }

      let result = await window.StoryboardAI.generateSpeech({
        text: scriptText,
        voiceType: voiceType,
        apiKey: geminiApiKey,
        maxRetries: 3,
        speakingStyle: speakingStyle
      });

      if (!result.success) {
        // Check if it's a rate limit error - wait and retry
        if (result.error?.includes('quota') || result.error?.includes('rate') || result.error?.includes('429') || result.error?.includes('RESOURCE_EXHAUSTED')) {
          addCreatorLog(`⏳ ติด rate limit - รอ 15 วิแล้วลองใหม่...`, 'warning', i + 1);
          if (statusEl) {
            statusEl.textContent = `รอ 15 วินาที (rate limit)...`;
          }
          await new Promise(r => setTimeout(r, 15000)); // Wait 15 seconds

          // Retry once
          addCreatorLog(`🔄 ลองใหม่...`, 'info', i + 1);
          if (statusEl) {
            statusEl.textContent = `ลองใหม่ฉากที่ ${i + 1}/${scenes.length}...`;
          }
          result = await window.StoryboardAI.generateSpeech({
            text: scriptText,
            voiceType: voiceType,
            apiKey: geminiApiKey,
            maxRetries: 3,
            speakingStyle: speakingStyle
          });

          if (!result.success) {
            addCreatorLog(`❌ ล้มเหลวหลัง retry: ${result.error}`, 'error', i + 1);
            continue;
          }
        } else {
          addCreatorLog(`⚠️ ล้มเหลว: ${result.error}`, 'warning', i + 1);
          continue;
        }
      }

      // Fetch blob from URL
      const response = await fetch(result.audioUrl);
      const blob = await response.blob();
      audioBlobs.push(blob);

      // Show status on card
      const voiceStatus = document.getElementById(`voiceStatus_${i}`);
      if (voiceStatus) voiceStatus.style.display = 'block';

      // Store individual result
      storyState.generatedVoices[i] = {
        audioUrl: result.audioUrl,
        text: scriptText
      };
    }

    if (audioBlobs.length === 0) {
      throw new Error('ไม่สามารถสร้างเสียงได้เลย');
    }

    // Combine all audio blobs into one using Web Audio API
    if (statusEl) {
      statusEl.textContent = `กำลังรวมเสียง ${audioBlobs.length} ฉาก...`;
    }

    const combinedBlob = await concatenateAudioBlobs(audioBlobs);
    const combinedUrl = URL.createObjectURL(combinedBlob);

    // Store combined audio
    storyState.combinedVoiceUrl = combinedUrl;

    // Show audio player with combined audio
    showCombinedAudioPlayer(combinedUrl, audioBlobs.length);

    addCreatorLog(`✅ สร้างเสียงสำเร็จ! รวม ${audioBlobs.length} ฉาก`, 'success');

  } catch (err) {
    console.error('[StoryMode] Voice generation error:', err);
    addCreatorLog(`❌ สร้างเสียงล้มเหลว: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Generate Voice';
    if (statusEl) statusEl.style.display = 'none';
  }
}

/**
 * แสดง audio player สำหรับเสียงที่รวมแล้ว
 */
function showCombinedAudioPlayer(audioUrl, sceneCount) {
  const audioSection = document.getElementById('audioPlayerSection');
  const audioPlayer = document.getElementById('voiceAudioPlayer');
  const actionButtons = document.getElementById('voiceActionButtons');

  if (!audioSection || !audioPlayer) return;

  // Set audio source
  audioPlayer.src = audioUrl;

  // Show player
  audioSection.style.display = 'block';

  // Show action buttons
  if (actionButtons) actionButtons.style.display = 'flex';
}

/**
 * ดาวน์โหลดเสียงที่สร้างแล้ว
 */
function downloadVoice() {
  const audioUrl = storyState.combinedVoiceUrl;
  if (!audioUrl) {
    showStoryAlert('ยังไม่มีเสียง กรุณากด Generate Voice ก่อน', 'warning', 'ไม่มีเสียง');
    return;
  }

  // Create download link
  const link = document.createElement('a');
  link.href = audioUrl;
  link.download = `voice_${Date.now()}.wav`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  addCreatorLog('⬇️ ดาวน์โหลดเสียงแล้ว', 'success');
}

/**
 * สร้างเสียงใหม่
 */
async function regenerateVoice() {
  // Clear old voice
  storyState.combinedVoiceUrl = null;
  storyState.generatedVoices = {};

  // Hide player and buttons
  const audioSection = document.getElementById('audioPlayerSection');
  const actionButtons = document.getElementById('voiceActionButtons');
  if (audioSection) audioSection.style.display = 'none';
  if (actionButtons) actionButtons.style.display = 'none';

  // Generate again
  await generateVoiceForSelectedScene();
}

/**
 * แสดง audio player สำหรับ scene
 */
function showAudioPlayer(index) {
  const audioSection = document.getElementById('audioPlayerSection');
  const audioPlayer = document.getElementById('voiceAudioPlayer');
  const labelEl = document.getElementById('currentSceneLabel');

  if (!audioSection || !audioPlayer) return;

  const voiceData = storyState.generatedVoices[index];
  if (!voiceData) {
    audioSection.style.display = 'none';
    return;
  }

  // Set audio source
  audioPlayer.src = voiceData.audioUrl;

  // Update label
  if (labelEl) {
    const scene = storyState.scenes[index];
    labelEl.textContent = `ฉากที่ ${index + 1}: ${scene?.title || ''}`;
  }

  // Show player
  audioSection.style.display = 'block';
}

/**
 * Navigate to previous/next scene
 */
function navigateScene(direction) {
  const totalScenes = storyState.scenes?.length || 0;
  if (totalScenes === 0) return;

  let newIndex = storyState.selectedSceneIndex + direction;
  if (newIndex < 0) newIndex = totalScenes - 1;
  if (newIndex >= totalScenes) newIndex = 0;

  selectSceneCard(newIndex);

  // If voice exists, show player
  if (storyState.generatedVoices[newIndex]) {
    showAudioPlayer(newIndex);
  } else {
    const audioSection = document.getElementById('audioPlayerSection');
    if (audioSection) audioSection.style.display = 'none';
  }
}

/**
 * Parse stored key from localStorage (handle JSON strings)
 */
function parseStoredKey(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return '';
  try {
    return JSON.parse(raw) || '';
  } catch {
    return raw;
  }
}

// ============================================================
// MAIN PIPELINE: startStoryModeFlow
// ============================================================

/**
 * เริ่ม pipeline ทั้งหมด
 * Step 1: สร้างรูปทุกฉาก (9-step flow ผ่าน background.js)
 * Step 2: สร้างคลิปทีละฉาก (9-step flow ผ่าน background.js)
 * Step 3: Export + Download (FFmpeg)
 * Step 4: Post TikTok (ถ้าเลือก auto)
 */
async function startStoryModeFlow() {
  // Guard: ป้องกัน pipeline รันซ้อน
  if (storyState.isRunning) {
    console.warn('[Story] Pipeline is already running - ignoring duplicate call');
    return;
  }

  if (!storyState.scenes || storyState.scenes.length === 0) {
    addCreatorLog('❌ ยังไม่มี Storyboard - กรุณากดสร้างก่อน', 'error');
    return;
  }

  storyState.isRunning = true;

  // Reset log counter for new pipeline run
  resetLogCounter();

  // Apply selected script variation ก่อนเริ่ม flow
  // รอบแรก (loopIndex === 0): ใช้ Script ที่ผู้ใช้เลือก
  // รอบถัดไป (loopIndex > 0): สุ่ม Script ให้อัตโนมัติ
  let vi = storyState.selectedVariationIndex || 0;
  if (storyState.loopEnabled && storyState.loopIndex > 0) {
    const maxVariations = storyState.scenes[0]?.scriptVariations?.length || 4;
    vi = Math.floor(Math.random() * maxVariations);
    storyState.selectedVariationIndex = vi;
    addCreatorLog(`🎲 สุ่ม Script ${vi + 1} (Loop รอบ ${storyState.loopIndex + 1})`, 'info');
  }
  storyState.scenes.forEach(scene => {
    if (scene.scriptVariations && scene.scriptVariations[vi]) {
      scene.scriptTH = scene.scriptVariations[vi];
    }
  });
  addCreatorLog(`📝 ใช้ Script ${vi + 1}`, 'info');

  storyState.stopped = false;
  chrome.storage.local.remove('story_stop_requested');

  // Resume mode → นับจากฉากที่ทำเสร็จแล้ว ไม่ reset เป็น 0
  if (storyState.resumeMode) {
    storyState.imagesCompleted = storyState.scenes.filter(s => s.imageCreated).length;
    storyState.videosCompleted = storyState.scenes.filter(s => s.videoCreated).length;
  } else {
    storyState.imagesCompleted = 0;
    storyState.videosCompleted = 0;
  }

  // Show loop progress (เริ่มรอบแรก)
  if (storyState.loopEnabled && storyState.loopIndex === 0) {
    updateLoopProgress(1, storyState.loopCount);
  }

  // Notify parent React wrapper that flow is running
  window.parent.postMessage({ type: 'STORY_STATUS', running: true }, '*');

  // Show progress
  const progressSection = document.getElementById('storyProgressSection');
  if (progressSection) progressSection.style.display = 'block';

  // Resume mode + มี Project URL เดิม → กลับไปที่ project เดิมเลย ไม่ต้องสร้างใหม่
  const canResumeToOldProject = storyState.resumeMode && storyState.flowProjectUrl && storyState.flowTabId;

  if (canResumeToOldProject) {
    addCreatorLog('🔄 กลับไป Project เดิม...', 'info');
    try {
      // เช็คว่า tab เดิมยังอยู่มั้ย
      let tabExists = false;
      try {
        const tab = await new Promise((resolve) => {
          chrome.tabs.get(storyState.flowTabId, (t) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(t);
          });
        });
        tabExists = !!tab;
      } catch (e) {}

      if (tabExists) {
        await new Promise((resolve) => {
          chrome.tabs.update(storyState.flowTabId, { url: storyState.flowProjectUrl }, resolve);
        });
      } else {
        const currentTab = await new Promise((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs && tabs[0] ? tabs[0] : null);
          });
        });
        if (!currentTab) {
          addCreatorLog('❌ หา tab ไม่เจอ', 'error');
          storyState.isRunning = false;
          return;
        }
        await new Promise((resolve) => {
          chrome.tabs.update(currentTab.id, { url: storyState.flowProjectUrl }, resolve);
        });
        storyState.flowTabId = currentTab.id;
      }

      addCreatorLog('⏳ รอหน้า Project โหลด...', 'info');
      await delay(6000);
      const tabReady = await new Promise((resolve) => {
        chrome.tabs.get(storyState.flowTabId, (tab) => {
          resolve(tab && tab.status === 'complete');
        });
      });
      if (!tabReady) {
        await delay(4000);
      }
      addCreatorLog('✅ กลับมาที่ Project เดิมแล้ว', 'success');
    } catch (err) {
      addCreatorLog('⚠️ กลับ Project เดิมไม่ได้ — สร้างใหม่แทน: ' + err.message, 'warning');
      storyState.flowProjectUrl = null;
    }
  }

  if (!canResumeToOldProject) {
    // Navigate tab ปัจจุบันไป Google Flow
    addCreatorLog('🌐 ไปหน้า Google Flow...', 'info');
    try {
      const currentTab = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          resolve(tabs && tabs[0] ? tabs[0] : null);
        });
      });
      if (!currentTab) {
        addCreatorLog('❌ หา tab ปัจจุบันไม่เจอ', 'error');
        storyState.isRunning = false;
        return;
      }
      await new Promise((resolve) => {
        chrome.tabs.update(currentTab.id, { url: 'https://labs.google/fx/tools/flow' }, resolve);
      });
      storyState.flowTabId = currentTab.id;
      addCreatorLog('⏳ รอหน้า Google Flow โหลด...', 'info');
      await delay(8000);
      const tabReady = await new Promise((resolve) => {
        chrome.tabs.get(storyState.flowTabId, (tab) => {
          resolve(tab && tab.status === 'complete');
        });
      });
      if (!tabReady) {
        addCreatorLog('⏳ รออีกนิด...', 'info');
        await delay(5000);
      }
      addCreatorLog('✅ เปิด Google Flow สำเร็จ', 'success');
    } catch (err) {
      addCreatorLog('❌ ไม่สามารถเปิดหน้า Google Flow: ' + err.message, 'error');
      storyState.isRunning = false;
      return;
    }
  }

  const scenes = storyState.scenes;
  const totalScenes = scenes.length;

  try {
    // ==============================
    // Step 0: NEW PROJECT (ข้ามถ้า Resume กลับ project เดิม)
    // ==============================
    if (!canResumeToOldProject) {
      addCreatorLog('📁 กด New Project...', 'step');
      updateStoryProgress('สร้างโปรเจ็คใหม่...', 0);

      try {
        const newProjResult = await sendToFlowTab('clickNewProject');
        if (newProjResult?.success) {
          addCreatorLog('✅ กด New Project แล้ว — รอหน้าโหลด...', 'success');
        } else {
          addCreatorLog('⚠️ หาปุ่ม New Project ไม่เจอ — ลองดำเนินการต่อ', 'warning');
        }
      } catch (newProjErr) {
        console.error('[Story v15.2] clickNewProject error:', newProjErr);
        addCreatorLog('⚠️ ไม่สามารถกด New Project — ลองดำเนินการต่อ', 'warning');
      }
    }

    // รอหน้า Project โหลดเสร็จ แล้วเก็บ URL (ไม่ต้องกด Images tab — 9-step flow จัดการเอง)
    await delay(3000);

    // เก็บ URL Project ปัจจุบัน (สำหรับ Resume กลับมาที่เดิม)
    if (!storyState.flowProjectUrl) {
      try {
        const tabInfo = await new Promise((resolve) => {
          chrome.tabs.get(storyState.flowTabId, resolve);
        });
        if (tabInfo?.url && tabInfo.url.includes('/project/')) {
          storyState.flowProjectUrl = tabInfo.url;
          addCreatorLog(`📌 บันทึก Project URL สำหรับ Resume`, 'info');
        }
      } catch (e) {}
    }

    if (storyState.stopped) { addCreatorLog('⏹️ หยุดโดยผู้ใช้', 'warning'); return; }

    // ==============================
    // Step 1: CREATE IMAGES
    // ==============================
    addCreatorLog('📷 Step 1: สร้างรูปทุกฉาก...', 'step');
    storyState.currentPhase = 'creating_images';

    // Clear old images (for loop) - ไม่ reset ถ้าอยู่ใน concatenateOnlyMode หรือ resumeMode
    if (storyState.loopIndex > 0) {
      if (storyState.concatenateOnlyMode) {
        // ถ้าอยู่ใน concatenateOnlyMode ไม่ต้อง reset - ใช้ของเดิม
        addCreatorLog('🔄 ใช้วิดีโอเดิมสำหรับต่อฉาก', 'info');
      } else if (storyState.resumeMode) {
        // ถ้าอยู่ใน resumeMode ไม่ต้อง reset - ใช้ของเดิมสำหรับฉากที่เสร็จแล้ว
        addCreatorLog('🔄 ใช้ข้อมูลเดิมสำหรับฉากที่เสร็จแล้ว', 'info');
      } else {
        // Reset ปกติสำหรับ Loop Mode
        console.log('[Story v14.5] Cleared old images for loop');
        for (const scene of scenes) {
          scene.imageUrl = null;
          scene.imageBase64 = null;
          scene.imageCreated = false;
          scene.videoCreated = false;
        }
      }
    }

    for (let i = 0; i < totalScenes; i++) {
      if (storyState.stopped) { addCreatorLog('⏹️ หยุดโดยผู้ใช้', 'warning'); return; }

      const scene = scenes[i];
      const sceneNum = i + 1;

      // Skip logic: ถ้าอยู่ใน Resume mode และฉากนี้มีรูปแล้ว ให้ข้าม
      if (storyState.resumeMode && scene.imageCreated && scene.imageUrl) {
        addCreatorLog(`⏭️ ฉาก ${sceneNum} มีรูปแล้ว - ข้าม`, 'info');
        continue;
      }

      const percent = Math.round((i / totalScenes) * 50); // Phase 1 = 0-50%

      addCreatorLog(`📷 สร้างรูป...`, 'info', sceneNum);
      updateStoryProgress(`สร้างรูปฉากที่ ${sceneNum}/${totalScenes}...`, percent);

      // Build reference images — ใช้ sceneConfigs ของฉากปัจจุบัน (per-scene character + product)
      const referenceImages = [];
      const scCfg = storyState.config.sceneConfigs?.[i];
      // Per-scene character image
      if (scCfg?.charImage) {
        referenceImages.push({ type: 'character', name: scCfg.charName || 'ตัวละคร', base64: scCfg.charImage });
      } else if (storyState.config.characters?.[i]?.image) {
        // Fallback: ดึงจาก characters array ตาม index
        const c = storyState.config.characters[i];
        referenceImages.push({ type: 'character', name: c.name, base64: c.image });
      }
      // Per-scene product image
      if (scCfg?.productImage) {
        referenceImages.push({ type: 'product', name: scCfg.product || 'สินค้า', base64: scCfg.productImage });
      }
      console.log(`[Story] Scene ${sceneNum} referenceImages: ${referenceImages.length} (char=${!!scCfg?.charImage}, prod=${!!scCfg?.productImage})`);
      if (referenceImages.length > 0) {
        addCreatorLog(`📎 ฉาก ${sceneNum}: ${referenceImages.map(r => r.name).join(', ')}`, 'info', sceneNum);
      }

      // เพิ่ม Aspect Ratio ลงใน Image Prompt เพื่อให้ภาพเต็มจอ ไม่ถูกตัด
      const rawImagePrompt = scene.imagePrompt || scene.photoPrompt;
      const arSuffix = (storyState.config.aspectRatio === '16:9')
        ? ', 16:9 wide landscape format, full scene visible, nothing cropped'
        : ', 9:16 tall portrait format, full body visible from head to toe, character centered in frame, nothing cropped at top or bottom';
      // เพิ่มคำสั่งเรื่องสินค้า (ถ้าฉากนี้มีสินค้า + รูปสินค้า)
      const hasCharInScene = !!(scCfg?.charName || scCfg?.charImage);
      const productSuffix = (scCfg?.product && scCfg?.productImage)
        ? (hasCharInScene
          ? `, character holding the product "${scCfg.product}" prominently in hand, the product must appear exactly as the uploaded ingredient photo — same packaging, same label, same colors, do not alter or reimagine the product`
          : `, the product "${scCfg.product}" IS the character — it is a living animated version of the product with cute cartoon eyes, mouth, arms, and legs (like Pixar style). The character must be clearly recognizable as the actual product "${scCfg.product}". Product appearance must match the uploaded ingredient photo — same shape, same colors, same packaging, do not alter or reimagine the product`)
        : '';
      const noTextSuffix = '. IMPORTANT: Do NOT render any text, titles, labels, watermarks, brand names, or written words anywhere on the image. The image must be completely free of any visible text or typography.';
      let currentImagePrompt = rawImagePrompt + productSuffix + arSuffix + noTextSuffix;
      let policyFixAttempted = false;

      // Retry up to 3 times with Auto-fix for Policy Violations
      // เมื่อแก้ policy แล้วจะ retry ทันทีโดยไม่นับ retry count (retry--)
      let imageResult = null;
      for (let retry = 0; retry < 3; retry++) {
        if (storyState.stopped) break;
        try {
          // ใช้ 9-step Config Dropdown flow ผ่าน background.js (เหมือน mode-8s)
          const projectUrl = storyState.flowProjectUrl || 'https://aistudio.google.com';
          imageResult = await sendImageGenViaBackground(currentImagePrompt, sceneNum, projectUrl, referenceImages, 180000);

          if (storyState.stopped) break;
          if (imageResult?.success) break;

          // Check for policy violation and attempt auto-fix
          const errorMsg = imageResult?.error || imageResult?.message || '';
          const isPolicyError = window.StoryboardAI?.isPolicyViolationError?.(errorMsg);

          if (isPolicyError && !policyFixAttempted && window.StoryboardAI?.fixPolicyViolationPrompt) {
            console.log(`[Story] Policy violation detected for scene ${sceneNum}, attempting auto-fix...`);
            addCreatorLog(`⚠️ โดน policy - กำลังแก้ไข prompt...`, 'warning', sceneNum);

            const fixedPrompt = await window.StoryboardAI.fixPolicyViolationPrompt(currentImagePrompt, errorMsg);
            if (fixedPrompt && fixedPrompt !== currentImagePrompt) {
              currentImagePrompt = fixedPrompt;
              policyFixAttempted = true;
              addCreatorLog(`🔧 แก้ไข prompt สำเร็จ - กำลังลองใหม่...`, 'info', sceneNum);
              // ลองใหม่ทันทีด้วย prompt ที่แก้แล้ว (ไม่เพิ่ม retry count)
              retry--;
              continue;
            }
          }
        } catch (err) {
          console.error(`[Story] Scene ${sceneNum} image retry ${retry}:`, err);

          // Also check caught error for policy violation
          const errMsg = err?.message || String(err);
          const isPolicyError = window.StoryboardAI?.isPolicyViolationError?.(errMsg);

          if (isPolicyError && !policyFixAttempted && window.StoryboardAI?.fixPolicyViolationPrompt) {
            console.log(`[Story] Policy violation (caught) for scene ${sceneNum}, attempting auto-fix...`);
            addCreatorLog(`⚠️ โดน policy - กำลังแก้ไข prompt...`, 'warning', sceneNum);

            try {
              const fixedPrompt = await window.StoryboardAI.fixPolicyViolationPrompt(currentImagePrompt, errMsg);
              if (fixedPrompt && fixedPrompt !== currentImagePrompt) {
                currentImagePrompt = fixedPrompt;
                policyFixAttempted = true;
                addCreatorLog(`🔧 แก้ไข prompt สำเร็จ - กำลังลองใหม่...`, 'info', sceneNum);
                // ลองใหม่ทันทีด้วย prompt ที่แก้แล้ว (ไม่เพิ่ม retry count)
                retry--;
                continue;
              }
            } catch (fixErr) {
              console.error('[Story] Auto-fix failed:', fixErr);
            }
          }

          if (retry < 2) await delay(500);
        }
      }

      if (imageResult?.success) {
        scene.imageUrl = imageResult.imageUrl || imageResult.pictureUrl;
        scene.imageBase64 = imageResult.imageBase64 || null;  // 9-step flow ไม่ส่ง base64
        scene.imageCreated = true;
        storyState.imagesCompleted++;

        // Debug: log ข้อมูลรูปที่ได้จาก Step 1 — แสดง URL ID เพื่อเทียบว่ารูปแต่ละ scene ไม่ซ้ำกัน
        const step1UrlId = scene.imageUrl ? scene.imageUrl.split('/').pop()?.substring(0, 20) : 'null';
        console.log(`[Story] Step1 Scene ${sceneNum}: imageUrl=${scene.imageUrl?.substring(0, 80) || 'null'}, base64=${scene.imageBase64 ? scene.imageBase64.length + ' chars' : 'null'}`);
        addCreatorLog(`📸 Step1 ฉาก ${sceneNum}: URL ...${step1UrlId}`, 'info', sceneNum);

        // Save to storage
        const storageKey = `storyImageResult_${sceneNum}`;
        await chrome.storage.local.set({ [storageKey]: imageResult });

        addCreatorLog(`✅ สร้างรูปสำเร็จ${policyFixAttempted ? ' (หลังแก้ไข prompt)' : ''}`, 'success', sceneNum);
      } else {
        addCreatorLog(`❌ สร้างรูปล้มเหลว${policyFixAttempted ? ' (แม้แก้ไข prompt แล้ว)' : ''}`, 'error', sceneNum);
      }
    }

    // Retry ฉากที่ยังไม่มีรูป (ลองอีก 1 รอบ)
    const failedImageScenes = scenes.filter(s => !s.imageCreated);
    if (failedImageScenes.length > 0 && !storyState.stopped) {
      addCreatorLog(`⚠️ ยังมี ${failedImageScenes.length} ฉากที่ยังไม่มีรูป — ลองใหม่...`, 'warning');
      for (const scene of failedImageScenes) {
        if (storyState.stopped) break;
        const sceneIdx = scenes.indexOf(scene);
        const sceneNum = sceneIdx + 1;
        addCreatorLog(`🔄 ลองสร้างรูปฉาก ${sceneNum} อีกครั้ง...`, 'info', sceneNum);
        updateStoryProgress(`ลองสร้างรูปฉาก ${sceneNum} อีกครั้ง...`, Math.round((sceneIdx / totalScenes) * 50));

        const referenceImages = [];
        const scCfg = storyState.config.sceneConfigs?.[sceneIdx];
        if (scCfg?.charImage) {
          referenceImages.push({ type: 'character', name: scCfg.charName || 'ตัวละคร', base64: scCfg.charImage });
        } else if (storyState.config.characters?.[sceneIdx]?.image) {
          const c = storyState.config.characters[sceneIdx];
          referenceImages.push({ type: 'character', name: c.name, base64: c.image });
        }
        if (scCfg?.productImage) {
          referenceImages.push({ type: 'product', name: scCfg.product || 'สินค้า', base64: scCfg.productImage });
        }

        const rawImagePrompt = scene.imagePrompt || scene.photoPrompt;
        const arSuffix = (storyState.config.aspectRatio === '16:9')
          ? ', 16:9 wide landscape format, full scene visible, nothing cropped'
          : ', 9:16 tall portrait format, full body visible from head to toe, character centered in frame, nothing cropped at top or bottom';
        const productSuffix = (scCfg?.product && scCfg?.productImage)
          ? `, character holding the product "${scCfg.product}" prominently in hand, the product must appear exactly as the uploaded ingredient photo — same packaging, same label, same colors, do not alter or reimagine the product`
          : '';
        const noTextSuffix = '. IMPORTANT: Do NOT render any text, titles, labels, watermarks, brand names, or written words anywhere on the image. The image must be completely free of any visible text or typography.';
        const retryImagePrompt = rawImagePrompt + productSuffix + arSuffix + noTextSuffix;

        let imageResult = null;
        for (let retry = 0; retry < 3; retry++) {
          if (storyState.stopped) break;
          try {
            const projectUrl = storyState.flowProjectUrl || 'https://aistudio.google.com';
            imageResult = await sendImageGenViaBackground(retryImagePrompt, sceneNum, projectUrl, referenceImages, 180000);
            if (storyState.stopped) break;
            if (imageResult?.success) break;
          } catch (err) {
            console.error(`[Story] Scene ${sceneNum} image retry-2 attempt ${retry}:`, err);
            if (retry < 2) await delay(500);
          }
        }

        if (imageResult?.success) {
          scene.imageUrl = imageResult.imageUrl;
          scene.imageBase64 = imageResult.imageBase64;
          scene.imageCreated = true;
          storyState.imagesCompleted++;
          addCreatorLog(`✅ สร้างรูปสำเร็จ (retry)`, 'success', sceneNum);
          const storageKey = `storyImageResult_${sceneNum}`;
          await chrome.storage.local.set({ [storageKey]: imageResult });
        } else {
          addCreatorLog(`❌ สร้างรูปล้มเหลวอีกครั้ง`, 'error', sceneNum);
        }
      }
    }

    // Check if enough images
    const imagesCreated = scenes.filter(s => s.imageCreated).length;
    if (imagesCreated === 0) {
      addCreatorLog('❌ ไม่สามารถสร้างรูปได้เลย - หยุด pipeline', 'error');
      return;
    }
    if (imagesCreated < totalScenes) {
      addCreatorLog(`⚠️ สร้างรูปได้ ${imagesCreated}/${totalScenes} ฉาก — ทำวิดีโอเฉพาะฉากที่มีรูป`, 'warning');
    }

    if (storyState.stopped) { addCreatorLog('⏹️ หยุดโดยผู้ใช้', 'warning'); return; }

    // ==============================
    // Step 2: สร้างคลิปวิดีโอ — 9-step flow เลือก Video mode เอง (ไม่ต้องกด Videos tab)
    // ==============================
    addCreatorLog('🎬 Step 2: สร้างคลิปทีละฉาก...', 'step');
    storyState.currentPhase = 'creating_videos';

    const scenesWithImages = scenes.filter(s => s.imageCreated);
    for (let i = 0; i < scenesWithImages.length; i++) {
      if (storyState.stopped) { addCreatorLog('⏹️ หยุดโดยผู้ใช้', 'warning'); return; }

      const scene = scenesWithImages[i];
      const sceneNum = scene.sceneNumber || (i + 1);

      // Skip logic: ถ้าอยู่ใน Resume mode และฉากนี้มีวิดีโอแล้ว ให้ข้าม
      if (storyState.resumeMode && scene.videoCreated) {
        addCreatorLog(`⏭️ ฉาก ${sceneNum} มีวิดีโอแล้ว - ข้าม`, 'info');
        continue;
      }

      const percent = 50 + Math.round((i / scenesWithImages.length) * 40); // Phase 3 = 50-90%

      addCreatorLog(`🎬 สร้างคลิป...`, 'info', sceneNum);
      updateStoryProgress(`สร้างคลิปฉากที่ ${sceneNum}/${scenesWithImages.length}...`, percent);

      // Append Thai script to video prompt for Thai voiceover
      let finalVideoPrompt = scene.videoPrompt || '';
      const thaiScript = scene.scriptTH || scene.voiceover || '';

      // เพิ่ม voice gender ตามที่เลือกใน dropdown
      const sceneConfig = storyState.config?.sceneConfigs?.[i];
      const sceneGender = sceneConfig?.voiceGender || 'female';
      if (sceneGender === 'male') {
        finalVideoPrompt += '\n\nVOICE: Use a MALE voice for all narration and dialogue in this scene.';
      } else {
        finalVideoPrompt += '\n\nVOICE: Use a FEMALE voice for all narration and dialogue in this scene.';
      }

      if (thaiScript) {
        // Use CRITICAL DIALOGUE enforcement (same as mode-8s) to force VEO to follow the script exactly
        finalVideoPrompt += '\n\nCRITICAL DIALOGUE SCRIPT (The character MUST speak EXACTLY this Thai dialogue, word by word, in Thai language): "' + thaiScript + '"';
      }

      // ฉาก 2+ : ห้ามพูดซ้ำคำท้ายของฉากก่อนหน้า
      if (i > 0) {
        const prevScene = scenesWithImages[i - 1];
        const prevScript = prevScene.scriptTH || prevScene.voiceover || '';
        if (prevScript) {
          // ดึง 5 คำสุดท้ายของฉากก่อน
          const prevWords = prevScript.trim().split(/\s+/);
          const lastFewWords = prevWords.slice(-5).join(' ');
          finalVideoPrompt += '\n\nSPEECH OVERLAP PREVENTION (CRITICAL): This is scene ' + sceneNum + ' which follows after another scene. The previous scene ended with: "' + lastFewWords + '". You MUST NOT repeat or start with these words. Start the dialogue FRESH with completely new words from the script above. Do NOT echo, mirror, or overlap any audio from the previous scene.';
        }
      }

      // ห้ามแสดงตัวอักษร/ข้อความในคลิป
      finalVideoPrompt += '\n\nIMPORTANT: Do NOT render any text, subtitles, captions, watermarks, or written words on screen. The video must be completely free of any visible text or typography.';

      // ส่ง imageUrl ให้ content script ดาวน์โหลดเอง (เหมือน 16s: imageToFile)
      // ไม่ fetch base64 ใน pipeline แล้ว — content script ทำเองบน Flow page
      const urlId = scene.imageUrl ? scene.imageUrl.split('/').pop()?.substring(0, 20) : 'null';
      addCreatorLog(`📷 ฉาก ${sceneNum}: URL ...${urlId}`, 'info', sceneNum);

      // Retry up to 2 times — ใช้ 9-step Config Dropdown flow ผ่าน background.js (เหมือน mode-8s)
      let videoResult = null;
      for (let retry = 0; retry < 2; retry++) {
        if (storyState.stopped) break;
        try {
          const projectUrl = storyState.flowProjectUrl || 'https://aistudio.google.com';
          videoResult = await sendVideoGenViaBackground(finalVideoPrompt, scene.imageUrl, sceneNum, projectUrl, 300000);

          if (storyState.stopped) break;
          if (videoResult?.success) break;
        } catch (err) {
          if (storyState.stopped) break;
          console.error(`[Story] Scene ${sceneNum} video retry ${retry}:`, err);
          if (retry < 1) await delay(1000);
        }
      }

      if (storyState.stopped) { addCreatorLog('⏹️ หยุดโดยผู้ใช้', 'warning'); return; }

      if (videoResult?.success) {
        scene.videoCreated = true;
        scene.videoStorageUrl = videoResult.videoUrl || null;
        storyState.videosCompleted++;
        addCreatorLog(`✅ สร้างคลิปสำเร็จ`, 'success', sceneNum);
        if (scene.videoStorageUrl) {
          addCreatorLog(`🔗 URL: ${scene.videoStorageUrl.substring(0, 60)}...`, 'info', sceneNum);

          // ดาวน์โหลดวิดีโอเป็น blob ทันที ก่อนเปิด project ใหม่
          // เพราะ GCS URL อาจหมดอายุหรือต้อง auth จาก project เดิม
          try {
            addCreatorLog(`⬇️ ดาวน์โหลดคลิป...`, 'info', sceneNum);
            const vidResp = await fetch(scene.videoStorageUrl);
            if (vidResp.ok) {
              const vidBlob = await vidResp.blob();
              scene.videoBlobUrl = URL.createObjectURL(vidBlob);
              addCreatorLog(`✅ ดาวน์โหลดคลิปแล้ว (${(vidBlob.size / 1024 / 1024).toFixed(2)} MB)`, 'success', sceneNum);
            } else {
              addCreatorLog(`⚠️ ดาวน์โหลดคลิปไม่ได้ (${vidResp.status})`, 'warning', sceneNum);
            }
          } catch (dlErr) {
            addCreatorLog(`⚠️ ดาวน์โหลดคลิปล้มเหลว: ${dlErr.message}`, 'warning', sceneNum);
          }
        }

        // 9-step Config Dropdown flow จัดการ reset เองทุกรอบ — ไม่ต้องเปิด project ใหม่
        // background.js จะ reuse tab เดิมและ content script จะเริ่ม 9-step ใหม่แต่ละ scene
      } else {
        addCreatorLog(`❌ สร้างคลิปล้มเหลว`, 'error', sceneNum);
      }

      await delay(500);
    }

    if (storyState.stopped) { addCreatorLog('⏹️ หยุดโดยผู้ใช้', 'warning'); return; }

    // ==============================
    // Step 3: CONCATENATE & DOWNLOAD (FFmpeg)
    // ==============================
    const postTiktokMode = document.getElementById('storyPostTiktok')?.value || 'download';
    const isAutoPostTiktok = postTiktokMode === 'auto';

    addCreatorLog('🎬 Step 3: รวมวิดีโอทุกฉาก (Video Engine)...', 'step');
    if (isAutoPostTiktok) addCreatorLog('📤 โหมด: Post TikTok อัตโนมัติ', 'info');
    storyState.currentPhase = 'exporting';
    updateStoryProgress('กำลังรวมวิดีโอ...', 90);

    let exportSuccess = false;
    let capturedVideoUrl = null;

    // รวบรวม video URLs จาก Step 2
    const scenesWithVideo = scenesWithImages.filter(function(s) { return s.videoCreated && (s.videoBlobUrl || s.videoStorageUrl); });
    const videoUrls = scenesWithVideo.map(function(s) { return s.videoBlobUrl || s.videoStorageUrl; });

    if (videoUrls.length === 0) {
      storyState.stats.exportFailed++;
      addCreatorLog('❌ ไม่มีวิดีโอที่จะรวม', 'error');
    } else {
      addCreatorLog('📦 พบ ' + videoUrls.length + ' คลิป — ส่งไป Video Engine...', 'info');

      var topicSlug = (storyState.config.topic || 'story').substring(0, 30).replace(/[^a-zA-Z0-9\u0E00-\u0E7F]/g, '_');
      var rowId = 'story_' + Date.now();

      try {
        // ส่ง request ไป React parent (FFmpeg)
        var concatResult = await new Promise(function(resolve, reject) {
          var timeout = setTimeout(function() {
            window.removeEventListener('message', handler);
            reject(new Error('Timeout: รวมวิดีโอนานเกิน 5 นาที'));
          }, 300000);

          function handler(event) {
            if (event.data && event.data.type === 'FFMPEG_CONCAT_PROGRESS' && event.data.data) {
              var d = event.data.data;
              var msg = d.step || '';
              if (d.currentVideo && d.totalVideos) {
                msg += ' (' + d.currentVideo + '/' + d.totalVideos + ')';
              }
              addCreatorLog('⏳ ' + msg, 'info');
              updateStoryProgress(msg, Math.round(d.progress || 90));
            }
            if (event.data && event.data.type === 'FFMPEG_CONCAT_RESULT' && event.data.data) {
              clearTimeout(timeout);
              window.removeEventListener('message', handler);
              resolve(event.data.data);
            }
          }

          window.addEventListener('message', handler);

          window.parent.postMessage({
            type: 'FFMPEG_CONCAT_REQUEST',
            data: {
              videoUrls: videoUrls,
              mode: isAutoPostTiktok ? 'tiktok' : 'download',
              rowId: rowId,
              filename: 'story_' + topicSlug + '_' + Date.now() + '.mp4'
            }
          }, '*');
        });

        if (concatResult.success) {
          exportSuccess = true;
          storyState.stats.exportSuccess++;

          if (isAutoPostTiktok && concatResult.storageKey) {
            capturedVideoUrl = 'storage:' + concatResult.storageKey;
            addCreatorLog('✅ รวมวิดีโอสำเร็จ: ' + ((concatResult.videoSize || 0) / 1024 / 1024).toFixed(2) + ' MB', 'success');
          } else if (isAutoPostTiktok) {
            // Edge case: 1 คลิป → ใช้ URL ตรง
            capturedVideoUrl = videoUrls[videoUrls.length - 1];
            addCreatorLog('✅ พบวิดีโอเดียว — ใช้ URL ตรง', 'success');
          } else {
            addCreatorLog('✅ ดาวน์โหลดสำเร็จ: ' + ((concatResult.videoSize || 0) / 1024 / 1024).toFixed(2) + ' MB', 'success');
          }
        } else {
          throw new Error(concatResult.error || 'Unknown error');
        }
      } catch (err) {
        console.error('[Story] FFmpeg concat failed:', err);
        addCreatorLog('❌ รวมวิดีโอล้มเหลว: ' + err.message, 'error');
        storyState.stats.exportFailed++;
      }
    }

    // ==============================
    // Step 4: POST TIKTOK (ถ้าเลือก auto)
    // ==============================
    if (exportSuccess && isAutoPostTiktok && capturedVideoUrl) {
      storyState.currentPhase = 'posting_tiktok';
      addCreatorLog('📱 Step 4: กำลังส่งโพสต์ TikTok...', 'step');
      updateStoryProgress('กำลังส่งโพสต์ TikTok...', 95);

      try {
        // ดึงชื่อสินค้าจาก product dropdown — ค้นหาจากทุกฉาก (ไม่ใช่แค่ฉาก 1)
        let productName = '';
        let productCode = '';
        let productHighlights = '';
        const totalScenes = parseInt(document.getElementById('storySceneCount')?.value) || 4;
        for (let psi = 1; psi <= totalScenes; psi++) {
          const pSelect = document.getElementById(`storyProduct${psi}Select`);
          if (pSelect && pSelect.value && pSelect.value !== '' && pSelect.value !== 'custom') {
            productName = pSelect.options[pSelect.selectedIndex]?.textContent?.trim() || '';
            productName = productName.replace(/^\d+\.\s*/, '');
            // ดึง productCode + productHighlights จาก cached products
            const pIdx = parseInt(pSelect.value);
            const cachedP = (typeof _cachedProducts !== 'undefined' && _cachedProducts) ? _cachedProducts[pIdx] : null;
            productCode = cachedP?.code || productName;
            productHighlights = cachedP?.highlights || '';
            if (productName) break; // พบสินค้าแล้ว ไม่ต้องค้นต่อ
          }
          if (!productName) {
            const customName = document.getElementById(`storyProduct${psi}Name`)?.value?.trim() || '';
            if (customName) {
              productName = customName;
              productCode = customName;
              break;
            }
          }
        }
        if (!productCode) productCode = productName;

        // สร้าง caption ด้วย AI (เหมือนโหมด 8s/16s)
        let caption = productName
          ? `${productName} #TikTokShop #fyp`
          : `${storyState.config?.topic || 'Video'} #TikTokShop #fyp`;

        if (productName) {
          try {
            const aiConfig = window.StoryboardAI?.getOpenAIConfig?.();
            if (aiConfig && window.StoryboardAI?.callOpenAI) {
              addCreatorLog('🤖 AI กำลังสร้าง Caption...', 'info');
              const captionResponse = await window.StoryboardAI.callOpenAI(
                'คุณเป็นนักเขียนโฆษณา TikTok Shop มืออาชีพ\nสร้างแคปชั่นที่ดึงดูดใจ ชวนคนหยุดดู โดย:\n1. เริ่มต้นด้วย Hook ที่น่าสนใจ (ใช้คำถาม หรือบอกประโยชน์จริง)\n2. พูดถึงจุดเด่น 2-3 ข้อสั้นๆ ตามข้อมูลจริงของสินค้า\n3. มี Call-to-Action ชวนซื้อ\n4. ใช้ emoji 3-5 ตัว (ไม่มากเกินไป)\n5. ใส่ hashtag 3-5 อัน ที่เกี่ยวข้องกับสินค้า (ต้องมี #TikTokShop)\n\n⚠️ กฎสำคัญ (TikTok Community Guidelines):\n- ห้ามพูดเกินจริง ห้ามมีคำเท็จ ห้ามอ้างผลลัพธ์ที่ไม่มีหลักฐาน\n- ห้ามสร้าง urgency ปลอม เช่น "เหลือชิ้นสุดท้าย!" "หมดเขตวันนี้!"\n- ห้ามอ้างสรรพคุณทางการแพทย์ เช่น "รักษาโรค" "ลดน้ำหนัก X กิโล"\n- ห้ามใช้ clickbait หลอกลวง หรือ spam hashtag ที่ไม่เกี่ยวข้อง\n- ห้ามใช้คำที่สื่อถึงการรับประกันผลลัพธ์ เช่น "การันตี 100%"\n- เขียนให้เป็นธรรมชาติ เหมือนคนจริงรีวิว ไม่ใช่โฆษณาจ๋า\nตอบเป็น JSON: {"caption": "ข้อความ caption ที่สร้าง"}',
                `สร้างแคปชั่น TikTok สำหรับสินค้า:\nชื่อ: ${productName}\n${productHighlights ? 'จุดเด่น: ' + productHighlights : ''}\nตอบเป็น JSON: {"caption": "..."}`,
                [],
                { temperature: 0.95, maxTokens: 300 }
              );
              if (captionResponse) {
                try {
                  const parsed = JSON.parse(captionResponse.trim());
                  caption = parsed.caption || caption;
                } catch (e) {
                  // ถ้า parse ไม่ได้ ใช้ response ตรงๆ (ลบ JSON wrapper ถ้ามี)
                  caption = captionResponse.trim().replace(/^\{.*?"caption"\s*:\s*"/, '').replace(/"\s*\}$/, '') || caption;
                }
                addCreatorLog('✅ AI Caption: ' + caption.substring(0, 80) + '...', 'success');
              }
            }
          } catch (err) {
            console.error('[Story] AI caption generation failed:', err);
            addCreatorLog('⚠️ ใช้ caption fallback', 'warning');
          }
        }

        // สร้าง CTA ด้วย AI (ใช้ OpenAI/OpenRouter เหมือนโหมด 8s/16s)
        let cta = '';
        if (productName) {
          try {
            const aiConfig = window.StoryboardAI?.getOpenAIConfig?.();
            if (aiConfig && window.StoryboardAI?.callOpenAI) {
              addCreatorLog('🤖 AI กำลังสร้าง CTA...', 'info');
              const ctaResponse = await window.StoryboardAI.callOpenAI(
                'คุณเป็นนักการตลาดมืออาชีพ สร้าง Call to Action สั้นๆ ภาษาไทย สำหรับใส่เป็นชื่อสินค้าบนวิดีโอ TikTok\nตอบแค่ข้อความ CTA อย่างเดียว ห้ามมี emoji หรือสัญลักษณ์พิเศษ ห้ามใส่เครื่องหมายคำพูด\nห้ามพูดเกินจริง ห้ามอ้างผลลัพธ์ที่การันตี ห้ามสร้าง urgency ปลอม ห้ามอ้างสรรพคุณทางการแพทย์\nใช้คำที่เป็นธรรมชาติ ชวนให้ลองใช้ ไม่ใช่บังคับให้ซื้อ',
                `สร้าง CTA สั้นๆ ไม่เกิน 30 ตัวอักษร สำหรับสินค้า "${productName}" ที่ชวนให้คนสนใจลองดู ตอบแค่ข้อความ CTA อย่างเดียว`,
                [],
                { temperature: 1.0, maxTokens: 60 }
              );
              if (ctaResponse) {
                cta = ctaResponse.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9\s]/g, '').trim().slice(0, 30);
              }
              if (cta) {
                addCreatorLog(`✅ CTA: ${cta}`, 'success');
              }
            }
          } catch (err) {
            console.error('[Story] AI CTA generation failed:', err);
          }
          // Fallback ถ้า AI สร้างไม่ได้
          if (!cta) {
            cta = ['กดสั่งซื้อเลย', 'สั่งซื้อเลยตอนนี้', 'รีบสั่งก่อนหมด', 'กดตะกร้าเลย', 'สั่งเลยคุ้มมาก', 'อย่าพลาดรีบสั่งเลย'][Math.floor(Math.random() * 6)];
            addCreatorLog(`📝 CTA (fallback): ${cta}`, 'info');
          }
        }

        // ใช้ captured URL จาก background.js (ไม่ใช่ storage: prefix)
        const tiktokData = {
          rowId: 'story_' + Date.now(),
          rowNumber: 1,
          videoUrl: capturedVideoUrl || '', // URL ที่ background.js จับจาก chrome.downloads
          productName: productName,
          productCode: productCode,
          cta: cta,
          caption: caption,
          skipAddLink: !productName
        };

        addCreatorLog(`📦 สินค้า: ${productName || '(ไม่มี)'}`, 'info');
        addCreatorLog(`📝 Caption: ${caption}`, 'info');
        addCreatorLog(`🔗 Video URL: ${capturedVideoUrl ? capturedVideoUrl.substring(0, 60) + '...' : '(ไม่มี)'}`, 'info');

        // ส่ง message ไป background.js → เปิด TikTok tab → รอจนโพสต์เสร็จ
        addCreatorLog('📤 กำลังส่งวิดีโอไป TikTok...', 'info');

        const tiktokFinalResult = await new Promise((resolve) => {
          let resolved = false;
          const timeoutMs = 300000; // 5 นาที timeout

          // ฟัง UPDATE_TIKTOK_STATUS / TIKTOK_ERROR จาก background
          function statusListener(msg) {
            if (resolved) return;
            if (msg.type === 'UPDATE_TIKTOK_STATUS' && msg.data) {
              resolved = true;
              chrome.runtime.onMessage.removeListener(statusListener);
              resolve({ success: true, tiktokUrl: msg.data.tiktokUrl, status: msg.data.status });
            }
            if (msg.type === 'TIKTOK_ERROR' || (msg.type === 'ADD_LOG' && msg.data?.type === 'error' && msg.data?.message?.includes('ERROR'))) {
              // ไม่ resolve ทันที — ให้โอกาส retry
            }
          }
          chrome.runtime.onMessage.addListener(statusListener);

          // เช็ค storyState.stopped ทุก 2 วิ เพื่อหยุดรอทันที
          const stopCheckInterval = setInterval(() => {
            if (!resolved && storyState.stopped) {
              resolved = true;
              clearInterval(stopCheckInterval);
              chrome.runtime.onMessage.removeListener(statusListener);
              resolve({ success: false, error: 'หยุดโดยผู้ใช้' });
            }
          }, 2000);

          // Timeout
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              clearInterval(stopCheckInterval);
              chrome.runtime.onMessage.removeListener(statusListener);
              resolve({ success: false, error: 'Timeout 5 นาที' });
            }
          }, timeoutMs);

          // ส่ง START_TIKTOK_POST
          chrome.runtime.sendMessage({
            type: 'START_TIKTOK_POST',
            data: tiktokData
          }, (response) => {
            if (chrome.runtime.lastError) {
              addCreatorLog('⚠️ ส่งไม่ได้: ' + chrome.runtime.lastError.message, 'warning');
              if (!resolved) {
                resolved = true;
                chrome.runtime.onMessage.removeListener(statusListener);
                resolve({ success: false, error: chrome.runtime.lastError.message });
              }
            } else if (response?.success) {
              addCreatorLog('✅ เปิด TikTok tab แล้ว — รอโพสต์...', 'info');
            } else {
              addCreatorLog('⚠️ เปิด TikTok ไม่ได้: ' + (response?.error || 'Unknown'), 'warning');
              if (!resolved) {
                resolved = true;
                chrome.runtime.onMessage.removeListener(statusListener);
                resolve({ success: false, error: response?.error });
              }
            }
          });
        });

        if (tiktokFinalResult?.success) {
          const url = tiktokFinalResult.tiktokUrl || '';
          addCreatorLog(`✅ โพสต์ TikTok สำเร็จ!${url ? ' URL: ' + url : ''}`, 'success');
        } else {
          addCreatorLog('⚠️ โพสต์ TikTok ไม่สำเร็จ: ' + (tiktokFinalResult?.error || 'Unknown'), 'warning');
        }
      } catch (tiktokErr) {
        console.error('[Story] TikTok post error:', tiktokErr);
        addCreatorLog('⚠️ ส่งโพสต์ TikTok ล้มเหลว: ' + tiktokErr.message, 'warning');
      }
    }

    // ==============================
    // COMPLETE
    // ==============================
    updateStoryProgress('Story Mode เสร็จสิ้น!', 100);
    addCreatorLog('🎉 Story Mode เสร็จสิ้น!', 'success');

    // Loop
    if (storyState.loopEnabled && !storyState.stopped) {
      await continueStoryModeLoop();
    }

    // Notify parent React wrapper that flow finished
    window.parent.postMessage({ type: 'STORY_STATUS', running: false }, '*');
    resetCreateStopButtons();
    // อัพเดทปุ่ม Concatenate/Resume ตามสถานะฉาก
    if (typeof window.updateActionButtons === 'function') {
      window.updateActionButtons();
    }

  } catch (err) {
    console.error('[StoryMode] Pipeline error:', err);
    addCreatorLog('❌ Pipeline error: ' + err.message, 'error');
    window.parent.postMessage({ type: 'STORY_STATUS', running: false }, '*');
    resetCreateStopButtons();
    // อัพเดทปุ่ม Concatenate/Resume ตามสถานะฉาก
    if (typeof window.updateActionButtons === 'function') {
      window.updateActionButtons();
    }
  } finally {
    storyState.isRunning = false;
  }
}

// ============================================================
// CONCATENATE & RESUME FUNCTIONS
// ============================================================

/**
 * ดึงข้อมูล scenes ปัจจุบัน (สำหรับ UI เรียกเช็คสถานะ)
 * @returns {Array} scenes array
 */
function getScenes() {
  return storyState.scenes || [];
}

/**
 * Step 3: Export และ Download วิดีโอ
 * แยกออกมาเพื่อเรียกใช้แยกได้จาก concatenateAllScenes
 * @returns {Promise<{success: boolean, stopped?: boolean}>}
 */
async function exportAndDownload() {
  storyState.currentPhase = 'exporting';

  if (storyState.stopped) {
    addCreatorLog('⏹️ หยุดโดยผู้ใช้', 'warning');
    return { success: false, stopped: true };
  }

  // รวบรวม video URLs จากทุกฉาก
  var scenes = storyState.scenes || [];
  var scenesWithVideo = scenes.filter(function(s) { return s.videoCreated && (s.videoBlobUrl || s.videoStorageUrl); });
  var videoUrls = scenesWithVideo.map(function(s) { return s.videoBlobUrl || s.videoStorageUrl; });

  if (videoUrls.length === 0) {
    addCreatorLog('❌ ไม่มีวิดีโอที่จะรวม', 'error');
    storyState.stats.exportFailed++;
    return { success: false };
  }

  addCreatorLog('📦 พบ ' + videoUrls.length + ' คลิป — ส่งไป Video Engine...', 'info');

  var topicSlug = (storyState.config.topic || 'story').substring(0, 30).replace(/[^a-zA-Z0-9\u0E00-\u0E7F]/g, '_');

  try {
    var concatResult = await new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() {
        window.removeEventListener('message', handler);
        reject(new Error('Timeout: รวมวิดีโอนานเกิน 5 นาที'));
      }, 300000);

      function handler(event) {
        if (event.data && event.data.type === 'FFMPEG_CONCAT_PROGRESS' && event.data.data) {
          var d = event.data.data;
          var msg = d.step || '';
          if (d.currentVideo && d.totalVideos) {
            msg += ' (' + d.currentVideo + '/' + d.totalVideos + ')';
          }
          addCreatorLog('⏳ ' + msg, 'info');
          updateStoryProgress(msg, Math.round(d.progress || 90));
        }
        if (event.data && event.data.type === 'FFMPEG_CONCAT_RESULT' && event.data.data) {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve(event.data.data);
        }
      }

      window.addEventListener('message', handler);

      window.parent.postMessage({
        type: 'FFMPEG_CONCAT_REQUEST',
        data: {
          videoUrls: videoUrls,
          mode: 'download',
          filename: 'story_' + topicSlug + '_' + Date.now() + '.mp4'
        }
      }, '*');
    });

    if (concatResult.success) {
      storyState.stats.exportSuccess++;
      addCreatorLog('✅ ดาวน์โหลดสำเร็จ: ' + ((concatResult.videoSize || 0) / 1024 / 1024).toFixed(2) + ' MB', 'success');
      return { success: true };
    } else {
      throw new Error(concatResult.error || 'Unknown error');
    }
  } catch (err) {
    console.error('[Story] FFmpeg concat failed:', err);
    addCreatorLog('❌ รวมวิดีโอล้มเหลว: ' + err.message, 'error');
    storyState.stats.exportFailed++;
    return { success: false };
  }
}

/**
 * ดาวน์โหลดคลิปที่เสร็จแล้ว - ข้ามไป Export โดยตรง
 * เรียกใช้เมื่อมีอย่างน้อย 1 ฉากที่มีวิดีโอ
 */
async function concatenateAllScenes() {
  const scenes = storyState.scenes;
  const scenesWithVideo = scenes.filter(s => s.videoCreated);

  if (scenesWithVideo.length === 0) {
    await showStoryAlert('ยังไม่มีคลิปที่เสร็จ', 'warning', 'ไม่มีคลิป');
    return;
  }

  // ตั้ง flag
  storyState.concatenateOnlyMode = true;
  storyState.stopped = false;
  chrome.storage.local.remove('story_stop_requested');

  // แสดง UI
  updateStoryProgress('กำลังดาวน์โหลด...', 90);
  addCreatorLog(`📥 เริ่มดาวน์โหลดคลิปที่เสร็จแล้ว (${scenesWithVideo.length} คลิป)`, 'step');

  try {
    // ไปที่ Step 3 โดยตรง (FFmpeg ผ่าน React parent)
    const result = await exportAndDownload();

    if (result.success) {
      updateStoryProgress('ดาวน์โหลดเสร็จ!', 100);
      addCreatorLog('✅ ดาวน์โหลดเสร็จ!', 'success');
    } else if (result.stopped) {
      addCreatorLog('⏹️ หยุดโดยผู้ใช้', 'warning');
    } else {
      addCreatorLog('❌ Export ไม่สำเร็จหลังลอง 4 ครั้ง', 'error');
    }
  } catch (error) {
    console.error('[concatenateAllScenes] Error:', error);
    addCreatorLog(`❌ Error: ${error.message}`, 'error');
  } finally {
    storyState.concatenateOnlyMode = false;
    window.parent.postMessage({ type: 'STORY_STATUS', running: false }, '*');
    resetCreateStopButtons();
    // อัพเดทปุ่ม
    if (typeof window.updateActionButtons === 'function') {
      window.updateActionButtons();
    }
  }
}

/**
 * ทำต่อจากฉากที่ค้างไว้
 * สร้างเฉพาะฉากที่ยังไม่มีวิดีโอ
 */
async function resumeFromLastScene() {
  storyState.resumeMode = true;
  storyState.stopped = false;
  chrome.storage.local.remove('story_stop_requested');

  addCreatorLog('▶️ ทำต่อจากที่ค้าง...', 'step');

  // เรียก startStoryModeFlow ปกติ แต่ resumeMode จะทำให้ skip ฉากที่เสร็จแล้ว
  await startStoryModeFlow();

  storyState.resumeMode = false;
}

// ============================================================
// LOOP MECHANISM
// ============================================================

/**
 * อัพเดทแสดงจำนวนรอบ Loop
 */
function updateLoopProgress(current, total) {
  const el = document.getElementById('storyLoopProgress');
  if (el) {
    el.textContent = `(${current}/${total})`;
    el.style.display = current > 0 ? 'inline' : 'none';
  }
}

async function continueStoryModeLoop() {
  storyState.loopIndex++;

  // Update loop progress display
  updateLoopProgress(storyState.loopIndex, storyState.loopCount);

  // Check loop limit
  if (!storyState.loopUnlimited && storyState.loopIndex >= storyState.loopCount) {
    addCreatorLog(`✅ ครบ ${storyState.loopCount} รอบแล้ว`, 'success');
    updateLoopProgress(0, 0); // Hide when done
    return;
  }

  addCreatorLog(`🔁 รอบที่ ${storyState.loopIndex + 1} - พัก ${storyState.loopDelay} วินาที...`, 'info');
  updateStoryProgress(`พักระหว่างรอบ... (${storyState.loopDelay}s)`, 0);

  await delay(storyState.loopDelay * 1000);

  if (storyState.stopped) {
    addCreatorLog('⏹️ หยุดโดยผู้ใช้', 'warning');
    return;
  }

  // Rotate topic (ถ้ามีหลายหัวข้อ)
  rotateStoryTopic();

  // Randomize (ถ้าเปิด)
  randomizeStorySettings();

  // Regenerate storyboard with new topic
  addCreatorLog('🎬 สร้าง Storyboard ใหม่สำหรับรอบถัดไป...', 'info');
  await generateStoryboard();

  // Auto-select random script variation for loop mode
  if (storyState.scenes && storyState.scenes.length > 0) {
    const hasVariations = storyState.scenes.some(s => s.scriptVariations && s.scriptVariations.length > 0);
    if (hasVariations) {
      const maxVariations = storyState.scenes[0].scriptVariations?.length || 4;
      const randomIndex = Math.floor(Math.random() * maxVariations);
      storyState.selectedVariationIndex = randomIndex;
      addCreatorLog(`🎲 สุ่มเลือก Script ${randomIndex + 1} อัตโนมัติ`, 'info');
    }
  }

  // Start pipeline again
  await startStoryModeFlow();
}

/**
 * สลับหัวข้อถัดไป (ถ้ามีหลายหัวข้อคั่นด้วย , หรือ newline)
 */
function rotateStoryTopic() {
  const topicEl = document.getElementById('storyTopic');
  if (!topicEl) return;

  const rawTopics = topicEl.value.split(/[,\n]/).map(t => t.trim()).filter(t => t);
  if (rawTopics.length <= 1) return;

  // หา topic ที่ยังไม่ได้ใช้
  const unused = rawTopics.filter(t => !storyState.topicsUsed.includes(t));
  if (unused.length === 0) {
    storyState.topicsUsed = []; // Reset ถ้าใช้หมดแล้ว
    return;
  }

  const nextTopic = unused[0];
  storyState.topicsUsed.push(nextTopic);

  // อัปเดต topic field ชั่วคราว (ให้ generateStoryboard อ่านได้)
  topicEl.dataset.currentTopic = nextTopic;
  console.log('[StoryMode] Rotated to topic:', nextTopic);
}

/**
 * สุ่มค่าต่างๆ ถ้าเปิด randomize
 */
function randomizeStorySettings() {
  // Random style
  if (document.getElementById('storyRandomizeStyle')?.checked) {
    const styles = Object.keys(window.StoryboardAI?.IMAGE_STYLE_MAP || {});
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];
    const styleEl = document.getElementById('storyImageStyle');
    if (styleEl) styleEl.value = randomStyle;
  }

  // Random mood
  if (document.getElementById('storyRandomizeMood')?.checked) {
    const moods = Object.keys(window.StoryboardAI?.MOOD_MAP || {});
    const randomMood = moods[Math.floor(Math.random() * moods.length)];
    const moodEl = document.getElementById('storyMood');
    if (moodEl) moodEl.value = randomMood;
  }

  // Random audience
  if (document.getElementById('storyRandomizeAudience')?.checked) {
    const audiences = Object.keys(window.StoryboardAI?.AUDIENCE_MAP || {});
    const randomAudience = audiences[Math.floor(Math.random() * audiences.length)];
    const audienceEl = document.getElementById('storyTargetAudience');
    if (audienceEl) audienceEl.value = randomAudience;
  }

  // Random scene count
  if (document.getElementById('storyRandomizeSceneCount')?.checked) {
    const counts = [2, 3, 4, 5, 6, 7, 8];
    const randomCount = counts[Math.floor(Math.random() * counts.length)];
    const countEl = document.getElementById('storySceneCount');
    if (countEl) countEl.value = randomCount;
  }
}

// ============================================================
// STOP
// ============================================================

function stopStoryMode() {
  storyState.stopped = true;
  storyState.isRunning = false;
  chrome.storage.local.set({ 'story_stop_requested': true });
  addCreatorLog('⏹️ หยุดแล้ว', 'warning');
  window.parent.postMessage({ type: 'STORY_STATUS', running: false }, '*');
  resetCreateStopButtons();
  // แสดงปุ่ม Resume ถ้ามีฉากที่ยังทำไม่เสร็จ
  if (typeof window.updateActionButtons === 'function') {
    window.updateActionButtons();
  }
  // ส่ง stop ไปที่ Flow tab ด้วย
  if (storyState.flowTabId) {
    try {
      chrome.tabs.sendMessage(storyState.flowTabId, { action: 'stopStoryMode' });
    } catch(e) {}
  }
}

function resetCreateStopButtons() {
  const runBtn = document.getElementById('storyRunBtn');
  const stopBtn = document.getElementById('storyStopBtn');
  if (runBtn) runBtn.style.display = 'block';
  if (stopBtn) stopBtn.style.display = 'none';
}

// ============================================================
// CONTENT SCRIPT LOG LISTENER (รับ log จาก content script แสดงใน Activity Log)
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'storyLog' && message.text) {
    addCreatorLog(message.text, message.type || 'info', message.sceneNumber || null);
  }
  // รับ log จาก TikTok content script (ผ่าน background.js relay)
  // กรองเฉพาะ step สำคัญ ไม่แสดง random behavior
  if (message.type === 'ADD_LOG' && message.data && storyState.currentPhase === 'posting_tiktok') {
    const msg = message.data.message || '';
    const important = msg.includes('Upload') || msg.includes('upload') ||
      msg.includes('Caption') || msg.includes('caption') ||
      msg.includes('สินค้า') || msg.includes('Product') ||
      msg.includes('โพสต์') || msg.includes('Post') || msg.includes('post') ||
      msg.includes('Draft') || msg.includes('draft') ||
      msg.includes('Schedule') ||
      msg.includes('ถูกบล็อก') || msg.includes('blocked') ||
      msg.includes('ERROR') || msg.includes('❌') || msg.includes('✅') ||
      msg.includes('⚠️') || msg.includes('🔄');
    if (important) {
      addCreatorLog(`🔵 ${msg}`, message.data.type || 'info');
    }
  }
});

// ============================================================
// INIT: EVENT LISTENERS
// ============================================================

function initStoryModeListeners() {
  // Generate Storyboard button
  const genBtn = document.getElementById('generateStoryboardBtn');
  if (genBtn) genBtn.addEventListener('click', generateStoryboard);

  // Regenerate button
  const regenBtn = document.getElementById('regenerateStoryboardBtn');
  if (regenBtn) regenBtn.addEventListener('click', generateStoryboard);

  // Start button
  const startBtn = document.getElementById('startStoryboardBtn');
  if (startBtn) startBtn.addEventListener('click', startStoryModeFlow);

  // Stop button
  const stopBtn = document.getElementById('stopStoryboardBtn');
  if (stopBtn) stopBtn.addEventListener('click', stopStoryMode);

  // Loop checkbox
  const loopCheckbox = document.getElementById('storyboardLoopEnabled');
  if (loopCheckbox) {
    loopCheckbox.addEventListener('change', () => {
      const optionsRow = document.getElementById('storyboardLoopOptionsRow');
      if (optionsRow) optionsRow.style.display = loopCheckbox.checked ? 'flex' : 'none';
      storyState.loopEnabled = loopCheckbox.checked;
    });
  }

  // Loop count
  const loopCountInput = document.getElementById('storyLoopCount');
  if (loopCountInput) {
    loopCountInput.addEventListener('change', () => {
      storyState.loopCount = parseInt(loopCountInput.value) || 3;
    });
  }

  // Loop delay
  const loopDelayInput = document.getElementById('storyLoopDelay');
  if (loopDelayInput) {
    loopDelayInput.addEventListener('change', () => {
      storyState.loopDelay = parseInt(loopDelayInput.value) || 30;
    });
  }

  // Realistic mode hint
  const realisticCheckbox = document.getElementById('storyRealisticMode');
  if (realisticCheckbox) {
    realisticCheckbox.addEventListener('change', () => {
      const hint = document.getElementById('storyRealisticModeHint');
      if (hint) hint.style.display = realisticCheckbox.checked ? 'block' : 'none';
    });
  }

  // Voice Preview buttons
  const generateVoiceBtn = document.getElementById('generateVoiceBtn');
  if (generateVoiceBtn) {
    generateVoiceBtn.addEventListener('click', generateVoiceForSelectedScene);
  }

  const downloadVoiceBtn = document.getElementById('downloadVoiceBtn');
  if (downloadVoiceBtn) {
    downloadVoiceBtn.addEventListener('click', downloadVoice);
  }

  const regenerateVoiceBtn = document.getElementById('regenerateVoiceBtn');
  if (regenerateVoiceBtn) {
    regenerateVoiceBtn.addEventListener('click', regenerateVoice);
  }

  const prevSceneBtn = document.getElementById('prevSceneBtn');
  if (prevSceneBtn) {
    prevSceneBtn.addEventListener('click', () => navigateScene(-1));
  }

  const nextSceneBtn = document.getElementById('nextSceneBtn');
  if (nextSceneBtn) {
    nextSceneBtn.addEventListener('click', () => navigateScene(1));
  }

  console.log('[StoryMode] Event listeners setup complete');
}

// ============================================================
// UTILITY
// ============================================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// EXPORTS
// ============================================================

if (typeof window !== 'undefined') {
  window.StoryPipeline = {
    storyState,
    generateStoryboard,
    startStoryModeFlow,
    stopStoryMode,
    initStoryModeListeners,
    sendToFlowTab,
    findFlowTab,
    generateVoiceForSelectedScene,
    showScriptVoiceSection,
    selectSceneCard,
    navigateScene,
    downloadVoice,
    regenerateVoice,
    isRunning: () => storyState.isRunning,
    // ใหม่: Concatenate & Resume functions
    getScenes,
    exportAndDownload,
    concatenateAllScenes,
    resumeFromLastScene
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStoryModeListeners);
  } else {
    initStoryModeListeners();
  }
}
