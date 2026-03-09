// ========================================================
// AI LIVE Dashboard — UI Controller v1.0
// ========================================================

(function () {
    'use strict';

    // ========== State ==========
    const state = {
        connected: false,
        liveTabId: null,
        isLive: false,
        autoReply: false,
        autoScript: false,
        comments: [],
        commentCount: 0,
        replyCount: 0,
        liveStartTime: null,
        scriptLines: [],
        currentScriptLine: 0,
        durationTimer: null,
        products: [],
        selectedProductIds: []
    };

    // ========== DOM Elements ==========
    const $ = id => document.getElementById(id);

    const connectionDot = $('connectionDot');
    const connectionStatus = $('connectionStatus');
    const liveStatus = $('liveStatus');
    const statDuration = $('statDuration');
    const statComments = $('statComments');
    const statReplies = $('statReplies');
    const commentList = $('commentList');
    const logArea = $('logArea');

    // ========== Logging ==========
    function addLog(msg, type = 'info') {
        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        const time = new Date().toLocaleTimeString('th-TH');
        line.textContent = `[${time}] ${msg}`;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;

        // Keep max 100 entries
        while (logArea.children.length > 100) {
            logArea.removeChild(logArea.firstChild);
        }
    }

    // ========== Connection ==========
    async function findLiveTab() {
        return new Promise(resolve => {
            chrome.tabs.query({ url: ['https://shop.tiktok.com/*'] }, tabs => {
                const liveTab = tabs.find(t =>
                    t.url.includes('streamer/live') || t.url.includes('live/product')
                );
                resolve(liveTab || null);
            });
        });
    }

    async function connectToLiveTab() {
        addLog('🔍 กำลังค้นหาหน้า TikTok Shop LIVE...', 'info');

        const tab = await findLiveTab();
        if (tab) {
            state.liveTabId = tab.id;
            state.connected = true;
            connectionDot.className = 'status-dot connected';
            connectionStatus.textContent = `✅ เชื่อมต่อแล้ว — Tab: ${tab.title?.substring(0, 40)}`;
            addLog(`เชื่อมต่อ Tab ID: ${tab.id}`, 'success');
            return true;
        } else {
            connectionDot.className = 'status-dot error';
            connectionStatus.textContent = '❌ ไม่พบหน้า TikTok Shop LIVE — กรุณาเปิด shop.tiktok.com';
            addLog('ไม่พบหน้า TikTok Shop LIVE', 'error');
            return false;
        }
    }

    async function sendToLiveTab(message, retries = 3, timeout = 15000) {
        if (!state.liveTabId) {
            addLog('ยังไม่ได้เชื่อมต่อหน้า LIVE', 'error');
            return null;
        }

        // สร้าง unique request ID เพื่อจับ response กลับ
        const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        message._requestId = requestId;

        for (let attempt = 1; attempt <= retries; attempt++) {
            const result = await new Promise(resolve => {
                let responded = false;

                // ฟัง response จาก content script ผ่าน broadcast
                const responseListener = (msg) => {
                    if (msg.type === 'LIVE_RESPONSE' && msg._requestId === requestId) {
                        responded = true;
                        chrome.runtime.onMessage.removeListener(responseListener);
                        resolve({ success: true, data: msg.data });
                    }
                };
                chrome.runtime.onMessage.addListener(responseListener);

                // ส่ง message ไป content script
                chrome.tabs.sendMessage(state.liveTabId, message, { frameId: 0 }, () => {
                    // ไม่สนใจ sendResponse — ใช้ broadcast แทน
                    if (chrome.runtime.lastError) {
                        // message ไม่ถึง content script เลย
                    }
                });

                // Timeout
                setTimeout(() => {
                    if (!responded) {
                        chrome.runtime.onMessage.removeListener(responseListener);
                        resolve({ error: 'timeout' });
                    }
                }, timeout);
            });

            if (result.success) {
                return result.data;
            }

            // Connection failed — try to re-inject content script
            if (attempt < retries) {
                addLog(`🔄 Retry ${attempt}/${retries} — กำลัง inject content script...`, 'warning');
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: state.liveTabId },
                        func: () => { window.__TIKTOK_LIVE_SCRIPT_LOADED__ = false; }
                    });
                    await chrome.scripting.executeScript({
                        target: { tabId: state.liveTabId },
                        files: ['tiktok-live-content-script.js']
                    });
                    await new Promise(r => setTimeout(r, 2000));
                } catch (e) {
                    addLog(`⚠️ Inject failed: ${e.message}`, 'warning');
                    await new Promise(r => setTimeout(r, 1000));
                }
            } else {
                addLog(`❌ ไม่สามารถเชื่อมต่อได้หลังจาก ${retries} ครั้ง — ลองรีโหลดหน้า LIVE`, 'error');
                return null;
            }
        }
        return null;
    }

    // ========== Actions ==========

    async function discoverPage() {
        addLog('🔍 สำรวจ DOM ของหน้า LIVE...', 'step');
        const connected = await connectToLiveTab();
        if (!connected) return;

        const result = await sendToLiveTab({ type: 'LIVE_DISCOVER' });
        if (result?.success) {
            const el = result.data.elements;
            const debug = result.data.debug;

            addLog(`📊 ผลสำรวจ:`, 'info');
            addLog(`  ปุ่ม Go LIVE: ${el.startButton ? '✅ "' + el.startButtonText + '"' : '❌'}`, el.startButton ? 'success' : 'warning');
            addLog(`  Chat Input: ${el.chatInput ? '✅ "' + (el.chatInputPlaceholder || '') + '"' : '❌'}`, el.chatInput ? 'success' : 'warning');
            addLog(`  Add Products: ${el.addProductsButton ? '✅' : '❌'}`, el.addProductsButton ? 'success' : 'warning');
            addLog(`  Add Script: ${el.addScriptButton ? '✅' : '❌'}`, el.addScriptButton ? 'success' : 'warning');
            addLog(`  Video: ${el.videoPreview ? '✅' : '❌'}`, el.videoPreview ? 'success' : 'warning');
            addLog(`  Inputs: ${debug.inputCount}, Buttons: ${debug.buttonCount}`, 'info');

            // Log all buttons for debugging
            if (debug.buttons) {
                addLog(`📋 ปุ่มทั้งหมดที่พบ:`, 'info');
                debug.buttons.forEach((btn, i) => {
                    addLog(`  [${i}] "${btn.text}" ${btn.disabled ? '(disabled)' : ''}`, 'info');
                });
            }

            // Log all inputs for debugging
            if (debug.inputs) {
                addLog(`📋 Input ทั้งหมดที่พบ:`, 'info');
                debug.inputs.forEach((inp, i) => {
                    addLog(`  [${i}] <${inp.tag}> placeholder="${inp.placeholder}" id="${inp.id}"`, 'info');
                });
            }
        } else {
            addLog('สำรวจ DOM ล้มเหลว', 'error');
        }
    }

    async function startLive() {
        const selectedIds = state.selectedProductIds.length > 0 ? state.selectedProductIds : [];

        // ขั้น 1: เพิ่มสินค้า (ถ้ามี)
        if (selectedIds.length > 0) {
            addLog(`📦 ขั้นที่ 1: เพิ่มสินค้า ${selectedIds.length} รายการ...`, 'step');

            const addResult = await sendToLiveTab({
                type: 'LIVE_SELECT_PRODUCTS',
                productIds: selectedIds
            });

            if (addResult?.success) {
                addLog(`✅ เพิ่มสินค้าสำเร็จ!`, 'success');
            } else {
                addLog('⚠️ เพิ่มสินค้าไม่สำเร็จ — ลองกด Go LIVE ต่อ', 'warning');
            }

            // รอ dialog ปิดเรียบร้อย
            await new Promise(r => setTimeout(r, 2000));
        } else {
            addLog('ℹ️ ไม่ได้เลือกสินค้า — ข้ามไปกด Go LIVE', 'info');
        }

        // ขั้น 2: กด Go LIVE
        addLog('🔴 ขั้นที่ 2: กด Go LIVE...', 'step');

        const liveResult = await sendToLiveTab({ type: 'LIVE_START' });

        if (liveResult?.success) {
            state.isLive = true;
            state.liveStartTime = Date.now();
            liveStatus.style.display = 'inline-flex';
            connectionDot.className = 'status-dot live';
            startDurationTimer();
            addLog('🔴 กด Go LIVE แล้ว — กรุณาเลือกกล้อง/ไมค์ แล้วกด Go LIVE อีกครั้งในหน้า TikTok', 'success');
        } else {
            addLog('❌ กด Go LIVE ไม่สำเร็จ — ลองกดเองในหน้า TikTok', 'error');
        }
    }

    async function endLive() {
        const result = await sendToLiveTab({ type: 'LIVE_END' });
        state.isLive = false;
        state.liveStartTime = null;
        liveStatus.style.display = 'none';
        connectionDot.className = 'status-dot connected';
        stopDurationTimer();
        addLog('⏹ จบ LIVE แล้ว', 'success');
    }

    async function sendChat() {
        const input = $('manualReply');
        const message = input.value.trim();
        if (!message) return;

        const result = await sendToLiveTab({ type: 'LIVE_SEND_CHAT', message });
        if (result?.success) {
            input.value = '';
            addLog(`💬 ส่งข้อความ: "${message}"`, 'success');
        } else {
            addLog('ส่งข้อความไม่สำเร็จ', 'error');
        }
    }

    // ========== Comments ==========
    function addComment(comment) {
        state.comments.push(comment);
        state.commentCount++;
        statComments.textContent = state.commentCount;

        // ลบ placeholder
        if (commentList.children.length === 1 && commentList.firstChild.style.color) {
            commentList.innerHTML = '';
        }

        const item = document.createElement('div');
        item.className = 'comment-item';

        const time = new Date(comment.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        item.innerHTML = `
      <span class="comment-user">${escapeHtml(comment.username)}</span>
      <span class="comment-text">${escapeHtml(comment.text)}</span>
      <span class="comment-time">${time}</span>
    `;

        commentList.appendChild(item);
        commentList.scrollTop = commentList.scrollHeight;

        // Keep max 50 items
        while (commentList.children.length > 50) {
            commentList.removeChild(commentList.firstChild);
        }

        // Auto reply ถ้าเปิดอยู่
        if (state.autoReply) {
            handleAutoReply(comment);
        }
    }

    async function handleAutoReply(comment) {
        // ใช้ Gemini/OpenAI สร้างคำตอบ
        try {
            const systemPrompt = 'คุณเป็นผู้ช่วยตอบคอมเมนต์ระหว่าง LIVE ขายของ ตอบสั้นๆ เป็นภาษาไทย ใช้คำลงท้ายสุภาพ (ค่ะ/ครับ) ให้เป็นมิตร ห้ามพิมพ์ยาวเกิน 2 ประโยค';
            const userPrompt = `คอมเมนต์จาก "${comment.username}": "${comment.text}"\n\nตอบสั้นๆ:`;

            let reply = '';

            // ═══════ AAA Proxy — try managed subscription first ═══════
            if (typeof window !== 'undefined' && window.__aaa_proxy) {
                try {
                    const subscribed = await window.__aaa_proxy.isSubscribed();
                    if (subscribed) {
                        console.log('[AI Live] Auto Reply using AAA proxy...');
                        const payload = {
                            model: 'gpt-4o-mini',
                            messages: [
                                { role: 'system', content: systemPrompt },
                                { role: 'user', content: userPrompt }
                            ],
                            max_tokens: 100
                        };
                        const proxyResult = await window.__aaa_proxy.proxyAICall('openai', 'gpt-4o-mini', payload);
                        if (proxyResult) {
                            reply = proxyResult.choices?.[0]?.message?.content?.trim() || '';
                        }
                    }
                } catch (proxyErr) {
                    console.warn('[AI Live] Proxy failed, falling back to direct:', proxyErr.message);
                }
            }

            // ═══════ Direct API fallback ═══════
            if (!reply) {
                const config = await new Promise(resolve => {
                    chrome.storage.local.get(['apiProvider', 'apiKey', 'geminiApiKey'], resolve);
                });

                const apiKey = config.geminiApiKey || config.apiKey;
                if (!apiKey) {
                    addLog('ไม่มี API Key สำหรับ Auto Reply', 'warning');
                    return;
                }

                if (config.apiProvider === 'openai' && config.apiKey) {
                    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
                        body: JSON.stringify({
                            model: 'gpt-4o-mini',
                            messages: [
                                { role: 'system', content: systemPrompt },
                                { role: 'user', content: userPrompt }
                            ],
                            max_tokens: 100
                        })
                    });
                    const data = await resp.json();
                    reply = data.choices?.[0]?.message?.content?.trim() || '';
                } else if (apiKey) {
                    // Gemini
                    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
                            }]
                        })
                    });
                    const data = await resp.json();
                    reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                }
            }

            if (reply) {
                await sendToLiveTab({ type: 'LIVE_SEND_CHAT', message: reply });
                state.replyCount++;
                statReplies.textContent = state.replyCount;
                addLog(`🤖 Auto Reply → ${comment.username}: "${reply}"`, 'success');
            }
        } catch (err) {
            addLog(`Auto Reply Error: ${err.message}`, 'error');
        }
    }

    // ========== Timer ==========
    function startDurationTimer() {
        stopDurationTimer();
        state.durationTimer = setInterval(() => {
            if (!state.liveStartTime) return;
            const elapsed = Math.floor((Date.now() - state.liveStartTime) / 1000);
            const h = Math.floor(elapsed / 3600);
            const m = Math.floor((elapsed % 3600) / 60);
            const s = elapsed % 60;
            statDuration.textContent = h > 0
                ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }, 1000);
    }

    function stopDurationTimer() {
        if (state.durationTimer) {
            clearInterval(state.durationTimer);
            state.durationTimer = null;
        }
    }

    // ========== Helpers ==========
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== Toggle Switches ==========
    function setupToggle(id, callback) {
        const el = $(id);
        el.addEventListener('click', () => {
            el.classList.toggle('active');
            callback(el.classList.contains('active'));
        });
    }

    // ========== Product Functions ==========
    async function scrapeProducts() {
        const maxPages = parseInt($('scrapePages').value) || 5;
        const scrapeTimeout = 15000 + (maxPages * 5000); // 15s base + 5s per page
        addLog(`📦 กำลังดึงรายการสินค้า (${maxPages} หน้า)...`, 'step');

        const connected = await connectToLiveTab();
        if (!connected) return;

        const result = await sendToLiveTab({ type: 'LIVE_SCRAPE_PRODUCTS', maxPages }, 2, scrapeTimeout);
        if (result?.success && result.products) {
            state.products = result.products;
            renderProductList();
            addLog(`📦 พบสินค้า ${result.products.length} รายการ`, 'success');
        } else {
            addLog('ดึงสินค้าไม่สำเร็จ — ลองกด "🔍 สำรวจหน้า LIVE" ก่อน', 'error');
        }
    }

    function renderProductList() {
        const productList = $('productList');
        productList.innerHTML = '';

        if (state.products.length === 0) {
            productList.innerHTML = '<div style="color:#666;font-size:12px;padding:8px;">ไม่พบสินค้า</div>';
            $('productCount').textContent = '';
            return;
        }

        $('productCount').textContent = `(${state.selectedProductIds.length}/${state.products.length})`;

        state.products.forEach((product, i) => {
            const item = document.createElement('div');
            item.className = `product-item ${state.selectedProductIds.includes(product.id) ? 'selected' : ''}`;

            const isChecked = state.selectedProductIds.includes(product.id) ? 'checked' : '';

            item.innerHTML = `
                <input type="checkbox" data-product-id="${product.id}" ${isChecked}>
                ${product.imageUrl
                    ? `<img class="product-img" src="${product.imageUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="product-img-placeholder" style="display:none">📦</div>`
                    : `<div class="product-img-placeholder">📦</div>`
                }
                <div class="product-info">
                    <div class="product-name" title="${escapeHtml(product.name)}">${escapeHtml(product.name || 'สินค้า ' + (i + 1))}</div>
                    <div class="product-meta">
                        ${product.price ? `<span class="product-price">฿${product.price}</span>` : ''}
                        ${product.stock ? `<span class="product-stock">stock: ${product.stock}</span>` : ''}
                    </div>
                </div>
            `;

            // Click on item toggles checkbox
            item.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                const cb = item.querySelector('input[type="checkbox"]');
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change'));
            });

            // Checkbox change
            const cb = item.querySelector('input[type="checkbox"]');
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    if (!state.selectedProductIds.includes(product.id)) {
                        state.selectedProductIds.push(product.id);
                    }
                    item.classList.add('selected');
                } else {
                    state.selectedProductIds = state.selectedProductIds.filter(id => id !== product.id);
                    item.classList.remove('selected');
                }
                $('productCount').textContent = `(${state.selectedProductIds.length}/${state.products.length})`;
            });

            productList.appendChild(item);
        });
    }

    // ========== Event Listeners ==========
    $('btnDiscover').addEventListener('click', discoverPage);
    $('btnStartLive').addEventListener('click', startLive);
    $('btnEndLive').addEventListener('click', endLive);
    $('btnSendChat').addEventListener('click', sendChat);
    $('btnScrapeProducts').addEventListener('click', scrapeProducts);

    $('selectAllProducts').addEventListener('change', (e) => {
        if (e.target.checked) {
            state.selectedProductIds = state.products.map(p => p.id);
        } else {
            state.selectedProductIds = [];
        }
        renderProductList();
    });
    $('manualReply').addEventListener('keydown', e => {
        if (e.key === 'Enter') sendChat();
    });

    setupToggle('toggleAutoReply', active => {
        state.autoReply = active;
        addLog(`Auto Reply: ${active ? 'เปิด ✅' : 'ปิด ❌'}`, active ? 'success' : 'info');
    });

    setupToggle('toggleAutoScript', active => {
        state.autoScript = active;
        addLog(`Auto Script: ${active ? 'เปิด ✅' : 'ปิด ❌'}`, active ? 'success' : 'info');
        if (active) startAutoScript();
    });

    // ========== AI Avatar Functions ==========

    // Avatar upload state
    state.avatarImage = null; // base64
    state.avatarGenerated = null; // generated UGC image base64
    state.generatedScript = '';
    state.didApiKey = localStorage.getItem('didApiKey') || '';
    state.didConnected = false;

    // Avatar upload
    $('avatarUploadArea').addEventListener('click', () => $('avatarFileInput').click());
    $('avatarFileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            state.avatarImage = ev.target.result;
            $('avatarPreviewImg').src = state.avatarImage;
            $('avatarPreviewImg').style.display = 'block';
            $('avatarPlaceholder').style.display = 'none';
            $('avatarUploadArea').classList.add('has-image');
            addLog('📷 อัพโหลดรูป Avatar สำเร็จ', 'success');
        };
        reader.readAsDataURL(file);
    });

    // D-ID API connection
    if (state.didApiKey) $('didApiKey').value = state.didApiKey;
    $('btnConnectServer').addEventListener('click', async () => {
        const key = $('didApiKey').value.trim();
        if (!key) {
            addLog('⚠️ กรุณาใส่ D-ID API Key', 'warning');
            return;
        }
        state.didApiKey = key;
        localStorage.setItem('didApiKey', key);
        addLog('🔗 กำลังตรวจสอบ D-ID API Key...', 'step');

        try {
            const resp = await fetch('https://api.d-id.com/credits', {
                headers: { 'Authorization': `Basic ${key}`, 'Accept': 'application/json' },
                signal: AbortSignal.timeout(10000)
            });
            if (resp.ok) {
                const data = await resp.json();
                state.didConnected = true;
                $('serverDot').classList.add('connected');
                const remaining = data.remaining || 'N/A';
                addLog(`✅ D-ID เชื่อมต่อแล้ว (เครดิตเหลือ: ${remaining})`, 'success');
            } else if (resp.status === 401) {
                throw new Error('API Key ไม่ถูกต้อง');
            } else {
                throw new Error(`Error: ${resp.status}`);
            }
        } catch (err) {
            state.didConnected = false;
            $('serverDot').classList.remove('connected');
            addLog(`❌ D-ID เชื่อมต่อไม่ได้: ${err.message}`, 'error');
        }
    });

    // Generate Script (Chinese-style)
    $('btnGenerateScript').addEventListener('click', async () => {
        const selectedProducts = state.products.filter(p => state.selectedProductIds.includes(p.id));
        if (selectedProducts.length === 0) {
            addLog('⚠️ เลือกสินค้าก่อนสร้าง Script', 'warning');
            return;
        }

        addLog(`📝 กำลังสร้าง Script จีน (${selectedProducts.length} สินค้า)...`, 'step');

        const productList = selectedProducts.map(p =>
            `- ${p.name} (ราคา ฿${p.price || '??'}, stock: ${p.stock || '??'})`
        ).join('\n');

        const prompt = `คุณเป็นนักขายไลฟ์สดมืออาชีพสไตล์จีน (Chinese LIVE selling expert)
สินค้าที่ต้องขาย:
${productList}

สร้าง script ขายของแบบไลฟ์สดภาษาไทย ใช้กลยุทธ์จีน ตามลำดับนี้:
1. [00:00] HOOK — ดึงดูดคนดู กระตุ้นความอยากรู้ (30วินาที)
2. [00:30] PAIN POINT — พูดถึงปัญหาที่คนเจอ (1นาที)
3. [01:30] SOLUTION — แนะนำสินค้าแก้ปัญหา (1.5นาที)
4. [03:00] DEMO — โชว์สินค้า อธิบายรายละเอียด (2นาที)
5. [05:00] SOCIAL PROOF — รีวิว ยอดขาย ความน่าเชื่อถือ (1นาที)
6. [06:00] URGENCY — จำนวนจำกัด นับถอยหลัง (1นาที)
7. [07:00] CTA — สั่งซื้อเลย กดตะกร้า (30วินาที)
8. [07:30] วนซ้ำกับสินค้าถัดไป

ใช้ภาษาไทยพูดกันเอง สนุก กระตุ้นอยากซื้อ เหมือนคนไลฟ์สดจริงๆ
ใส่อิโมจิ 🔥 ✨ 💰 ให้ดูสนุก
Format: [เวลา] (Phase) text...`;

        // Try AAA Proxy first, then direct Gemini API
        try {
            let scriptText = '';

            // ═══════ AAA Proxy — try managed subscription first ═══════
            if (typeof window !== 'undefined' && window.__aaa_proxy) {
                try {
                    const subscribed = await window.__aaa_proxy.isSubscribed();
                    if (subscribed) {
                        console.log('[AI Live] Script gen using AAA proxy...');
                        const payload = {
                            contents: [{ parts: [{ text: prompt }] }]
                        };
                        const proxyResult = await window.__aaa_proxy.proxyAICall('gemini', 'gemini-2.0-flash', payload);
                        if (proxyResult) {
                            scriptText = proxyResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        }
                    }
                } catch (proxyErr) {
                    console.warn('[AI Live] Proxy failed, falling back to direct:', proxyErr.message);
                }
            }

            // ═══════ Direct API fallback ═══════
            if (!scriptText) {
                const apiKey = await getGeminiApiKey();
                if (!apiKey) {
                    addLog('❌ ไม่พบ Gemini API Key', 'error');
                    return;
                }

                const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                });

                const data = await resp.json();
                scriptText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            }

            if (scriptText) {
                state.generatedScript = scriptText;
                $('scriptPreview').textContent = scriptText;
                $('scriptPreview').style.display = 'block';
                // Also put in the LIVE script textarea
                $('liveScript').value = scriptText.replace(/\[\d{2}:\d{2}\]\s*\([^)]+\)\s*/g, '');
                addLog(`✅ สร้าง Script สำเร็จ (${scriptText.split('\n').length} บรรทัด)`, 'success');
            } else {
                addLog('❌ ไม่ได้รับ Script กลับมา', 'error');
            }
        } catch (err) {
            addLog(`❌ สร้าง Script ไม่สำเร็จ: ${err.message}`, 'error');
        }
    });

    // Helper: get Gemini API key from storage (match other modules using localStorage)
    async function getGeminiApiKey() {
        // First try localStorage (where Settings page saves it)
        try {
            let raw = localStorage.getItem('geminiApiKey');
            if (raw) {
                try { return JSON.parse(raw) || null; } catch (e) { return raw; }
            }
            raw = localStorage.getItem('apiKey');
            if (raw) {
                try { return JSON.parse(raw) || null; } catch (e) { return raw; }
            }
        } catch (e) { }
        // Fallback to chrome.storage.local
        return new Promise(resolve => {
            chrome.storage.local.get(['geminiApiKey', 'apiKey'], (result) => {
                resolve(result.geminiApiKey || result.apiKey || null);
            });
        });
    }

    // Helper: find Google Labs/Flow tab
    async function findFlowTab() {
        return new Promise(resolve => {
            chrome.tabs.query({}, tabs => {
                const flowTab = tabs.find(t => t.url && t.url.includes('labs.google'));
                resolve(flowTab ? flowTab.id : null);
            });
        });
    }

    // Helper: send message to Flow tab (same pattern as story-pipeline.js)
    function sendToFlowTab(flowTabId, action, params = {}, timeout = 180000) {
        return new Promise((resolve, reject) => {
            const message = { action, ...params };
            const timer = setTimeout(() => reject(new Error(`Timeout: ${action}`)), timeout);
            chrome.tabs.sendMessage(flowTabId, message, response => {
                clearTimeout(timer);
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(response);
            });
        });
    }

    // Generate UGC Avatar Image — ใช้ Flow tab เหมือน Story Mode
    $('btnGenerateAvatar').addEventListener('click', async () => {
        if (!state.avatarImage) {
            addLog('⚠️ อัพโหลดรูปนายแบบ/นางแบบก่อน', 'warning');
            return;
        }

        // 1. หา Flow tab
        const flowTabId = await findFlowTab();
        if (!flowTabId) {
            addLog('❌ ต้องเปิด Google Labs (labs.google) ไว้ก่อน', 'error');
            addLog('💡 เปิดแท็บ https://labs.google/fx/tools/image-fx แล้วลองใหม่', 'info');
            return;
        }

        const selectedProducts = state.products.filter(p => state.selectedProductIds.includes(p.id));
        const productNames = selectedProducts.map(p => p.name).join(', ') || 'สินค้าทั่วไป';

        // สร้าง referenceImages: avatar + สินค้าแรก (Flow รองรับ max ~2 ingredients)
        const referenceImages = [];

        // Avatar เป็น character reference
        referenceImages.push({
            type: 'character',
            name: 'นายแบบ/นางแบบ ไลฟ์สด',
            base64: state.avatarImage
        });

        // สินค้าที่เลือกเป็น product reference (แปลง URL เป็น base64)
        for (const product of selectedProducts) {
            if (product.imageUrl) {
                try {
                    addLog(`📦 กำลังโหลดรูปสินค้า: ${product.name.substring(0, 30)}...`, 'info');
                    const resp = await fetch(product.imageUrl);
                    const blob = await resp.blob();
                    const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    referenceImages.push({
                        type: 'product',
                        name: product.name,
                        base64: base64
                    });
                } catch (e) {
                    addLog(`⚠️ โหลดรูปสินค้าไม่ได้: ${product.name.substring(0, 20)}`, 'warning');
                }
            }
        }

        // Prompt: ไลฟ์สดขายของ แบบธรรมชาติ ไม่ต้องมี overlay TikTok
        const avatarPrompt = `A realistic photo of the person from the uploaded reference photo (MUST look exactly like the reference person — same face, same features), sitting at a desk doing a product livestream sale. The person is smiling naturally, looking directly at the camera, holding or presenting the products: ${productNames}. The products from the uploaded product photos must appear exactly as they are — same packaging, same design, same colors. Casual home studio setup with ring light behind, warm indoor lighting, slightly messy desk with products laid out. There are Thai language sale signs and banners visible in the scene such as "ลดราคาพิเศษ!", "โปรโมชั่นวันนี้เท่านั้น!", "ของแท้ 100%", "ส่งฟรี", "สั่งเลย!". All text in the image must be in Thai language only, no English text. Natural selfie-style framing, authentic and not too polished. Portrait orientation 9:16.`;

        addLog('🖼️ กำลังสร้างภาพ Avatar ผ่าน Google Flow...', 'step');
        addLog(`📝 Ref images: avatar + ${selectedProducts.length} สินค้า`, 'info');

        // Show loading
        $('videoPreview').innerHTML = `<div style="padding:30px;text-align:center;color:#fff;">
            <div style="font-size:40px;margin-bottom:10px;">⏳</div>
            <p>กำลังสร้างภาพ Avatar...</p>
            <p style="font-size:11px;opacity:0.6;">ใช้เวลาประมาณ 30-60 วินาที</p>
        </div>`;

        try {
            // 2. ตรวจสอบว่า content script โหลดแล้วหรือยัง — ส่ง ping ก่อน
            let scriptReady = false;
            try {
                await new Promise((resolve, reject) => {
                    chrome.tabs.sendMessage(flowTabId, { action: 'ping' }, response => {
                        if (chrome.runtime.lastError) reject(new Error('not loaded'));
                        else resolve(response);
                    });
                    setTimeout(() => reject(new Error('timeout')), 2000);
                });
                scriptReady = true;
            } catch (e) {
                // Content script ไม่อยู่ — ต้อง reload tab
                addLog('🔄 กำลังโหลด Flow script...', 'info');
                await chrome.tabs.reload(flowTabId);
                await new Promise(r => setTimeout(r, 4000)); // รอหน้าโหลดเสร็จ
                scriptReady = true;
            }

            // 3. ส่ง prompt + referenceImages ไป Flow tab สร้างภาพ
            const result = await sendToFlowTab(flowTabId, 'createStoryImage', {
                imagePrompt: avatarPrompt,
                aspectRatio: '9:16',
                sceneNumber: 1,
                referenceImages: referenceImages
            }, 180000);

            if (result && result.success && (result.imageBase64 || result.imageUrl)) {
                state.avatarGeneratedBase64 = result.imageBase64 || null;
                state.avatarGeneratedUrl = result.imageUrl || null;
                const imgSrc = result.imageBase64 || result.imageUrl;
                state.avatarGenerated = imgSrc;
                $('videoPreview').innerHTML = `<img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
                addLog('✅ สร้างภาพ Avatar สำเร็จ!', 'success');
            } else {
                const errMsg = (result && result.error) || 'ไม่สามารถสร้างภาพได้';
                addLog(`❌ ${errMsg}`, 'error');
                $('videoPreview').innerHTML = `<div style="padding:15px;text-align:center;color:#f66;">❌ ${errMsg}</div>`;
            }
        } catch (err) {
            addLog(`❌ สร้างภาพไม่สำเร็จ: ${err.message}`, 'error');
            $('videoPreview').innerHTML = `<div style="padding:15px;text-align:center;color:#f66;">❌ ${err.message}</div>`;
        }
    });

    // Generate Lip Sync Video via D-ID API
    $('btnGenerateVideo').addEventListener('click', async () => {
        if (!state.didConnected) {
            addLog('❌ ใส่ D-ID API Key แล้วกด 🔗 ก่อน', 'error');
            return;
        }

        const avatarImg = state.avatarGenerated || state.avatarImage;
        if (!avatarImg) {
            addLog('⚠️ สร้างภาพ Avatar หรืออัพโหลดรูปก่อน', 'warning');
            return;
        }

        const scriptText = state.generatedScript || $('liveScript').value.trim();
        if (!scriptText) {
            addLog('⚠️ สร้าง Script ก่อน', 'warning');
            return;
        }

        const voice = $('voiceSelect').value;

        addLog('🎬 กำลังสร้างวิดีโอ Lip Sync ผ่าน D-ID...', 'step');
        addLog(`🗣️ เสียง: ${voice}`, 'info');

        // Show loading
        $('videoPreview').innerHTML = `<div style="padding:30px;text-align:center;color:#fff;">
            <div style="font-size:40px;margin-bottom:10px;">⏳</div>
            <p>กำลังสร้างวิดีโอ Lip Sync...</p>
            <p style="font-size:11px;opacity:0.6;">ใช้เวลาประมาณ 1-3 นาที</p>
        </div>`;

        try {
            // Step 1: เตรียมรูป — ย่อขนาด + แปลงเป็น Blob
            addLog('📤 กำลังเตรียมรูปสำหรับ D-ID...', 'info');
            const imgBlob = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const maxSize = 512;
                    let w = img.width, h = img.height;
                    if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                    else { w = Math.round(w * maxSize / h); h = maxSize; }
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/jpeg', 0.85);
                };
                img.onerror = () => reject(new Error('ไม่สามารถโหลดรูป Avatar ได้'));
                img.src = avatarImg;
            });

            // Step 2: อัพโหลดรูปไป D-ID (ต้องเป็น HTTP URL เท่านั้น)
            addLog('📤 กำลังอัพโหลดรูปไป D-ID...', 'info');
            const formData = new FormData();
            formData.append('image', imgBlob, 'avatar.jpg');

            const uploadResp = await fetch('https://api.d-id.com/images', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${state.didApiKey}`
                },
                body: formData
            });

            if (!uploadResp.ok) {
                const errText = await uploadResp.text();
                addLog(`📋 Upload Response: ${errText.substring(0, 200)}`, 'info');
                throw new Error(`อัพโหลดรูป error: HTTP ${uploadResp.status}`);
            }
            const uploadData = await uploadResp.json();
            const sourceUrl = uploadData.url;
            addLog(`✅ อัพโหลดรูปสำเร็จ: ${sourceUrl.substring(0, 60)}...`, 'info');

            // ตัด script ให้ไม่ยาวเกิน (D-ID trial จำกัด)
            const scriptInput = scriptText.substring(0, 500);

            // Step 3: Create talk
            addLog('🎬 กำลังส่งคำสั่งสร้างวิดีโอ...', 'info');
            const createResp = await fetch('https://api.d-id.com/talks', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${state.didApiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    source_url: sourceUrl,
                    script: {
                        type: 'text',
                        input: scriptInput,
                        provider: {
                            type: 'microsoft',
                            voice_id: voice
                        }
                    }
                })
            });

            if (!createResp.ok) {
                const errText = await createResp.text();
                addLog(`📋 D-ID Response: ${errText.substring(0, 200)}`, 'info');
                let errMsg = `HTTP ${createResp.status}`;
                try { const j = JSON.parse(errText); errMsg = j.description || j.message || j.kind || errMsg; } catch (e) { }
                throw new Error(errMsg);
            }

            const createData = await createResp.json();
            const talkId = createData.id;
            addLog(`⏳ D-ID กำลังสร้างวิดีโอ (ID: ${talkId})...`, 'info');

            // Step 2: Poll for result
            await pollDIDResult(talkId);
        } catch (err) {
            addLog(`❌ สร้างวิดีโอไม่สำเร็จ: ${err.message}`, 'error');
            $('videoPreview').innerHTML = `<div style="padding:15px;text-align:center;color:#f66;">❌ ${err.message}</div>`;
        }
    });

    // Poll D-ID for video result
    async function pollDIDResult(talkId) {
        for (let i = 0; i < 60; i++) { // max 5 mins
            await new Promise(r => setTimeout(r, 5000));
            try {
                const resp = await fetch(`https://api.d-id.com/talks/${talkId}`, {
                    headers: {
                        'Authorization': `Basic ${state.didApiKey}`,
                        'Accept': 'application/json'
                    }
                });
                const data = await resp.json();

                if (data.status === 'done' && data.result_url) {
                    state.generatedVideoUrl = data.result_url;
                    $('videoPreview').innerHTML = `<video src="${data.result_url}" controls autoplay loop style="width:100%;height:100%;object-fit:cover;border-radius:10px;"></video>`;
                    addLog('✅ วิดีโอ Lip Sync พร้อมแล้ว!', 'success');
                    addLog('💡 กด Go LIVE แล้วระบบจะใช้วิดีโอนี้แทนกล้อง', 'info');
                    return;
                } else if (data.status === 'error' || data.status === 'rejected') {
                    addLog(`❌ D-ID error: ${data.error?.description || data.status}`, 'error');
                    $('videoPreview').innerHTML = `<div style="padding:15px;text-align:center;color:#f66;">❌ สร้างวิดีโอไม่สำเร็จ</div>`;
                    return;
                }
                const statusMsg = data.status === 'created' ? 'เริ่มต้น...' : data.status === 'started' ? 'กำลังประมวลผล...' : data.status;
                addLog(`⏳ D-ID: ${statusMsg}`, 'info');
            } catch (e) { /* retry */ }
        }
        addLog('❌ Timeout — ลองอีกครั้ง', 'error');
    }

    // ========== Auto Script Reader ==========
    async function startAutoScript() {
        const scriptText = $('liveScript').value.trim();
        if (!scriptText) {
            addLog('กรุณาใส่ Script ก่อนเปิด Auto Script', 'warning');
            $('toggleAutoScript').classList.remove('active');
            state.autoScript = false;
            return;
        }

        state.scriptLines = scriptText.split('\n').filter(l => l.trim().length > 0);
        state.currentScriptLine = 0;

        addLog(`📖 Script: ${state.scriptLines.length} บรรทัด`, 'info');

        while (state.autoScript && state.currentScriptLine < state.scriptLines.length) {
            const line = state.scriptLines[state.currentScriptLine];
            addLog(`📖 [${state.currentScriptLine + 1}/${state.scriptLines.length}] "${line}"`, 'step');

            await sendToLiveTab({ type: 'LIVE_SEND_CHAT', message: line });
            state.currentScriptLine++;

            // รอ 10 วินาทีระหว่างแต่ละบรรทัด
            await new Promise(r => setTimeout(r, 10000));
        }

        if (state.currentScriptLine >= state.scriptLines.length) {
            addLog('📖 อ่าน Script จบแล้ว!', 'success');
            $('toggleAutoScript').classList.remove('active');
            state.autoScript = false;
        }
    }

    // ========== Listen for comments from content script ==========
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'LIVE_NEW_COMMENT' && msg.comment) {
            addComment(msg.comment);
        }
        if (msg.type === 'LIVE_LOG') {
            addLog(msg.message, msg.logType || 'info');
        }
    });

    // ========== Init ==========
    addLog('🚀 AI LIVE Dashboard v1.0 เริ่มทำงาน', 'success');

    // Auto connect
    setTimeout(connectToLiveTab, 1000);

    // Retry connection ทุก 10 วินาที
    setInterval(async () => {
        if (!state.connected) {
            await connectToLiveTab();
        }
    }, 10000);

})();
