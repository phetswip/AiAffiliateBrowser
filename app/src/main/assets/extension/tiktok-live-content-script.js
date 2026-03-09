// ========================================================
// TikTok Shop LIVE — Content Script v1.1
// สำหรับควบคุมหน้า LIVE ของ TikTok Shop Seller Center
// URL: shop.tiktok.com/streamer/live/*
//
// DOM จริงจากการ Discover:
//   ชื่อ LIVE: textarea[placeholder="Type something..."]
//   เริ่ม LIVE: button "Go LIVE now" หรือ "Go LIVE"
//   เพิ่มสินค้า: button "Add products"
//   เพิ่ม Script: button "Add script"
//   Chat/Comment: จะปรากฏหลังเริ่ม LIVE
// ========================================================

(function () {
    // ถ้า inject ซ้ำ → cleanup listener เก่า แล้ว register ใหม่
    if (window.__TIKTOK_LIVE_LISTENER__) {
        try {
            chrome.runtime.onMessage.removeListener(window.__TIKTOK_LIVE_LISTENER__);
        } catch (e) { }
        console.log('[LIVE] 🔄 Re-injected — cleaned up old listener');
    }
    window.__TIKTOK_LIVE_SCRIPT_LOADED__ = true;

    const PREFIX = '[AI-LIVE]';

    // ========== Logging ==========
    function log(msg, type = 'info') {
        const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌', step: '📍' };
        const icon = icons[type] || 'ℹ️';
        console.log(`${PREFIX} ${icon} ${msg}`);
        try {
            chrome.runtime.sendMessage({ type: 'LIVE_LOG', message: msg, logType: type });
        } catch (e) { }
    }

    // ========== Utilities ==========
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function simulateClick(el) {
        if (!el) return false;
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(eventType => {
                el.dispatchEvent(new PointerEvent(eventType, { bubbles: true, cancelable: true, view: window }));
            });
            return true;
        } catch (e) {
            try { el.click(); return true; } catch (e2) { return false; }
        }
    }

    function simulateType(el, text) {
        if (!el) return false;
        el.focus();

        // สำหรับ React-controlled textarea ต้องใช้ native setter
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        )?.set;

        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, text);
        } else {
            el.value = text;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);

            const observer = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (found) { observer.disconnect(); resolve(found); }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
        });
    }

    // ========== Smart Element Finders (จาก Analysis จริง) ==========

    // ไม่มีช่อง "ชื่อ LIVE" บนหน้า LIVE console!
    // "Type something..." (0/100) คือ Chat input ไม่ใช่ title!

    function findButton(textMatches) {
        const allButtons = Array.from(document.querySelectorAll('button'));
        for (const match of textMatches) {
            const btn = allButtons.find(b => {
                const text = b.textContent.trim().toLowerCase();
                return text === match.toLowerCase() || text.includes(match.toLowerCase());
            });
            if (btn) return btn;
        }
        return null;
    }

    function findStartButton() {
        // ปุ่ม "Go LIVE" (index 10) ≠ "Go LIVE now" (index 0 = sidebar nav)
        const allButtons = Array.from(document.querySelectorAll('button'));

        // 1. หาปุ่มที่เขียน "Go LIVE" เป๊ะๆ (ไม่รวม "Go LIVE now")
        const exactBtn = allButtons.find(b => {
            const text = b.textContent.trim();
            return text === 'Go LIVE' || text === 'เริ่ม LIVE';
        });
        if (exactBtn) return exactBtn;

        // 2. หา arco-btn-primary ที่มี data-tid (ปุ่มหลัก)
        const primaryBtn = document.querySelector('button.arco-btn-primary[data-tid="m4b_button"]');
        if (primaryBtn && !primaryBtn.textContent.toLowerCase().includes('now')) return primaryBtn;

        // 3. หา arco-btn-primary ที่มี "go live" แต่ไม่มี "now"
        const arcoButtons = document.querySelectorAll('button.arco-btn-primary');
        for (const btn of arcoButtons) {
            const text = btn.textContent.trim().toLowerCase();
            if (text.includes('go live') && !text.includes('now')) return btn;
        }

        // 4. Fallback
        return findButton(['Start', 'เริ่ม', 'ถ่ายทอดสด']);
    }

    function findEndButton() {
        return findButton(['End LIVE', 'End', 'Stop', 'จบ', 'หยุด']);
    }

    function findAddProductsButton() {
        return findButton(['Add products', 'เพิ่มสินค้า']);
    }

    async function clickStartLive() {
        const btn = findStartButton();
        if (!btn) {
            log('❌ ไม่พบปุ่ม Go LIVE', 'error');
            return false;
        }
        log(`🔴 กำลังกด "${btn.textContent.trim()}"...`, 'step');
        simulateClick(btn);
        await delay(500);
        log('🔴 กด Go LIVE สำเร็จ ✅', 'success');
        return true;
    }

    function findAddScriptButton() {
        return findButton(['Add script', 'เพิ่ม Script']);
    }

    function findChatInput() {
        // "Type something..." (0/100) คือ Chat input สำหรับพิมพ์ข้อความ/script ระหว่าง LIVE
        return document.querySelector('textarea[placeholder*="Type something" i]') ||
            document.querySelector('input[placeholder*="chat" i]') ||
            document.querySelector('input[placeholder*="comment" i]') ||
            document.querySelector('input[placeholder*="message" i]') ||
            document.querySelector('textarea[placeholder*="chat" i]') ||
            document.querySelector('textarea[placeholder*="Send" i]');
    }

    // ========== DOM Discovery ==========
    function discoverLivePageElements() {
        const results = {
            url: window.location.href,
            title: document.title,
            elements: {}
        };

        // ไม่มี title field บนหน้า LIVE console!

        const startBtn = findStartButton();
        results.elements.startButton = !!startBtn;
        results.elements.startButtonText = startBtn?.textContent?.trim()?.substring(0, 50);

        const endBtn = findEndButton();
        results.elements.endButton = !!endBtn;
        results.elements.endButtonText = endBtn?.textContent?.trim()?.substring(0, 50);

        const addProducts = findAddProductsButton();
        results.elements.addProductsButton = !!addProducts;

        const addScript = findAddScriptButton();
        results.elements.addScriptButton = !!addScript;

        const chatInput = findChatInput();
        results.elements.chatInput = !!chatInput;
        results.elements.chatInputPlaceholder = chatInput?.placeholder?.substring(0, 50);

        // หา video preview / camera
        const videoPreview = document.querySelector('video') ||
            document.querySelector('[class*="preview" i]') ||
            document.querySelector('[class*="camera" i]') ||
            document.querySelector('[class*="player" i]');
        results.elements.videoPreview = !!videoPreview;

        // Debug info
        const allInputs = document.querySelectorAll('input, textarea');
        const allButtons = Array.from(document.querySelectorAll('button'));
        results.debug = {
            inputCount: allInputs.length,
            buttonCount: allButtons.length,
            inputs: Array.from(allInputs).slice(0, 10).map(el => ({
                tag: el.tagName,
                type: el.type,
                placeholder: el.placeholder?.substring(0, 50),
                id: el.id,
                className: el.className?.substring(0, 80),
                value: el.value?.substring(0, 30)
            })),
            buttons: allButtons.slice(0, 20).map(btn => ({
                text: btn.textContent?.trim()?.substring(0, 50),
                className: btn.className?.substring(0, 80),
                disabled: btn.disabled
            }))
        };

        return results;
    }

    // ========== Comment Observer ==========
    let commentObserver = null;
    let commentInterval = null;
    let lastComments = [];

    function startCommentObserver() {
        if (commentObserver) return;

        log('เริ่ม Comment Observer...', 'info');

        const scanComments = () => {
            // หาความคิดเห็น/chat messages จากหลาย selector
            const commentEls = document.querySelectorAll(
                '[class*="chat-message" i], [class*="comment-item" i], [class*="message-item" i], ' +
                '[class*="ChatMessage" i], [class*="chat_message" i], [class*="chatMessage" i], ' +
                '[class*="live-comment" i], [class*="liveComment" i]'
            );

            const comments = Array.from(commentEls).map(el => {
                const username = el.querySelector('[class*="name" i], [class*="user" i], [class*="author" i], [class*="nickname" i]')?.textContent?.trim() || 'unknown';
                const text = el.querySelector('[class*="content" i], [class*="text" i], [class*="body" i], [class*="msg" i]')?.textContent?.trim() ||
                    el.textContent?.trim()?.replace(username, '')?.trim() || '';
                return { username, text, timestamp: Date.now() };
            }).filter(c => c.text.length > 0);

            // หาคอมเมนต์ใหม่
            const newComments = comments.filter(c =>
                !lastComments.some(lc => lc.username === c.username && lc.text === c.text)
            );

            if (newComments.length > 0) {
                lastComments = comments.slice(-50);
                newComments.forEach(c => {
                    log(`💬 ${c.username}: ${c.text}`, 'info');
                    try {
                        chrome.runtime.sendMessage({
                            type: 'LIVE_NEW_COMMENT',
                            comment: c
                        });
                    } catch (e) { }
                });
            }
        };

        // MutationObserver
        const chatContainer = document.querySelector('[class*="chat" i]') ||
            document.querySelector('[class*="comment" i]') ||
            document.querySelector('[class*="message-list" i]') ||
            document.body;

        commentObserver = new MutationObserver(() => {
            scanComments();
        });

        commentObserver.observe(chatContainer, { childList: true, subtree: true });

        // Scan ทุก 3 วินาทีเป็น fallback
        commentInterval = setInterval(scanComments, 3000);
        log('Comment Observer พร้อมใช้งาน', 'success');
    }

    function stopCommentObserver() {
        if (commentObserver) {
            commentObserver.disconnect();
            commentObserver = null;
        }
        if (commentInterval) {
            clearInterval(commentInterval);
            commentInterval = null;
        }
        log('หยุด Comment Observer', 'info');
    }

    // ========== Product Management (จาก Screenshot จริง) ==========
    // Dialog "Add New Products":
    //   - Tabs: Showcase Products | LIVE product sets | Product URL
    //   - Table: checkbox | image | Product(name+ID+seller) | Price | Commission | Stock | Status
    //   - Footer: "You can add X more products" | [Cancel] | [Add Products]

    async function openAddProductsDialog() {
        const addBtn = findAddProductsButton();
        if (!addBtn) {
            log('ไม่พบปุ่ม Add products', 'error');
            return null;
        }
        simulateClick(addBtn);
        log('กำลังเปิด Add Products dialog...', 'info');

        // รอ dialog เปิด — ลองหลายวิธี
        for (let i = 0; i < 15; i++) {
            await delay(500);
            const dialog = findDialogElement();
            if (dialog) {
                log('Dialog เปิดแล้ว ✅', 'success');
                return dialog;
            }
        }
        log('Dialog ไม่เปิด — timeout', 'error');
        return null;
    }

    function findDialogElement() {
        // วิธี 1: CSS selectors มาตรฐาน
        const selectors = [
            '[role="dialog"]',
            '[class*="arco-modal"]',
            '[class*="modal-wrapper"]',
            '[class*="Modal"]',
            '[class*="modal"]',
            '[class*="dialog"]',
            '[class*="Dialog"]',
            '[class*="drawer"]',
            '[class*="overlay"]',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.includes('Product')) return el;
        }

        // วิธี 2: หา element ที่มี "Add New Products" หรือ "Cancel" + "Add Products"
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
            if (div.children.length > 3 && div.offsetWidth > 400 && div.offsetHeight > 300) {
                const text = div.textContent || '';
                if (text.includes('Add New Products') ||
                    (text.includes('Cancel') && text.includes('Add Products') && text.includes('ID:'))) {
                    return div;
                }
            }
        }

        return null;
    }
    // ดึงสินค้าจากแถวที่แสดงอยู่ในหน้าปัจจุบัน
    function scrapeCurrentPageProducts() {
        const products = [];
        const rows = document.querySelectorAll('tr');

        for (const row of rows) {
            const text = row.textContent || '';

            const idMatch = text.match(/ID:\s*(\d+)/);
            if (!idMatch) continue;

            const productId = idMatch[1];

            // หารูปสินค้า
            const img = row.querySelector('img');
            const imageUrl = img ? img.src : '';

            // หาชื่อสินค้า
            let productName = '';

            // วิธี 1: ใช้ TreeWalker หา text node ที่เหมาะสม
            const tds = row.querySelectorAll('td');
            for (const td of tds) {
                const tdText = td.textContent || '';
                if (tdText.includes('ID:') && tdText.length > 20) {
                    const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
                    const textParts = [];
                    let node;
                    while (node = walker.nextNode()) {
                        const t = node.textContent.trim();
                        if (t.length > 3) textParts.push(t);
                    }
                    productName = textParts.find(t =>
                        t.length > 5 &&
                        !t.startsWith('ID:') &&
                        !t.includes('Specials') &&
                        !t.includes('Free sample') &&
                        !t.includes('Added') &&
                        !t.match(/^\+\d+$/)
                    ) || '';
                    break;
                }
            }

            // วิธี 2: หาจาก text ก่อน ID:
            if (!productName) {
                const idIdx = text.indexOf('ID:');
                if (idIdx > 10) {
                    const beforeId = text.substring(0, idIdx);
                    const cleanLines = beforeId.split(/[\n\r]/).map(l => l.trim()).filter(l => l.length > 3);
                    productName = cleanLines.find(l =>
                        l.length > 5 &&
                        !l.includes('Specials') &&
                        !l.includes('Free sample') &&
                        !l.includes('Added') &&
                        !l.includes('Product') &&
                        !l.includes('+')
                    ) || '';
                }
            }

            // วิธี 3: ใช้ alt ของ img
            if (!productName && img) {
                productName = img.alt || img.title || '';
            }

            // หาราคา + stock
            const priceMatch = text.match(/฿([\d,.]+)/);
            const price = priceMatch ? priceMatch[1] : '';
            const stockMatch = text.match(/In stock\s*\(?([\d,]+)\)?/i);
            const stock = stockMatch ? stockMatch[1].replace(/,/g, '') : '';

            if (productName || productId) {
                products.push({
                    id: productId,
                    name: productName.substring(0, 100) || `Product ${productId.substring(0, 8)}...`,
                    price,
                    stock,
                    imageUrl,
                });
            }
        }
        return products;
    }

    async function scrapeProductsFromDialog(maxPages = 1) {
        log(`📦 กำลัง scrape สินค้า (${maxPages} หน้า)...`, 'step');

        const dialog = await openAddProductsDialog();
        if (!dialog) return [];

        await delay(2000);

        const allProducts = [];
        const seenIds = new Set();

        for (let page = 1; page <= maxPages; page++) {
            log(`📄 กำลังดึงหน้า ${page}/${maxPages}...`, 'info');

            const pageProducts = scrapeCurrentPageProducts();

            // เพิ่มเฉพาะสินค้าที่ยังไม่มี (กัน duplicate)
            for (const p of pageProducts) {
                if (!seenIds.has(p.id)) {
                    seenIds.add(p.id);
                    allProducts.push(p);
                }
            }

            log(`📦 หน้า ${page}: พบ ${pageProducts.length} รายการ (รวม ${allProducts.length})`, 'info');

            // ถ้ายังไม่ใช่หน้าสุดท้าย → กดปุ่ม Next (>)
            if (page < maxPages) {
                const nextBtn = document.querySelector('[class*="pagination"] [class*="next"]') ||
                    document.querySelector('li.arco-pagination-item-next') ||
                    document.querySelector('button[class*="next"]');

                // Fallback: หาปุ่ม > ใน pagination
                let nextArrow = nextBtn;
                if (!nextArrow) {
                    const paginationBtns = document.querySelectorAll('[class*="pagination"] button, [class*="pagination"] li');
                    nextArrow = Array.from(paginationBtns).find(el => {
                        const t = el.textContent.trim();
                        return t === '>' || t === '›' || el.querySelector('[class*="right"]') || el.querySelector('[class*="next"]');
                    });
                }

                if (nextArrow) {
                    simulateClick(nextArrow);
                    await delay(2000); // รอหน้าถัดไปโหลด
                } else {
                    log(`⚠️ ไม่พบปุ่ม Next — หยุดที่หน้า ${page}`, 'warning');
                    break;
                }
            }
        }

        log(`📦 ดึงสินค้าทั้งหมด ${allProducts.length} รายการ จาก ${Math.min(maxPages, allProducts.length > 0 ? maxPages : 1)} หน้า`, 'success');

        // ปิด dialog — กด Cancel ใน dialog
        await delay(300);
        const currentDialog = findDialogElement();
        let cancelBtn = null;
        if (currentDialog) {
            const btns = currentDialog.querySelectorAll('button');
            cancelBtn = Array.from(btns).find(b => {
                const t = b.textContent.trim().toLowerCase();
                return t === 'cancel' || t === 'ยกเลิก';
            });
        }
        if (!cancelBtn) cancelBtn = findButton(['Cancel', 'ยกเลิก']);

        if (cancelBtn) {
            simulateClick(cancelBtn);
            log('ปิด dialog (Cancel)', 'info');
        } else {
            const closeBtn = document.querySelector('[aria-label="Close"]');
            if (closeBtn) simulateClick(closeBtn);
        }

        await delay(500);
        return allProducts;
    }

    async function selectProductsAndAdd(productIds) {
        log(`📦 เลือกสินค้า ${productIds.length} รายการ...`, 'step');

        const dialog = await openAddProductsDialog();
        if (!dialog) return false;

        await delay(2000); // รอข้อมูลโหลด

        let selected = 0;

        // หาทุกแถวในตาราง
        const rows = document.querySelectorAll('tr');
        for (const row of rows) {
            const text = row.textContent || '';
            const idMatch = text.match(/ID:\s*(\d+)/);
            if (!idMatch) continue;

            const productId = idMatch[1];

            // เช็คว่า ID นี้อยู่ในรายการที่เลือกไหม
            if (productIds.includes(productId)) {
                // หา checkbox ในแถวนี้
                const checkbox = row.querySelector('input[type="checkbox"]') ||
                    row.querySelector('[class*="checkbox"]');

                if (checkbox) {
                    // ถ้าเป็น input checkbox
                    if (checkbox.tagName === 'INPUT') {
                        if (!checkbox.checked) {
                            simulateClick(checkbox);
                            await delay(300);
                        }
                    } else {
                        // arco-checkbox — กดที่ wrapper
                        simulateClick(checkbox);
                        await delay(300);
                    }
                    selected++;
                    log(`  ✅ เลือก: ${text.substring(0, 40).trim()}...`, 'success');
                }
            }
        }

        log(`📦 เลือกสินค้าแล้ว ${selected}/${productIds.length} รายการ`, selected > 0 ? 'success' : 'warning');

        // หา dialog element ที่เปิดอยู่
        const currentDialog = findDialogElement();

        // กดปุ่ม "Add Products" (ปุ่มสีเขียว/teal ล่างขวา **ในdialog**)
        await delay(500);
        let addProductsBtn = null;
        if (currentDialog) {
            // หาปุ่มในdialogเท่านั้น
            const dialogButtons = currentDialog.querySelectorAll('button');
            addProductsBtn = Array.from(dialogButtons).find(b => {
                const t = b.textContent.trim().toLowerCase();
                return t === 'add products' || t === 'เพิ่มสินค้า';
            });
        }
        // Fallback: หาปุ่มทั้งหน้า (ที่ไม่ใช่ + Add products link)
        if (!addProductsBtn) {
            const allBtns = Array.from(document.querySelectorAll('button'));
            addProductsBtn = allBtns.find(b => b.textContent.trim() === 'Add Products');
        }

        if (addProductsBtn) {
            simulateClick(addProductsBtn);
            log('กด "Add Products" ใน dialog สำเร็จ ✅', 'success');
            await delay(2000); // รอสินค้าเพิ่มเสร็จ

            // กด Cancel เพื่อปิด dialog กลับไปหน้า dashboard
            let cancelBtn = null;
            const dialogAfter = findDialogElement();
            if (dialogAfter) {
                const btns = dialogAfter.querySelectorAll('button');
                cancelBtn = Array.from(btns).find(b => {
                    const t = b.textContent.trim().toLowerCase();
                    return t === 'cancel' || t === 'ยกเลิก';
                });
            }
            if (!cancelBtn) cancelBtn = findButton(['Cancel', 'ยกเลิก']);

            if (cancelBtn) {
                simulateClick(cancelBtn);
                log('ปิด dialog (Cancel) กลับหน้า dashboard ✅', 'info');
            } else {
                // กด X ปิด dialog
                const closeBtn = document.querySelector('[aria-label="Close"]') ||
                    document.querySelector('[class*="close-icon"]');
                if (closeBtn) {
                    simulateClick(closeBtn);
                    log('ปิด dialog (X) กลับหน้า dashboard', 'info');
                }
            }
            await delay(1000);
            return true;
        } else {
            log('❌ ไม่พบปุ่ม Add Products ใน dialog', 'error');
            const cancelBtn = findButton(['Cancel', 'ยกเลิก']);
            if (cancelBtn) simulateClick(cancelBtn);
            return false;
        }
    }

    async function fullStartLive(options = {}) {
        log('🚀 เริ่มขั้นตอน Full Start LIVE...', 'step');

        // ขั้น 1: เพิ่มสินค้า (ถ้ามี)
        if (options.productIds && options.productIds.length > 0) {
            log(`📦 ขั้นที่ 1: เพิ่มสินค้า ${options.productIds.length} รายการ`, 'step');
            const addOk = await selectProductsAndAdd(options.productIds);
            if (!addOk) {
                log('⚠️ เพิ่มสินค้าไม่สำเร็จ — ข้ามไปกด Go LIVE', 'warning');
            }
            await delay(1500);
        } else {
            log('ℹ️ ไม่มีสินค้าเลือก — ข้ามไปกด Go LIVE', 'info');
        }

        // ขั้น 2: กด Go LIVE → จะเปิด "Audio and video settings" dialog
        log('🔴 ขั้นที่ 2: กด Go LIVE...', 'step');
        const liveOk = await clickStartLive();
        if (liveOk) {
            log('🔴 กด Go LIVE แล้ว — รอตั้งค่ากล้อง/ไมค์', 'success');
            // ไม่ต้องเริ่ม comment observer ตอนนี้ — รอจน user กด Go LIVE ใน settings dialog
        }

        return liveOk;
    }

    async function sendChatMessage(message) {
        const chatInput = findChatInput();

        if (!chatInput) {
            log('ไม่พบช่องพิมพ์ข้อความ (Chat อาจยังไม่เปิด — ต้องเริ่ม LIVE ก่อน)', 'warning');
            return false;
        }

        simulateType(chatInput, message);
        await delay(300);

        // กด Enter
        chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        chatInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        chatInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

        // ลองหาปุ่ม send
        await delay(200);
        const sendBtn = findButton(['Send', 'ส่ง']);
        if (sendBtn) simulateClick(sendBtn);

        log(`ส่งข้อความ: "${message.substring(0, 40)}${message.length > 40 ? '...' : ''}"`, 'success');
        return true;
    }

    // ========== Message Listener ==========
    const messageHandler = (msg, sender, sendResponse) => {
        // ไม่ตอบ message ที่ไม่ใช่ของเรา
        if (!msg.type || !msg.type.startsWith('LIVE_')) return;

        log(`📩 ได้รับคำสั่ง: ${msg.type}`, 'info');

        const requestId = msg._requestId;

        // Helper: ส่ง response กลับผ่าน broadcast (ไม่พึ่ง sendResponse)
        function respond(data) {
            try {
                chrome.runtime.sendMessage({
                    type: 'LIVE_RESPONSE',
                    _requestId: requestId,
                    data: data
                });
            } catch (e) {
                console.log('[AI-LIVE] Broadcast response failed:', e.message);
            }
            // ลอง sendResponse ด้วยเผื่อ context ปกติ
            try { sendResponse(data); } catch (e) { }
        }

        switch (msg.type) {
            case 'LIVE_DISCOVER':
                const elements = discoverLivePageElements();
                log(`สำรวจ DOM สำเร็จ — inputs: ${elements.debug.inputCount}, buttons: ${elements.debug.buttonCount}`, 'success');
                respond({ success: true, data: elements });
                break;

            case 'LIVE_SET_TITLE':
                // ไม่มีช่อง title บนหน้า LIVE console
                respond({ success: false, error: 'No title field on this page' });
                break;

            case 'LIVE_START':
                clickStartLive().then(ok => {
                    if (ok) startCommentObserver();
                    respond({ success: ok });
                });
                return true;

            case 'LIVE_END':
                stopCommentObserver();
                clickEndLive().then(ok => respond({ success: ok }));
                return true;

            case 'LIVE_SEND_CHAT':
                sendChatMessage(msg.message).then(ok => respond({ success: ok }));
                return true;

            case 'LIVE_ADD_PRODUCTS':
                openAddProductsDialog().then(ok => respond({ success: ok }));
                return true;

            case 'LIVE_SCRAPE_PRODUCTS':
                scrapeProductsFromDialog(msg.maxPages || 1).then(products => respond({ success: true, products }));
                return true;

            case 'LIVE_SELECT_PRODUCTS':
                selectProductsAndAdd(msg.productIds).then(ok => respond({ success: ok }));
                return true;

            case 'LIVE_FULL_START':
                fullStartLive(msg.options || {}).then(ok => respond({ success: ok }));
                return true;

            case 'LIVE_START':
                clickStartLive().then(ok => respond({ success: ok }));
                return true;

            case 'LIVE_START_COMMENTS':
                startCommentObserver();
                respond({ success: true });
                break;

            case 'LIVE_STOP_COMMENTS':
                stopCommentObserver();
                respond({ success: true });
                break;

            case 'LIVE_PING':
                respond({ success: true, url: window.location.href });
                break;

            default:
                respond({ success: false, error: 'Unknown command' });
        }
    };

    // Register listener globally (for cleanup on re-injection)
    window.__TIKTOK_LIVE_LISTENER__ = messageHandler;
    chrome.runtime.onMessage.addListener(messageHandler);

    // ========== Auto Init ==========
    log(`🔴 TikTok LIVE Content Script v1.1 loaded — ${window.location.href}`, 'success');

    // รอ DOM load เสร็จแล้วสำรวจ
    setTimeout(() => {
        const elements = discoverLivePageElements();
        const el = elements.elements;
        log(`DOM Discovery: start=${el.startButton ? '✅ "' + el.startButtonText + '"' : '❌'} addProducts=${el.addProductsButton ? '✅' : '❌'} addScript=${el.addScriptButton ? '✅' : '❌'} chat=${el.chatInput ? '✅' : '❌'} video=${el.videoPreview ? '✅' : '❌'}`, 'info');
    }, 3000);

})();
