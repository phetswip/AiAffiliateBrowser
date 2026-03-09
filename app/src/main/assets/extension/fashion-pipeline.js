/**
 * fashion-pipeline.js — Fashion Mode Pipeline Orchestrator
 * Connects Fashion AI → Google Flow (image→video) → TikTok Post
 * Reuses same chrome.runtime messaging pattern as story-pipeline.js
 * Depends on: fashion-prompt.js, fashion-ai.js
 */
(function () {
    'use strict';

    /* ════════════════════════════════════════════
       STATE
       ════════════════════════════════════════════ */
    const fashionState = {
        flowTabId: null,
        scenes: [],
        config: {},
        stopped: false,
        isRunning: false,
        imagesCompleted: 0,
        videosCompleted: 0,
        currentPhase: '',

        // Loop
        loopEnabled: false,
        loopCount: 3,
        loopDelay: 30,
        loopIndex: 0,

        // Stats
        stats: {
            imagesCreated: 0,
            clipsCreated: 0,
            exportSuccess: 0,
            exportFailed: 0
        }
    };

    let logSeqCounter = 0;

    /* ════════════════════════════════════════════
       CHROME MESSAGE HELPERS (same as story-pipeline.js)
       ════════════════════════════════════════════ */

    function sendImageGenViaBackground(imagePrompt, sceneNum, projectUrl, referenceImages, timeout = 180000) {
        return new Promise((resolve, reject) => {
            const sceneRowId = `fashion_scene_${Date.now()}_${sceneNum}`;
            const timer = setTimeout(() => {
                chrome.runtime.onMessage.removeListener(listener);
                reject(new Error(`Timeout: Image Gen scene ${sceneNum}`));
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
                    reject(new Error(message.error || 'GEN ภาพล้มเหลว'));
                }
                if (message.type === 'VIDEO_GEN_STATUS' && message.data) {
                    addFashionLog(message.data.message || 'สถานะ', message.data.logType || 'info', sceneNum);
                }
            };
            chrome.runtime.onMessage.addListener(listener);

            const msgData = {
                rowId: sceneRowId,
                rowNumber: sceneNum,
                imagePrompt: imagePrompt,
                projectUrl: projectUrl || 'https://aistudio.google.com'
            };

            // Attach reference images (clothing + model)
            if (referenceImages && referenceImages.length > 0) {
                for (const ref of referenceImages) {
                    if (ref.type === 'character' && ref.base64) msgData.characterImageUrl = ref.base64;
                    if (ref.type === 'product' && ref.base64) msgData.productImageUrl = ref.base64;
                    if (ref.type === 'clothing' && ref.base64) msgData.productImageUrl = ref.base64;
                    if (ref.type === 'model' && ref.base64) msgData.characterImageUrl = ref.base64;
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

    function sendVideoGenViaBackground(videoPrompt, pictureUrl, sceneNum, projectUrl, timeout = 300000) {
        return new Promise((resolve, reject) => {
            const videoRowId = `fashion_video_${Date.now()}_${sceneNum}`;
            const timer = setTimeout(() => {
                chrome.runtime.onMessage.removeListener(listener);
                reject(new Error(`Timeout: Video Gen scene ${sceneNum}`));
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
                    reject(new Error(message.error || 'GEN วิดีโอล้มเหลว'));
                }
                if (message.type === 'VIDEO_GEN_STATUS' && message.data) {
                    addFashionLog(message.data.message || 'สถานะ Video Gen', message.data.logType || 'info', sceneNum);
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

    async function findFlowTab() {
        return new Promise((resolve) => {
            chrome.tabs.query({}, (tabs) => {
                const flowTab = tabs.find(t => t.url && t.url.includes('labs.google'));
                resolve(flowTab ? flowTab.id : null);
            });
        });
    }

    /* ════════════════════════════════════════════
       MAIN PIPELINE
       ════════════════════════════════════════════ */

    /**
     * Run the fashion pipeline
     * @param {Object} config
     * @param {Object} selectedScript - AI script with scenes array
     */
    async function runPipeline(config, selectedScript) {
        if (fashionState.isRunning) {
            addFashionLog('⚠️ Pipeline กำลังทำงานอยู่', 'warning');
            return;
        }

        fashionState.isRunning = true;
        fashionState.stopped = false;
        fashionState.config = config;
        fashionState.scenes = selectedScript.scenes;
        fashionState.imagesCompleted = 0;
        fashionState.videosCompleted = 0;
        logSeqCounter = 0;

        // Store stop flag in chrome.storage for content script to check
        chrome.storage.local.remove('fashion_stop_requested');

        const totalScenes = fashionState.scenes.length;
        addFashionLog(`🎬 เริ่ม Fashion Pipeline: ${selectedScript.title} (${totalScenes} ฉาก)`, 'success');

        // Show progress section
        const progressSection = document.getElementById('fashionProgressSection');
        if (progressSection) progressSection.style.display = 'block';
        updateFashionProgress('กำลังเตรียมการ...', 0);

        // Show stop button, hide run button
        const runBtn = document.getElementById('fashionRunBtn');
        const stopBtn = document.getElementById('fashionStopBtn');
        if (runBtn) runBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'block';

        // Build reference images
        const refImages = [];
        if (config.clothingImageBase64) {
            refImages.push({ type: 'clothing', base64: config.clothingImageBase64 });
        }
        if (config.modelImageBase64) {
            refImages.push({ type: 'model', base64: config.modelImageBase64 });
        }

        const videoUrls = [];

        try {
            // ═══ PHASE 1: Generate Images ═══
            fashionState.currentPhase = 'creating_images';
            addFashionLog('📷 Phase 1: สร้างรูปภาพ...', 'info');

            for (let i = 0; i < totalScenes; i++) {
                if (fashionState.stopped) throw new Error('หยุดโดยผู้ใช้');

                const scene = fashionState.scenes[i];
                const sceneNum = i + 1;
                addFashionLog(`📷 สร้างรูป Scene ${sceneNum}: ${scene.scene_name || ''}`, 'info', sceneNum);
                updateFashionProgress(`สร้างรูป Scene ${sceneNum}/${totalScenes}`, (i / totalScenes) * 40);

                try {
                    const result = await sendImageGenViaBackground(
                        scene.image_prompt,
                        sceneNum,
                        config.projectUrl || null,
                        refImages
                    );

                    scene._imageUrl = result.pictureUrl || result.imageUrl;
                    fashionState.imagesCompleted++;
                    addFashionLog(`✅ รูป Scene ${sceneNum} สำเร็จ`, 'success', sceneNum);
                } catch (err) {
                    addFashionLog(`❌ รูป Scene ${sceneNum} ล้มเหลว: ${err.message}`, 'error', sceneNum);
                    throw err;
                }
            }

            // ═══ PHASE 2: Generate Videos ═══
            fashionState.currentPhase = 'creating_videos';
            addFashionLog('🎬 Phase 2: สร้างวิดีโอ...', 'info');

            for (let i = 0; i < totalScenes; i++) {
                if (fashionState.stopped) throw new Error('หยุดโดยผู้ใช้');

                const scene = fashionState.scenes[i];
                const sceneNum = i + 1;
                if (!scene._imageUrl) {
                    addFashionLog(`⏭ ข้าม Video Scene ${sceneNum} (ไม่มีรูป)`, 'warning', sceneNum);
                    continue;
                }

                addFashionLog(`🎬 สร้างวิดีโอ Scene ${sceneNum}: ${scene.scene_name || ''}`, 'info', sceneNum);
                updateFashionProgress(`สร้างวิดีโอ Scene ${sceneNum}/${totalScenes}`, 40 + (i / totalScenes) * 40);

                try {
                    const result = await sendVideoGenViaBackground(
                        scene.video_prompt,
                        scene._imageUrl,
                        sceneNum,
                        config.projectUrl || null
                    );

                    scene._videoUrl = result.videoUrl;
                    videoUrls.push(result.videoUrl);
                    fashionState.videosCompleted++;
                    addFashionLog(`✅ วิดีโอ Scene ${sceneNum} สำเร็จ`, 'success', sceneNum);
                } catch (err) {
                    addFashionLog(`❌ วิดีโอ Scene ${sceneNum} ล้มเหลว: ${err.message}`, 'error', sceneNum);
                    throw err;
                }
            }

            // ═══ PHASE 3: Export ═══
            fashionState.currentPhase = 'exporting';
            updateFashionProgress('กำลัง Export...', 85);

            if (videoUrls.length === 0) {
                throw new Error('ไม่มีวิดีโอที่สร้างสำเร็จ');
            }

            // Generate caption
            const FP = window.__fashionPrompt;
            const caption = FP ? FP.buildCaption({
                productName: config.productName || config.clothingDesc,
                price: config.price,
                extraCaption: config.extraCaption
            }) : '';

            // Determine posting method
            const postMethod = config.postTiktok || 'download';

            if (postMethod === 'auto' && videoUrls.length > 0) {
                // Post to TikTok via background.js
                addFashionLog('📤 กำลังส่งวิดีโอไป TikTok...', 'info');
                updateFashionProgress('กำลังส่ง TikTok...', 90);

                // Store video data for TikTok posting
                const videoUrl = videoUrls.length === 1 ? videoUrls[0] : videoUrls[videoUrls.length - 1];

                chrome.runtime.sendMessage({
                    type: 'FASHION_POST_TIKTOK',
                    data: {
                        videoUrl: videoUrl,
                        videoUrls: videoUrls,
                        caption: caption,
                        sceneCount: totalScenes,
                        postMode: 'publish'
                    }
                });

                addFashionLog('✅ ส่งไป TikTok สำเร็จ', 'success');
            } else {
                // Download
                addFashionLog('📥 กำลังดาวน์โหลดวิดีโอ...', 'info');
                for (const url of videoUrls) {
                    try {
                        chrome.runtime.sendMessage({
                            type: 'DOWNLOAD_VIDEO',
                            data: { videoUrl: url, filename: `fashion_${config.subMode}_${Date.now()}.mp4` }
                        });
                    } catch (e) {
                        // Try direct download
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `fashion_${config.subMode}_${Date.now()}.mp4`;
                        a.click();
                    }
                }
                addFashionLog('✅ ดาวน์โหลดสำเร็จ', 'success');
            }

            updateFashionProgress('✅ เสร็จสิ้น!', 100);
            fashionState.stats.exportSuccess++;
            addFashionLog(`🎉 Fashion Pipeline เสร็จสิ้น! (${totalScenes} ฉาก, ${videoUrls.length} วิดีโอ)`, 'success');

        } catch (err) {
            if (err.message === 'หยุดโดยผู้ใช้') {
                addFashionLog('⏹ หยุดโดยผู้ใช้', 'warning');
                updateFashionProgress('หยุดแล้ว', fashionState.videosCompleted / totalScenes * 100);
            } else {
                addFashionLog(`❌ Pipeline ล้มเหลว: ${err.message}`, 'error');
                updateFashionProgress('❌ ล้มเหลว', 0);
                fashionState.stats.exportFailed++;
            }
        } finally {
            fashionState.isRunning = false;
            // Swap buttons back
            if (runBtn) runBtn.style.display = 'block';
            if (stopBtn) stopBtn.style.display = 'none';
        }

        // ═══ LOOP ═══
        if (fashionState.loopEnabled && !fashionState.stopped) {
            fashionState.loopIndex++;
            const remaining = fashionState.loopCount - fashionState.loopIndex;
            if (remaining > 0) {
                addFashionLog(`🔁 Loop ${fashionState.loopIndex}/${fashionState.loopCount} — รอ ${fashionState.loopDelay}s...`, 'info');
                updateFashionProgress(`Loop ${fashionState.loopIndex}/${fashionState.loopCount} — รอ...`, 0);

                await _sleep(fashionState.loopDelay * 1000);

                if (!fashionState.stopped) {
                    return runPipeline(config, selectedScript);
                }
            } else {
                addFashionLog(`🔁 Loop เสร็จสิ้น (${fashionState.loopCount} rounds)`, 'success');
            }
        }
    }

    /**
     * Stop the pipeline
     */
    function stopPipeline() {
        fashionState.stopped = true;
        chrome.storage.local.set({ fashion_stop_requested: true });
        addFashionLog('⏹ กำลังหยุด...', 'warning');
    }

    /**
     * Reset everything
     */
    function resetPipeline() {
        fashionState.flowTabId = null;
        fashionState.scenes = [];
        fashionState.config = {};
        fashionState.stopped = false;
        fashionState.isRunning = false;
        fashionState.imagesCompleted = 0;
        fashionState.videosCompleted = 0;
        fashionState.currentPhase = '';
        fashionState.loopEnabled = false;
        fashionState.loopCount = 3;
        fashionState.loopDelay = 30;
        fashionState.loopIndex = 0;
        fashionState.stats = { imagesCreated: 0, clipsCreated: 0, exportSuccess: 0, exportFailed: 0 };
        logSeqCounter = 0;

        chrome.storage.local.remove('fashion_stop_requested');
        addFashionLog('🔄 Reset ทุกอย่างแล้ว', 'info');
    }

    /* ════════════════════════════════════════════
       PROGRESS UI
       ════════════════════════════════════════════ */

    function updateFashionProgress(status, percent) {
        const statusEl = document.getElementById('fashionProgressStatus');
        const barEl = document.getElementById('fashionProgressBar');
        const imgEl = document.getElementById('fashionImageProgress');
        const vidEl = document.getElementById('fashionVideoProgress');

        if (statusEl) statusEl.textContent = status;
        if (barEl) barEl.style.width = percent + '%';
        if (imgEl) imgEl.textContent = `${fashionState.imagesCompleted}/${fashionState.scenes.length}`;
        if (vidEl) vidEl.textContent = `${fashionState.videosCompleted}/${fashionState.scenes.length}`;
    }

    function addFashionLog(message, type = 'info', sceneNumber = null) {
        logSeqCounter++;
        console.log(`[Fashion][${type}]${sceneNumber ? `[Scene ${sceneNumber}]` : ''} ${message}`);

        const logContainer = document.getElementById('fashionLogContainer');
        if (logContainer) {
            const typeColors = {
                info: '#9ca3af',
                success: '#a78bfa',
                error: '#ef4444',
                warning: '#f59e0b'
            };
            const msgColor = typeColors[type] || typeColors.info;
            const time = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const logEntry = document.createElement('div');
            logEntry.style.cssText = 'font-size: 12px; padding: 4px 8px; line-height: 1.6;';
            const sceneTag = sceneNumber ? `<span style="color: #9ca3af;"> [Scene ${sceneNumber}]</span>` : '';
            logEntry.innerHTML = `<span style="font-weight: 600; color: #a78bfa; margin-right: 6px;">#${logSeqCounter}</span><span style="color: #9ca3af;">${time}</span>${sceneTag}<span style="margin-left: 6px; color: ${msgColor};">${message}</span>`;

            // Remove placeholder
            if (logContainer.children.length === 1 &&
                (logContainer.firstChild.textContent?.includes('รอคำสั่ง') || logContainer.firstChild.textContent?.includes('No activity'))) {
                logContainer.innerHTML = '';
                logSeqCounter = 1;
            }

            logContainer.insertBefore(logEntry, logContainer.firstChild);
        }
    }

    function _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /* ════════════════════════════════════════════
       EXPORTS
       ════════════════════════════════════════════ */
    window.__fashionPipeline = {
        state: fashionState,
        runPipeline: runPipeline,
        stopPipeline: stopPipeline,
        resetPipeline: resetPipeline,
        findFlowTab: findFlowTab,
        updateFashionProgress: updateFashionProgress,
        addFashionLog: addFashionLog
    };

    console.log('[Fashion] Pipeline orchestrator loaded');
})();
