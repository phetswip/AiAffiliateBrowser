/**
 * auto-post.js — โพสต์คลิป (Phase 1: UI + Product Set Management)
 * YUMYUM AUTO ULTRA Extension
 */
(function () {
    'use strict';

    const MAX_SETS = 50;
    const INITIAL_VISIBLE = 2;

    // ═══ CUSTOM CONFIRM DIALOG ═══
    function yumConfirm({ title = 'ยืนยัน', message = '', icon = '⚠️', danger = false } = {}) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'yum-confirm-overlay';
            overlay.innerHTML = `
                <div class="yum-confirm-box">
                    <span class="yum-confirm-icon">${icon}</span>
                    <div class="yum-confirm-title">${title}</div>
                    <div class="yum-confirm-msg">${message}</div>
                    <div class="yum-confirm-btns">
                        <button class="yum-confirm-cancel">ยกเลิก</button>
                        <button class="yum-confirm-ok ${danger ? 'danger' : ''}">ตกลง</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('.yum-confirm-cancel').onclick = () => { overlay.remove(); resolve(false); };
            overlay.querySelector('.yum-confirm-ok').onclick = () => { overlay.remove(); resolve(true); };
            overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
        });
    }

    let productSets = [];
    let showingAllSets = false;
    let allProducts = []; // Products from scraper IndexedDB
    let openDropdownIdx = -1; // Which set's product dropdown is open

    /* ═══ IndexedDB — Same DB as popup.js ═══ */
    const DB_NAME = 'AutoUltraProducts';
    const STORE_NAME = 'products';
    const DB_VERSION = 1;

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(STORE_NAME)) {
                    req.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function getAllProducts() {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.warn('[AutoPost] IndexedDB error:', e);
            return [];
        }
    }

    async function updateProduct(product) {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const req = store.put(product); // put = update existing by keyPath
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.warn('[AutoPost] updateProduct error:', e);
        }
    }

    async function loadProducts() {
        allProducts = await getAllProducts();
        console.log('[AutoPost] Loaded', allProducts.length, 'products from scraper');

        // Auto-migrate: backfill missing productIds
        const needsMigration = allProducts.filter(p => !p.productId);
        if (needsMigration.length > 0) {
            console.log('[AutoPost] Migration: ' + needsMigration.length + ' products missing productId, attempting backfill...');
            await migrateProductIds(needsMigration);
            // Reload after migration
            allProducts = await getAllProducts();
        }
    }

    async function migrateProductIds(productsWithoutId) {
        // Try to get showcase scraper results from chrome.storage.local
        try {
            const storageData = await new Promise(resolve => {
                chrome.storage.local.get(null, (data) => resolve(data || {}));
            });

            // Look for showcase results or any cached product data
            let showcaseProducts = [];

            // Check yumyum_showcase_result
            if (storageData.yumyum_showcase_result?.products) {
                showcaseProducts = storageData.yumyum_showcase_result.products;
                console.log('[AutoPost] Migration: Found', showcaseProducts.length, 'products in showcase result');
            }

            // Also check aia_product_images_map for product IDs (keys are product IDs)
            const imageMap = storageData.aia_product_images_map || {};
            const imageMapProductIds = Object.keys(imageMap).filter(k => /^\d{10,}$/.test(k));

            if (showcaseProducts.length > 0) {
                // Match by name
                let updated = 0;
                for (const dbProduct of productsWithoutId) {
                    const dbName = (dbProduct.name || dbProduct.productName || '').toLowerCase().trim();
                    if (!dbName) continue;

                    // Find matching showcase product
                    const match = showcaseProducts.find(sp => {
                        const spName = (sp.name || sp.productName || sp.title || '').toLowerCase().trim();
                        return spName && (spName === dbName || dbName.includes(spName) || spName.includes(dbName));
                    });

                    if (match && match.productId) {
                        dbProduct.productId = String(match.productId);
                        await updateProduct(dbProduct);
                        updated++;
                        console.log('[AutoPost] Migration: Updated', dbProduct.name?.substring(0, 30), '→ productId:', match.productId);
                    }
                }
                console.log('[AutoPost] Migration: Updated ' + updated + '/' + productsWithoutId.length + ' products');
            }

            // If we have image map IDs but no showcase results, try matching by index/order
            if (imageMapProductIds.length > 0 && showcaseProducts.length === 0) {
                console.log('[AutoPost] Migration: Found', imageMapProductIds.length, 'product IDs from image map');
            }
        } catch (e) {
            console.warn('[AutoPost] Migration error:', e);
        }
    }

    /* ═══ INIT ═══ */
    document.addEventListener('DOMContentLoaded', async () => {
        await loadProducts();
        generateProductSets();
        bindEvents();
        loadSavedData();
        updateTotalClipCount();
    });

    /* ═══ GENERATE 50 PRODUCT SETS ═══ */
    function generateProductSets() {
        const container = document.getElementById('apProductSets');
        container.innerHTML = '';
        productSets = [];

        for (let i = 0; i < MAX_SETS; i++) {
            productSets.push({ basketName: '', productName: '', productId: '', hashtags: '', clips: [] });

            const el = document.createElement('div');
            el.className = 'yum-set';
            el.dataset.set = i;
            if (i >= INITIAL_VISIBLE) el.style.display = 'none';

            el.innerHTML = `
                <div class="yum-set-header">
                    <span class="yum-set-num">📦 ชุดที่ ${i + 1}</span>
                    <span class="yum-set-clips" data-clipcount="${i}">0 คลิป</span>
                </div>
                <div class="yum-set-fields">
                    <div class="yum-product-selector">
                        <button type="button" class="yum-product-select-btn act-select-product" data-set="${i}">
                            🛒 เลือกสินค้า
                        </button>
                        <div class="yum-product-dropdown hidden" data-dropdown="${i}"></div>
                    </div>
                    <div>
                        <input type="text" class="yum-input fld-basket" data-set="${i}" placeholder="ชื่อตระกร้า (Product name) - สูงสุด 30 ตัวอักษร" maxlength="30">
                        <div class="yum-charcount"><span class="char-val" data-set="${i}">0</span>/30</div>
                    </div>
                    <div class="yum-set-row">
                        <input type="text" class="yum-input fld-name" data-set="${i}" placeholder="ชื่อสินค้า (หมายเหตุ)">
                        <input type="text" class="yum-input fld-pid" data-set="${i}" placeholder="Product ID">
                    </div>
                    <div>
                        <input type="text" class="yum-input fld-hash" data-set="${i}" placeholder="#แฮชแท็ก1 #แฮชแท็ก2 (ไม่บังคับ - AI สุ่มให้ถ้าไม่กรอก)">
                        <p class="yum-note" style="margin-top:2px;">💡 ใส่ได้สูงสุด 5 แฮชแท็ก คั่นด้วยเว้นวรรค</p>
                    </div>
                </div>
                <div class="yum-clip-actions">
                    <input type="file" class="clip-file" data-set="${i}" accept=".mp4,.mov,.webm" multiple hidden>
                    <button class="yum-clip-btn act-add" data-set="${i}">📁 เพิ่มคลิป</button>
                    <button class="yum-clip-btn danger act-clear" data-set="${i}">🗑️ ลบทั้งหมด</button>
                    <button class="yum-clip-btn warn act-rmposted" data-set="${i}">✅ ลบที่โพสแล้ว</button>
                </div>
                <div class="yum-clip-list" data-set="${i}"></div>
            `;
            container.appendChild(el);
        }
    }

    /* ═══ EVENTS ═══ */
    function bindEvents() {
        // Mode radio → toggle schedule panel
        document.querySelectorAll('input[name="postMode"]').forEach(r => {
            r.addEventListener('change', () => {
                const panel = document.getElementById('apSchedulePanel');
                if (r.value === 'schedule' && r.checked) {
                    panel?.classList.remove('hidden');
                } else {
                    panel?.classList.add('hidden');
                }
                autoSave();
            });
        });

        // Date quick buttons
        document.getElementById('apDateToday')?.addEventListener('click', () => {
            document.getElementById('apScheduleDate').value = fmtDate(new Date());
        });
        document.getElementById('apDateTomorrow')?.addEventListener('click', () => {
            const d = new Date(); d.setDate(d.getDate() + 1);
            document.getElementById('apScheduleDate').value = fmtDate(d);
        });

        // Toggle more sets
        document.getElementById('apToggleMoreSets')?.addEventListener('click', () => {
            showingAllSets = !showingAllSets;
            toggleSetVisibility();
            document.getElementById('apToggleMoreSets').textContent =
                showingAllSets ? '▲ ซ่อนชุด 3-50' : '▼ ดูเพิ่มเติม (ชุด 3-50)';
        });

        // Product set input delegation
        const setsEl = document.getElementById('apProductSets');
        setsEl?.addEventListener('input', (e) => {
            const s = parseInt(e.target.dataset.set);
            if (isNaN(s)) return;
            if (e.target.classList.contains('fld-basket')) {
                productSets[s].basketName = e.target.value;
                const cv = document.querySelector(`.char-val[data-set="${s}"]`);
                if (cv) cv.textContent = e.target.value.length;
            } else if (e.target.classList.contains('fld-name')) {
                productSets[s].productName = e.target.value;
            } else if (e.target.classList.contains('fld-pid')) {
                productSets[s].productId = e.target.value;
            } else if (e.target.classList.contains('fld-hash')) {
                productSets[s].hashtags = e.target.value;
            } else if (e.target.classList.contains('yum-clip-caption')) {
                const clipIdx = parseInt(e.target.dataset.idx);
                if (!isNaN(clipIdx) && productSets[s]?.clips[clipIdx]) {
                    productSets[s].clips[clipIdx].caption = e.target.value;
                }
            } else if (e.target.classList.contains('yum-clip-hashtag')) {
                const clipIdx = parseInt(e.target.dataset.idx);
                if (!isNaN(clipIdx) && productSets[s]?.clips[clipIdx]) {
                    productSets[s].clips[clipIdx].hashtags = e.target.value;
                }
            }
            autoSave();
        });

        // Clip buttons delegation + Product selector
        setsEl?.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const s = parseInt(btn.dataset.set);

            // Product selector button
            if (btn.classList.contains('act-select-product')) {
                toggleProductDropdown(s);
                return;
            }

            if (isNaN(s) && !e.target.classList.contains('yum-clip-rm')) return;

            if (btn.classList.contains('act-add')) {
                setsEl.querySelector(`.clip-file[data-set="${s}"]`)?.click();
            } else if (btn.classList.contains('act-clear')) {
                productSets[s].clips = [];
                renderClips(s);
                updateTotalClipCount();
                autoSave();
            } else if (btn.classList.contains('act-rmposted')) {
                productSets[s].clips = productSets[s].clips.filter(c => !c.posted);
                renderClips(s);
                updateTotalClipCount();
                autoSave();
            }
        });

        // Product option click delegation
        setsEl?.addEventListener('click', (e) => {
            const opt = e.target.closest('.yum-product-option');
            if (opt) {
                const s = parseInt(opt.dataset.set);
                const pid = parseInt(opt.dataset.pid);
                if (!isNaN(s) && !isNaN(pid)) selectProduct(s, pid);
                return;
            }
        });

        // Clip remove
        setsEl?.addEventListener('click', (e) => {
            if (e.target.classList.contains('yum-clip-rm')) {
                const s = parseInt(e.target.dataset.set);
                const idx = parseInt(e.target.dataset.idx);
                if (!isNaN(s) && !isNaN(idx)) {
                    productSets[s].clips.splice(idx, 1);
                    renderClips(s);
                    updateTotalClipCount();
                    autoSave();
                }
            }
        });

        // Product search filter
        setsEl?.addEventListener('input', (e) => {
            if (e.target.classList.contains('yum-product-search')) {
                const s = parseInt(e.target.dataset.set);
                if (!isNaN(s)) renderProductOptions(s, e.target.value);
            }
        });

        // File input change
        setsEl?.addEventListener('change', (e) => {
            if (!e.target.classList.contains('clip-file')) return;
            const s = parseInt(e.target.dataset.set);
            if (isNaN(s)) return;
            addClipFiles(s, e.target.files);
            e.target.value = '';
        });

        // Bulk hashtags
        document.getElementById('apDistributeHashtags')?.addEventListener('click', () => {
            const val = document.getElementById('apBulkHashtags')?.value?.trim();
            if (!val) return;
            for (let i = 0; i < MAX_SETS; i++) {
                if (productSets[i].productId || productSets[i].clips.length > 0) {
                    productSets[i].hashtags = val;
                    const el = document.querySelector(`.fld-hash[data-set="${i}"]`);
                    if (el) el.value = val;
                }
            }
            autoSave();
        });

        // Bulk basket name
        document.getElementById('apDistributeBasketName')?.addEventListener('click', () => {
            const val = document.getElementById('apBulkBasketName')?.value?.trim();
            if (!val) return;
            for (let i = 0; i < MAX_SETS; i++) {
                if (productSets[i].productId || productSets[i].clips.length > 0) {
                    productSets[i].basketName = val;
                    const el = document.querySelector(`.fld-basket[data-set="${i}"]`);
                    if (el) el.value = val;
                    const cv = document.querySelector(`.char-val[data-set="${i}"]`);
                    if (cv) cv.textContent = val.length;
                }
            }
            autoSave();
        });

        // Bulk clips
        document.getElementById('apDistributeClipsBtn')?.addEventListener('click', () => {
            document.getElementById('apDistributeClipsInput')?.click();
        });
        document.getElementById('apDistributeClipsInput')?.addEventListener('change', (e) => {
            distributeClips(e.target.files);
            e.target.value = '';
        });

        // AI Generate Hashtags + CTA
        document.getElementById('apAiGenerateBtn')?.addEventListener('click', aiGenerateHashtagsAndCTA);

        // Export / Import
        document.getElementById('apExportBtn')?.addEventListener('click', exportData);
        document.getElementById('apImportBtn')?.addEventListener('click', () => {
            document.getElementById('apImportFile')?.click();
        });
        document.getElementById('apImportFile')?.addEventListener('change', (e) => {
            importData(e.target.files[0]);
            e.target.value = '';
        });

        // Options auto-save
        document.querySelectorAll('#apNoBasket, #apStoryMode').forEach(el => {
            el.addEventListener('change', autoSave);
        });
        document.querySelectorAll('#apScheduleDate, #apScheduleHour, #apScheduleMinute, #apScheduleInterval, #apPostInterval').forEach(el => {
            el.addEventListener('change', autoSave);
        });

        // Reset all
        document.getElementById('apResetAllBtn')?.addEventListener('click', async () => {
            const ok = await yumConfirm({ title: 'รีเซ็ตทั้งหมด', message: 'ล้างค่าทั้งหมดกลับเป็นค่าเริ่มต้น?', icon: '🔄', danger: true });
            if (!ok) return;
            resetAll();
        });

        // Clear all product sets
        document.getElementById('apClearAllSetsBtn')?.addEventListener('click', async () => {
            const ok = await yumConfirm({ title: 'ล้างชุดสินค้า', message: 'ล้างข้อมูลชุดสินค้าทั้งหมด?', icon: '🗑️', danger: true });
            if (!ok) return;
            clearAllSets();
        });

        // Start
        document.getElementById('apStartBtn')?.addEventListener('click', startPosting);

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (openDropdownIdx >= 0 && !e.target.closest('.yum-product-selector')) {
                closeAllDropdowns();
            }
        });
    }

    /* ═══ CLIPS ═══ */
    function addClipFiles(setIdx, files) {
        if (!files) return;
        for (const f of files) {
            productSets[setIdx].clips.push({ file: f, name: f.name, size: f.size, posted: false, caption: '', hashtags: '' });
        }
        renderClips(setIdx);
        updateTotalClipCount();
        autoSave();
    }

    function renderClips(i) {
        const container = document.querySelector(`.yum-clip-list[data-set="${i}"]`);
        if (!container) return;
        const clips = productSets[i].clips;
        const badge = document.querySelector(`[data-clipcount="${i}"]`);
        if (badge) badge.textContent = clips.length + ' คลิป';

        if (clips.length === 0) { container.innerHTML = ''; return; }
        container.innerHTML = clips.map((c, idx) => `
            <div class="yum-clip-item">
                <div class="yum-clip-header">
                    <span class="yum-clip-name">🎬 ${c.name}</span>
                    <span class="yum-clip-status ${c.posted ? 'done' : 'wait'}">${c.posted ? '✅' : '⏳'}</span>
                    <button class="yum-clip-rm" data-set="${i}" data-idx="${idx}">✕</button>
                </div>
                <textarea class="yum-clip-caption" data-set="${i}" data-idx="${idx}"
                    placeholder="✏️ แคปชั่นคลิปที่ ${idx + 1} (ว่าง = AI คิดให้)"
                    rows="2">${c.caption || ''}</textarea>
                <input type="text" class="yum-clip-hashtag" data-set="${i}" data-idx="${idx}"
                    placeholder="#แฮชแท็ก คลิปที่ ${idx + 1} (ว่าง = ใช้ของชุดสินค้า)"
                    value="${c.hashtags || ''}">
            </div>
        `).join('');
    }

    function distributeClips(files) {
        if (!files || files.length === 0) return;
        const arr = Array.from(files);
        let fi = 0;
        for (let i = 0; i < MAX_SETS && fi < arr.length; i++) {
            if (productSets[i].productId || productSets[i].basketName || productSets[i].productName || i < arr.length) {
                productSets[i].clips.push({ file: arr[fi], name: arr[fi].name, size: arr[fi].size, posted: false, caption: '', hashtags: '' });
                renderClips(i);
                fi++;
            }
        }
        updateTotalClipCount();
        autoSave();
    }

    /* ═══ VISIBILITY ═══ */
    function toggleSetVisibility() {
        document.querySelectorAll('.yum-set').forEach((el, i) => {
            el.style.display = (i < INITIAL_VISIBLE || showingAllSets) ? '' : 'none';
        });
    }

    /* ═══ RESET ALL ═══ */
    function resetAll() {
        // Reset mode
        document.querySelectorAll('.yum-mode-card input[type="radio"]').forEach(r => r.checked = false);
        document.querySelectorAll('.yum-mode-card').forEach(c => c.classList.remove('selected'));
        const schedPanel = document.getElementById('apSchedulePanel');
        if (schedPanel) schedPanel.classList.add('hidden');

        // Reset checkboxes
        const noBasket = document.getElementById('apNoBasket');
        if (noBasket) noBasket.checked = false;

        // Reset date/time
        const dateEl = document.getElementById('apScheduleDate');
        if (dateEl) dateEl.value = '';
        const hourEl = document.getElementById('apScheduleHour');
        if (hourEl) hourEl.value = '09';
        const minEl = document.getElementById('apScheduleMinute');
        if (minEl) minEl.value = '00';
        const intervalEl = document.getElementById('apScheduleInterval');
        if (intervalEl) intervalEl.value = '30';
        const postIntervalEl = document.getElementById('apPostInterval');
        if (postIntervalEl) postIntervalEl.value = '30';

        // Reset quick-fill
        const bulkHash = document.getElementById('apBulkHashtags');
        if (bulkHash) bulkHash.value = '';
        const bulkBasket = document.getElementById('apBulkBasketName');
        if (bulkBasket) bulkBasket.value = '';

        // Clear all sets
        clearAllSets();

        // Clear saved data
        chrome.storage?.local?.remove?.('autoPostData');
    }

    function clearAllSets() {
        for (let i = 0; i < MAX_SETS; i++) {
            productSets[i] = { productName: '', productId: '', basketName: '', hashtags: '', clips: [] };
        }
        generateProductSets();
        toggleSetVisibility();
        updateTotalClipCount();
        autoSave();
    }

    /* ═══ PRODUCT SELECTOR ═══ */
    function toggleProductDropdown(setIdx) {
        const dropdown = document.querySelector(`.yum-product-dropdown[data-dropdown="${setIdx}"]`);
        if (!dropdown) return;

        if (openDropdownIdx === setIdx && !dropdown.classList.contains('hidden')) {
            closeAllDropdowns();
            return;
        }

        closeAllDropdowns();
        openDropdownIdx = setIdx;

        // Refresh products from IDB
        loadProducts().then(() => {
            dropdown.innerHTML = `
                <input type="text" class="yum-product-search" data-set="${setIdx}" placeholder="🔍 ค้นหาสินค้า...">
                <div class="yum-product-list" data-list="${setIdx}"></div>
            `;
            dropdown.classList.remove('hidden');
            renderProductOptions(setIdx, '');

            // Focus search
            const search = dropdown.querySelector('.yum-product-search');
            if (search) search.focus();
        });
    }

    function closeAllDropdowns() {
        document.querySelectorAll('.yum-product-dropdown').forEach(d => d.classList.add('hidden'));
        openDropdownIdx = -1;
    }

    function renderProductOptions(setIdx, filter = '') {
        const listEl = document.querySelector(`.yum-product-list[data-list="${setIdx}"]`);
        if (!listEl) return;

        const q = filter.toLowerCase().trim();
        const filtered = q
            ? allProducts.filter(p => {
                const name = (p.name || p.productName || p.title || '').toLowerCase();
                const desc = (p.description || '').toLowerCase();
                const id = String(p.id || '').toLowerCase();
                return name.includes(q) || desc.includes(q) || id.includes(q);
            })
            : allProducts;

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="yum-product-empty">${q ? '🔍 ไม่พบสินค้า' : '📦 ยังไม่มีสินค้า — ดึงจากลิงก์ก่อน'}</div>`;
            return;
        }

        listEl.innerHTML = filtered.map(p => {
            const name = p.name || p.productName || p.title || 'ไม่มีชื่อ';
            // Try multiple sources for product ID display
            let realPid = p.productId || '';
            if (!realPid && p.sourceUrl) {
                const m = p.sourceUrl.match(/\/product\/(\d{10,20})/);
                if (m) realPid = m[1];
            }
            const imgHtml = p.imageUrl
                ? `<img src="${p.imageUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt="">`
                : '';
            return `
                <div class="yum-product-option" data-set="${setIdx}" data-pid="${p.id}">
                    ${imgHtml}
                    <div class="yum-product-option-icon" ${p.imageUrl ? 'style="display:none"' : ''}>📦</div>
                    <div class="yum-product-option-info">
                        <div class="yum-product-option-name">${escapeHtml(name)}</div>
                        <div class="yum-product-option-id">${realPid ? 'Product ID: ' + realPid : 'ไม่มี Product ID'}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function selectProduct(setIdx, productDbId) {
        const product = allProducts.find(p => p.id === productDbId);
        if (!product) return;

        // DEBUG: log all product fields so we can see what's available
        console.log('[AutoPost] selectProduct - full product data:', JSON.stringify(product, null, 2));
        console.log('[AutoPost] selectProduct - all keys:', Object.keys(product));

        const name = product.name || product.productName || product.title || '';

        // Try multiple sources for the real TikTok product ID
        let productId = '';

        // Source 1: Direct productId field
        if (product.productId && String(product.productId).length >= 10) {
            productId = String(product.productId);
        }

        // Source 2: Extract from sourceUrl
        if (!productId && product.sourceUrl) {
            const urlMatch = product.sourceUrl.match(/\/product\/(\d{10,20})/);
            if (urlMatch) productId = urlMatch[1];
            // Also try generic URL number pattern
            if (!productId) {
                const numMatch = product.sourceUrl.match(/(\d{13,20})/);
                if (numMatch) productId = numMatch[1];
            }
        }

        // Source 3: Extract from description
        if (!productId && product.description) {
            const descMatch = product.description.match(/(\d{13,20})/);
            if (descMatch) productId = descMatch[1];
        }

        // Source 4: Scan ALL fields for a long digit string (TikTok product IDs are 13-20 digits)
        if (!productId) {
            for (const [key, val] of Object.entries(product)) {
                if (key === 'id' || key === 'price' || key === 'stock') continue; // Skip non-product-ID fields
                const str = String(val || '');
                const match = str.match(/(\d{13,20})/);
                if (match) {
                    productId = match[1];
                    console.log('[AutoPost] Found productId in field:', key, '→', productId);
                    break;
                }
            }
        }

        console.log('[AutoPost] Final productId:', productId || '(empty - product has no ID stored)');

        // Fill fields
        productSets[setIdx].productName = name;
        productSets[setIdx].productId = String(productId);

        const nameEl = document.querySelector(`.fld-name[data-set="${setIdx}"]`);
        const pidEl = document.querySelector(`.fld-pid[data-set="${setIdx}"]`);
        console.log('[AutoPost] DOM fill: nameEl=', !!nameEl, 'pidEl=', !!pidEl, 'setIdx=', setIdx);
        if (nameEl) nameEl.value = name;
        if (pidEl) {
            pidEl.value = String(productId);
            console.log('[AutoPost] ✅ Product ID field filled:', pidEl.value);
        } else {
            console.log('[AutoPost] ❌ Product ID field NOT FOUND! selector: .fld-pid[data-set="' + setIdx + '"]');
            // Fallback: try by ID
            const allPidFields = document.querySelectorAll('.fld-pid');
            console.log('[AutoPost] Total .fld-pid fields on page:', allPidFields.length);
            allPidFields.forEach((f, i) => console.log('[AutoPost]   .fld-pid[' + i + '] data-set="' + f.dataset.set + '"'));
        }

        // Update select button
        const btn = document.querySelector(`.act-select-product[data-set="${setIdx}"]`);
        if (btn) {
            btn.textContent = `✅ ${name.substring(0, 35)}${name.length > 35 ? '...' : ''}`;
            btn.classList.add('has-product');
        }

        closeAllDropdowns();
        autoSave();
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /* ═══ AI HASHTAG + CTA GENERATOR ═══ */
    async function aiGenerateHashtagsAndCTA() {
        const btn = document.getElementById('apAiGenerateBtn');
        const statusEl = document.getElementById('apAiStatus');

        // Collect sets that have a product name
        const setsWithProducts = [];
        for (let i = 0; i < MAX_SETS; i++) {
            const name = productSets[i].productName?.trim();
            if (name) {
                setsWithProducts.push({ index: i, name });
            }
        }

        if (setsWithProducts.length === 0) {
            showAiStatus('⚠️ ยังไม่มีชุดสินค้าที่มีชื่อสินค้า — เลือกสินค้าก่อน', 'error');
            return;
        }

        // Get Gemini API key
        const apiKey = getGeminiKey();
        if (!apiKey) {
            showAiStatus('❌ ไม่พบ Gemini API Key — ตั้งค่าที่ Settings ก่อน', 'error');
            return;
        }

        btn.classList.add('loading');
        btn.textContent = '⏳ AI กำลังวิเคราะห์...';
        showAiStatus(`🔄 กำลังวิเคราะห์ ${setsWithProducts.length} ชุดสินค้า...`, '');

        try {
            // Build prompt
            const productList = setsWithProducts.map((s, i) => `${i + 1}. "${s.name}"`).join('\n');

            const systemPrompt = `คุณเป็นผู้เชี่ยวชาญ TikTok Shop Marketing ที่มีความรู้เรื่อง hashtag ที่มี volume สูง
คุณต้องตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON`;

            const userPrompt = `วิเคราะห์สินค้าต่อไปนี้ สร้าง hashtag 5 อัน ที่น่าจะมี volume สูงบน TikTok สำหรับแต่ละสินค้า
และ สร้างชื่อตระกร้าแบบ CTA ปิดการขาย สั้นมากๆ ไม่เกิน 15 ตัวอักษร ไม่มีเว้นวรรค

รายการสินค้า:
${productList}

ตอบเป็น JSON array ตามรูปแบบนี้เท่านั้น:
[{"hashtags":"#tag1 #tag2 #tag3 #tag4 #tag5","basketName":"กดสั่งเลย"}]

กฎ:
- hashtag ต้องเป็นภาษาไทย เว้นแต่เป็นชื่อแบรนด์/ภาษาอังกฤษที่จำเป็น
- hashtag ควรเป็นคำค้นที่คนพิมพ์หา volume สูงบน TikTok
- ชื่อตระกร้าต้องสั้นที่สุด ห้ามเว้นวรรค ห้ามเกิน 15 ตัวอักษร เน้นปิดการขายเช่น "กดสั่งเลย" "ซื้อเลย" "สั่งเลย" "ราคาถูก" "กดซื้อ" "ลดราคา"
- ห้ามใส่อิโมจิ ห้ามมีเว้นวรรคในชื่อตระกร้า
- ตอบเป็น JSON array เท่านั้น จำนวนตรงกับจำนวนสินค้า ${setsWithProducts.length} อัน`;

            const response = await callGeminiAPI(apiKey, systemPrompt, userPrompt);

            if (!response) throw new Error('ไม่ได้รับคำตอบจาก AI');

            // Parse JSON from response
            let results;
            try {
                const jsonMatch = response.match(/\[.*\]/s);
                if (jsonMatch) {
                    results = JSON.parse(jsonMatch[0]);
                } else {
                    results = JSON.parse(response);
                }
            } catch (parseErr) {
                throw new Error('AI ตอบรูปแบบไม่ถูกต้อง — ลองใหม่อีกครั้ง');
            }

            if (!Array.isArray(results) || results.length === 0) {
                throw new Error('AI ตอบข้อมูลว่าง — ลองใหม่');
            }

            // Apply results to product sets
            let applied = 0;
            for (let i = 0; i < setsWithProducts.length && i < results.length; i++) {
                const setIdx = setsWithProducts[i].index;
                const result = results[i];

                if (result.hashtags) {
                    productSets[setIdx].hashtags = result.hashtags;
                    const el = document.querySelector(`.fld-hash[data-set="${setIdx}"]`);
                    if (el) el.value = result.hashtags;
                }

                if (result.basketName) {
                    const basket = result.basketName.substring(0, 30);
                    productSets[setIdx].basketName = basket;
                    const el = document.querySelector(`.fld-basket[data-set="${setIdx}"]`);
                    if (el) el.value = basket;
                    const cv = document.querySelector(`.char-val[data-set="${setIdx}"]`);
                    if (cv) cv.textContent = basket.length;
                }

                applied++;
            }

            autoSave();
            showAiStatus(`✅ สำเร็จ! AI สร้าง Hashtag + ชื่อตระกร้าให้ ${applied} ชุดแล้ว`, 'success');

        } catch (err) {
            console.error('[AutoPost AI]', err);
            showAiStatus(`❌ ${err.message}`, 'error');
        } finally {
            btn.classList.remove('loading');
            btn.textContent = '🤖 AI สร้าง Hashtag + ชื่อตระกร้า';
        }
    }

    function getGeminiKey() {
        try {
            const raw = localStorage.getItem('geminiApiKey');
            if (raw) {
                try { return JSON.parse(raw) || ''; } catch { return raw; }
            }
            if (window.parent && window.parent !== window) {
                const parentRaw = window.parent.localStorage.getItem('geminiApiKey');
                if (parentRaw) {
                    try { return JSON.parse(parentRaw) || ''; } catch { return parentRaw; }
                }
            }
            return '';
        } catch {
            return '';
        }
    }

    async function callGeminiAPI(apiKey, systemPrompt, userPrompt) {
        // ═══════ AAA Proxy — try managed subscription first ═══════
        if (typeof window !== 'undefined' && window.__aaa_proxy) {
            try {
                const subscribed = await window.__aaa_proxy.isSubscribed();
                if (subscribed) {
                    console.log('[AutoPost AI] Using AAA managed proxy...');
                    const payload = {
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
                    };
                    const proxyResult = await window.__aaa_proxy.proxyAICall('gemini', 'gemini-2.5-flash', payload);
                    if (proxyResult) {
                        return proxyResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    }
                }
            } catch (proxyErr) {
                console.warn('[AutoPost AI] Proxy failed, falling back to direct:', proxyErr.message);
            }
        }

        const cleanKey = apiKey.replace(/["'\s]/g, '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cleanKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 4096
                }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API Error (${response.status}): ${errText.substring(0, 150)}`);
        }

        const data = await response.json();
        if (data.error) throw new Error('Gemini: ' + data.error.message);

        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    function showAiStatus(msg, type = '') {
        const el = document.getElementById('apAiStatus');
        if (!el) return;
        el.textContent = msg;
        el.className = 'yum-ai-status';
        if (type) el.classList.add(type);
        el.classList.remove('hidden');
    }

    /* ═══ CLIP COUNT ═══ */
    function updateTotalClipCount() {
        const total = productSets.reduce((s, p) => s + p.clips.filter(c => !c.posted).length, 0);
        const el = document.getElementById('apTotalClips');
        if (el) el.textContent = total;
        const btn = document.getElementById('apStartBtn');
        if (btn) btn.disabled = total === 0;
    }

    /* ═══ SAVE / LOAD ═══ */
    function autoSave() {
        try {
            const data = productSets.map(s => ({
                basketName: s.basketName, productName: s.productName,
                productId: s.productId, hashtags: s.hashtags,
                clipNames: s.clips.map(c => c.name),
                clipPosted: s.clips.map(c => c.posted),
                clipCaptions: s.clips.map(c => c.caption || ''),
                clipHashtags: s.clips.map(c => c.hashtags || '')
            }));
            localStorage.setItem('ap_productSets', JSON.stringify(data));

            const checkedMode = document.querySelector('input[name="postMode"]:checked');
            const settings = {
                postMode: checkedMode?.value || '',
                noBasket: document.getElementById('apNoBasket')?.checked,
                storyMode: document.getElementById('apStoryMode')?.checked,
                scheduleDate: document.getElementById('apScheduleDate')?.value,
                scheduleHour: document.getElementById('apScheduleHour')?.value,
                scheduleMinute: document.getElementById('apScheduleMinute')?.value,
                scheduleInterval: document.getElementById('apScheduleInterval')?.value,
                postInterval: document.getElementById('apPostInterval')?.value
            };
            localStorage.setItem('ap_settings', JSON.stringify(settings));
        } catch (e) { console.warn('[AutoPost] Save error:', e); }
    }

    function loadSavedData() {
        try {
            const saved = JSON.parse(localStorage.getItem('ap_productSets') || '[]');
            saved.forEach((s, i) => {
                if (i >= MAX_SETS) return;
                productSets[i].basketName = s.basketName || '';
                productSets[i].productName = s.productName || '';
                productSets[i].productId = s.productId || '';
                productSets[i].hashtags = s.hashtags || '';

                const bn = document.querySelector(`.fld-basket[data-set="${i}"]`);
                if (bn) bn.value = s.basketName || '';
                const cv = document.querySelector(`.char-val[data-set="${i}"]`);
                if (cv) cv.textContent = (s.basketName || '').length;
                const pn = document.querySelector(`.fld-name[data-set="${i}"]`);
                if (pn) pn.value = s.productName || '';
                const pid = document.querySelector(`.fld-pid[data-set="${i}"]`);
                if (pid) pid.value = s.productId || '';
                const ht = document.querySelector(`.fld-hash[data-set="${i}"]`);
                if (ht) ht.value = s.hashtags || '';

                // Restore per-clip captions & hashtags
                if (s.clipCaptions || s.clipHashtags) {
                    const clipNames = s.clipNames || [];
                    clipNames.forEach((name, ci) => {
                        if (ci >= productSets[i].clips.length) {
                            // Clip files lost (no File object), create placeholder
                            productSets[i].clips.push({ file: null, name, size: 0, posted: s.clipPosted?.[ci] || false, caption: s.clipCaptions?.[ci] || '', hashtags: s.clipHashtags?.[ci] || '' });
                        } else {
                            if (s.clipCaptions?.[ci]) productSets[i].clips[ci].caption = s.clipCaptions[ci];
                            if (s.clipHashtags?.[ci]) productSets[i].clips[ci].hashtags = s.clipHashtags[ci];
                        }
                    });
                    renderClips(i);
                }
            });

            const settings = JSON.parse(localStorage.getItem('ap_settings') || '{}');
            if (settings.postMode) {
                const radio = document.querySelector(`input[name="postMode"][value="${settings.postMode}"]`);
                if (radio) {
                    radio.checked = true;
                    if (settings.postMode === 'schedule') {
                        document.getElementById('apSchedulePanel')?.classList.remove('hidden');
                    }
                }
            }
            if (settings.noBasket) document.getElementById('apNoBasket').checked = true;
            if (settings.storyMode) document.getElementById('apStoryMode').checked = true;
            if (settings.scheduleDate) document.getElementById('apScheduleDate').value = settings.scheduleDate;
            if (settings.scheduleHour) document.getElementById('apScheduleHour').value = settings.scheduleHour;
            if (settings.scheduleMinute) document.getElementById('apScheduleMinute').value = settings.scheduleMinute;
            if (settings.scheduleInterval) document.getElementById('apScheduleInterval').value = settings.scheduleInterval;
            if (settings.postInterval) document.getElementById('apPostInterval').value = settings.postInterval;
        } catch (e) { console.warn('[AutoPost] Load error:', e); }
    }

    /* ═══ EXPORT / IMPORT ═══ */
    function exportData() {
        const data = productSets.map((s, i) => ({
            set: i + 1, basketName: s.basketName, productName: s.productName,
            productId: s.productId, hashtags: s.hashtags,
            clipCount: s.clips.length, clipNames: s.clips.map(c => c.name)
        })).filter(s => s.basketName || s.productName || s.productId || s.clipCount > 0);

        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const defaultName = `autopost-${yyyy}-${mm}-${dd}`;

        function doDownload(filename) {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        }

        /* Use the shared filename modal if available */
        if (typeof window._aaa_showFilenameModal === 'function') {
            window._aaa_showFilenameModal(defaultName, doDownload);
        } else {
            doDownload(defaultName + '.json');
        }
    }

    function importData(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!Array.isArray(data)) throw new Error('Invalid');
                data.forEach(item => {
                    const idx = (item.set || 1) - 1;
                    if (idx < 0 || idx >= MAX_SETS) return;
                    productSets[idx].basketName = item.basketName || '';
                    productSets[idx].productName = item.productName || '';
                    productSets[idx].productId = item.productId || '';
                    productSets[idx].hashtags = item.hashtags || '';

                    const bn = document.querySelector(`.fld-basket[data-set="${idx}"]`);
                    if (bn) bn.value = item.basketName || '';
                    const cv = document.querySelector(`.char-val[data-set="${idx}"]`);
                    if (cv) cv.textContent = (item.basketName || '').length;
                    const pn = document.querySelector(`.fld-name[data-set="${idx}"]`);
                    if (pn) pn.value = item.productName || '';
                    const pid = document.querySelector(`.fld-pid[data-set="${idx}"]`);
                    if (pid) pid.value = item.productId || '';
                    const ht = document.querySelector(`.fld-hash[data-set="${idx}"]`);
                    if (ht) ht.value = item.hashtags || '';
                });
                autoSave();
                alert('✅ นำเข้าสำเร็จ!');
            } catch (err) {
                alert('❌ ไฟล์ไม่ถูกต้อง');
            }
        };
        reader.readAsText(file);
    }


    /* ═══ CUSTOM IN-APP POPUP ═══ */
    function showPostModeWarning() {
        // Remove existing popup if any
        document.querySelector('.yum-popup-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'yum-popup-overlay';
        overlay.innerHTML = `
            <div class="yum-popup-box">
                <div class="yum-popup-icon">⚠️</div>
                <div class="yum-popup-title">ยังไม่ได้เลือกโหมดโพส!</div>
                <div class="yum-popup-msg">กรุณาเลือกโหมดก่อนเริ่มโพส<br>(Draft / โพสทันที / ตั้งเวลา)</div>
                <button class="yum-popup-btn">👆 เลือกเลย</button>
            </div>
        `;

        // Inject styles once
        if (!document.getElementById('yum-popup-styles')) {
            const style = document.createElement('style');
            style.id = 'yum-popup-styles';
            style.textContent = `
                .yum-popup-overlay {
                    position: fixed; inset: 0; z-index: 99999;
                    background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
                    display: flex; align-items: center; justify-content: center;
                    animation: yumFadeIn 0.2s ease;
                }
                .yum-popup-box {
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border: 1px solid rgba(138,43,226,0.4);
                    border-radius: 16px; padding: 28px 32px;
                    text-align: center; max-width: 320px; width: 90%;
                    box-shadow: 0 8px 32px rgba(138,43,226,0.3), 0 0 60px rgba(138,43,226,0.1);
                    animation: yumPopIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
                }
                .yum-popup-icon { font-size: 40px; margin-bottom: 10px; }
                .yum-popup-title {
                    font-size: 17px; font-weight: 700; color: #fff; margin-bottom: 8px;
                }
                .yum-popup-msg {
                    font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.5; margin-bottom: 18px;
                }
                .yum-popup-btn {
                    background: linear-gradient(135deg, #8b5cf6, #6d28d9);
                    color: #fff; border: none; border-radius: 10px;
                    padding: 10px 28px; font-size: 15px; font-weight: 600;
                    cursor: pointer; transition: all 0.2s;
                    box-shadow: 0 4px 15px rgba(139,92,246,0.4);
                }
                .yum-popup-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(139,92,246,0.6);
                }
                @keyframes yumFadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes yumPopIn { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                @keyframes yumPulseHighlight {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(139,92,246,0); }
                    50% { box-shadow: 0 0 0 6px rgba(139,92,246,0.5); }
                }
                .yum-highlight-mode {
                    animation: yumPulseHighlight 0.6s ease 3;
                    border-color: rgba(139,92,246,0.8) !important;
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(overlay);

        // Click handler
        overlay.querySelector('.yum-popup-btn').addEventListener('click', () => {
            overlay.remove();
            // Scroll to mode section
            const modeSection = document.querySelector('.yum-mode-grid');
            if (modeSection) {
                modeSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Add pulse highlight
                modeSection.classList.add('yum-highlight-mode');
                setTimeout(() => modeSection.classList.remove('yum-highlight-mode'), 2000);
            } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });

        // Click outside to close
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    /* ═══ POSTING DASHBOARD OVERLAY ═══ */
    let _overlayState = { total: 0, posted: 0, failed: 0, paused: false, currentClip: '', countdownSec: 0 };

    function injectOverlayStyles() {
        if (document.getElementById('apDashboardStyles')) return;
        const s = document.createElement('style');
        s.id = 'apDashboardStyles';
        s.textContent = `
            .ap-dash-overlay {
                position:relative; z-index:100000;
                background:rgba(10,10,20,0.95);
                display:flex; align-items:center; justify-content:center;
                padding:16px 0;
                animation: apDashFadeIn 0.25s ease;
                font-family:'Inter','Segoe UI',system-ui,sans-serif;
            }
            @keyframes apDashFadeIn { from{opacity:0} to{opacity:1} }
            @keyframes apDashPopIn { from{transform:scale(0.92);opacity:0} to{transform:scale(1);opacity:1} }
            @keyframes apDashPulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
            .ap-dash-card {
                background:linear-gradient(145deg,#1a1a2e,#16213e);
                border:1px solid rgba(138,43,226,0.35);
                border-radius:16px; padding:20px 16px; text-align:center;
                width:100%;
                box-shadow:0 8px 32px rgba(138,43,226,0.2);
                animation: apDashPopIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
            }
            .ap-dash-title {
                font-size:15px; font-weight:700; color:#fff;
                margin-bottom:3px; letter-spacing:0.2px;
            }
            .ap-dash-subtitle {
                font-size:10px; color:rgba(255,255,255,0.45);
                margin-bottom:14px;
            }
            /* Ring */
            .ap-dash-ring-wrap {
                position:relative; width:100px; height:100px; margin:0 auto 12px;
            }
            .ap-dash-ring-wrap svg { width:100%; height:100%; transform:rotate(-90deg); }
            .ap-dash-ring-bg { stroke:rgba(255,255,255,0.08); fill:none; stroke-width:8; }
            .ap-dash-ring-fg {
                stroke:url(#apRingGrad); fill:none; stroke-width:8;
                stroke-linecap:round; transition:stroke-dashoffset 0.5s ease;
            }
            .ap-dash-ring-text {
                position:absolute; inset:0; display:flex; flex-direction:column;
                align-items:center; justify-content:center;
            }
            .ap-dash-ring-big {
                font-size:22px; font-weight:800; color:#fff;
                line-height:1;
            }
            .ap-dash-ring-label {
                font-size:9px; color:rgba(255,255,255,0.45); margin-top:2px;
                text-transform:uppercase; letter-spacing:0.8px;
            }
            /* Status line */
            .ap-dash-status {
                font-size:12px; color:rgba(255,255,255,0.85);
                margin-bottom:4px; min-height:18px;
            }
            .ap-dash-status.pulse { animation: apDashPulse 1.5s ease infinite; }
            .ap-dash-clip {
                font-size:10px; color:rgba(255,255,255,0.4);
                margin-bottom:10px; min-height:14px;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                max-width:100%; padding:0 8px;
            }
            /* Timer */
            .ap-dash-timer {
                font-size:24px; font-weight:700; font-variant-numeric:tabular-nums;
                color:#a78bfa; margin-bottom:12px; min-height:30px;
                letter-spacing:1.5px;
            }
            .ap-dash-timer.paused { color:#f59e0b; }
            /* Buttons */
            .ap-dash-btns { display:flex; gap:8px; justify-content:center; margin-top:6px; }
            .ap-dash-btn {
                border:none; border-radius:10px; padding:8px 16px;
                font-size:12px; font-weight:600; cursor:pointer;
                transition:all 0.2s; display:flex; align-items:center; gap:4px;
            }
            .ap-dash-btn:hover { transform:translateY(-1px); }
            .ap-dash-btn:active { transform:translateY(0); }
            .ap-dash-btn-pause {
                background:linear-gradient(135deg,#f59e0b,#d97706); color:#fff;
                box-shadow:0 3px 10px rgba(245,158,11,0.25);
            }
            .ap-dash-btn-resume {
                background:linear-gradient(135deg,#10b981,#059669); color:#fff;
                box-shadow:0 3px 10px rgba(16,185,129,0.25);
            }
            .ap-dash-btn-stop {
                background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff;
                box-shadow:0 3px 10px rgba(239,68,68,0.25);
            }
            .ap-dash-btn-close {
                background:linear-gradient(135deg,#8b5cf6,#6d28d9); color:#fff;
                box-shadow:0 3px 10px rgba(139,92,246,0.3);
                padding:10px 28px; font-size:13px;
            }
            /* Completion */
            .ap-dash-done-icon { font-size:36px; margin-bottom:8px; }
            .ap-dash-done-stats {
                display:flex; gap:16px; justify-content:center; margin:10px 0 16px;
            }
            .ap-dash-stat { text-align:center; }
            .ap-dash-stat-val { font-size:20px; font-weight:800; color:#fff; }
            .ap-dash-stat-label { font-size:9px; color:rgba(255,255,255,0.45); text-transform:uppercase; letter-spacing:0.8px; }
            .ap-dash-stat-val.green { color:#10b981; }
            .ap-dash-stat-val.red { color:#ef4444; }
        `;
        document.head.appendChild(s);
    }

    function showPostingOverlay(totalClips) {
        injectOverlayStyles();
        document.getElementById('apDashOverlay')?.remove();

        _overlayState = { total: totalClips, posted: 0, failed: 0, paused: false, currentClip: '', countdownSec: 0 };

        const circumference = 2 * Math.PI * 42;

        const overlay = document.createElement('div');
        overlay.id = 'apDashOverlay';
        overlay.className = 'ap-dash-overlay';
        overlay.innerHTML = `
            <div class="ap-dash-card">
                <div class="ap-dash-title">📤 กำลังโพสคลิป</div>
                <div class="ap-dash-subtitle">Auto Post Queue Active</div>

                <div class="ap-dash-ring-wrap">
                    <svg viewBox="0 0 100 100">
                        <defs>
                            <linearGradient id="apRingGrad" x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0%" stop-color="#8b5cf6"/>
                                <stop offset="100%" stop-color="#06b6d4"/>
                            </linearGradient>
                        </defs>
                        <circle class="ap-dash-ring-bg" cx="50" cy="50" r="42"/>
                        <circle id="apRingFg" class="ap-dash-ring-fg" cx="50" cy="50" r="42"
                            stroke-dasharray="${circumference}"
                            stroke-dashoffset="${circumference}"/>
                    </svg>
                    <div class="ap-dash-ring-text">
                        <div id="apRingBig" class="ap-dash-ring-big">0/${totalClips}</div>
                        <div class="ap-dash-ring-label">คลิป</div>
                    </div>
                </div>

                <div id="apDashStatus" class="ap-dash-status pulse">⏳ กำลังเตรียมไฟล์...</div>
                <div id="apDashClip" class="ap-dash-clip"></div>
                <div id="apDashTimer" class="ap-dash-timer"></div>

                <div id="apDashBtns" class="ap-dash-btns">
                    <button id="apDashPauseBtn" class="ap-dash-btn ap-dash-btn-pause" style="display:none">
                        ⏸️ หยุดชั่วคราว
                    </button>
                    <button id="apDashStopBtn" class="ap-dash-btn ap-dash-btn-stop">
                        ⏹️ หยุดทั้งหมด
                    </button>
                </div>
            </div>
        `;

        // Insert overlay into the status area instead of body
        const statusArea = document.getElementById('apStatusArea');
        if (statusArea) {
            statusArea.innerHTML = '';
            statusArea.classList.remove('hidden');
            statusArea.appendChild(overlay);
        } else {
            document.body.appendChild(overlay);
        }

        // Wire buttons
        document.getElementById('apDashPauseBtn').addEventListener('click', () => {
            if (_overlayState.paused) {
                chrome.runtime.sendMessage({ type: 'AUTO_POST_RESUME' });
            } else {
                chrome.runtime.sendMessage({ type: 'AUTO_POST_PAUSE' });
            }
        });
        document.getElementById('apDashStopBtn').addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: 'AUTO_POST_STOP' });
            const stopBtn = document.getElementById('apDashStopBtn');
            if (stopBtn) { stopBtn.disabled = true; stopBtn.textContent = '⏳ กำลังหยุด...'; }
        });
    }

    function updateOverlayProgress() {
        const { total, posted, failed } = _overlayState;
        const circumference = 2 * Math.PI * 42;
        const pct = total > 0 ? posted / total : 0;

        const ring = document.getElementById('apRingFg');
        if (ring) ring.setAttribute('stroke-dashoffset', circumference * (1 - pct));

        const big = document.getElementById('apRingBig');
        if (big) big.textContent = `${posted}/${total}`;
    }

    function overlaySetStatus(text, pulsing = false) {
        const el = document.getElementById('apDashStatus');
        if (!el) return;
        el.textContent = text;
        el.classList.toggle('pulse', pulsing);
    }

    function overlaySetClip(name) {
        const el = document.getElementById('apDashClip');
        if (el) el.textContent = name ? `📎 ${name}` : '';
    }

    function overlaySetTimer(sec) {
        const el = document.getElementById('apDashTimer');
        if (!el) return;
        if (sec <= 0) { el.textContent = ''; return; }
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        el.classList.toggle('paused', _overlayState.paused);
    }

    function overlayShowPauseBtn(show) {
        const btn = document.getElementById('apDashPauseBtn');
        if (btn) btn.style.display = show ? '' : 'none';
    }

    function overlaySetPaused(paused) {
        _overlayState.paused = paused;
        const btn = document.getElementById('apDashPauseBtn');
        if (!btn) return;
        if (paused) {
            btn.className = 'ap-dash-btn ap-dash-btn-resume';
            btn.innerHTML = '▶️ ดำเนินการต่อ';
        } else {
            btn.className = 'ap-dash-btn ap-dash-btn-pause';
            btn.innerHTML = '⏸️ หยุดชั่วคราว';
        }
    }

    function overlayLog(msg) {
        const log = document.getElementById('apDashLog');
        if (!log) return;
        const p = document.createElement('p');
        p.textContent = msg;
        log.appendChild(p);
        log.scrollTop = log.scrollHeight;
    }

    function overlayShowCompleted(posted, failed, total) {
        const card = document.querySelector('.ap-dash-card');
        if (!card) return;
        const allGood = failed === 0;
        card.innerHTML = `
            <div class="ap-dash-done-icon">${allGood ? '🎉' : '⚠️'}</div>
            <div class="ap-dash-title">${allGood ? 'โพสเสร็จสิ้น!' : 'โพสเสร็จสิ้น (มีข้อผิดพลาด)'}</div>
            <div class="ap-dash-subtitle">Auto Post Queue Completed</div>
            <div class="ap-dash-done-stats">
                <div class="ap-dash-stat">
                    <div class="ap-dash-stat-val">${total}</div>
                    <div class="ap-dash-stat-label">ทั้งหมด</div>
                </div>
                <div class="ap-dash-stat">
                    <div class="ap-dash-stat-val green">${posted}</div>
                    <div class="ap-dash-stat-label">สำเร็จ</div>
                </div>
                <div class="ap-dash-stat">
                    <div class="ap-dash-stat-val red">${failed}</div>
                    <div class="ap-dash-stat-label">ล้มเหลว</div>
                </div>
            </div>
            <div class="ap-dash-btns">
                <button id="apDashCloseBtn" class="ap-dash-btn ap-dash-btn-close">✅ ปิด</button>
            </div>
        `;
        document.getElementById('apDashCloseBtn')?.addEventListener('click', () => {
            document.getElementById('apDashOverlay')?.remove();
            resetStartButton();
        });
    }

    /* ═══ START POSTING — REAL IMPLEMENTATION ═══ */
    async function startPosting() {
        const mode = document.querySelector('input[name="postMode"]:checked')?.value;
        if (!mode) {
            showPostModeWarning();
            return;
        }

        // Build queue of clips to post
        const rawQueue = [];
        for (let i = 0; i < MAX_SETS; i++) {
            const s = productSets[i];
            s.clips.forEach((clip, ci) => {
                if (!clip.posted && clip.file) {
                    rawQueue.push({
                        setIndex: i, clipIndex: ci,
                        clipFile: clip.file, clipName: clip.name,
                        basketName: s.basketName, productName: s.productName,
                        productId: s.productId, hashtags: s.hashtags,
                        customCaption: clip.caption || '',
                        customHashtags: clip.hashtags || ''
                    });
                }
            });
        }
        if (rawQueue.length === 0) { alert('ไม่มีคลิปที่ต้องโพส'); return; }

        // Show status & disable button
        const area = document.getElementById('apStatusArea');
        const statusLog = document.getElementById('apStatusLog');
        area?.classList.remove('hidden');
        statusLog.innerHTML = `<p>📤 กำลังเตรียมคลิป ${rawQueue.length} ไฟล์...</p>`;

        const startBtn = document.getElementById('apStartBtn');
        startBtn.disabled = true;
        startBtn.textContent = '⏳ กำลังเตรียม...';

        try {
            // Read each clip file → data URL → store in chrome.storage
            const queue = [];
            for (let qi = 0; qi < rawQueue.length; qi++) {
                const item = rawQueue[qi];
                statusLog.innerHTML += `<p>📁 อ่านไฟล์ ${qi + 1}/${rawQueue.length}: ${item.clipName}</p>`;

                const dataUrl = await readFileAsDataUrl(item.clipFile);
                const clipId = `clip_${Date.now()}_${qi}`;

                // Store data URL directly in chrome.storage.local (bypasses 64MB sendMessage limit)
                // Chunk large files into 10MB pieces (chrome.storage.local per-item may have limits)
                const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per chunk
                if (dataUrl.length > CHUNK_SIZE) {
                    const numChunks = Math.ceil(dataUrl.length / CHUNK_SIZE);
                    statusLog.innerHTML += `<p>📦 ไฟล์ใหญ่ (${(dataUrl.length / 1024 / 1024).toFixed(1)}MB) - แบ่งเป็น ${numChunks} ส่วน...</p>`;
                    for (let ci = 0; ci < numChunks; ci++) {
                        const chunk = dataUrl.slice(ci * CHUNK_SIZE, (ci + 1) * CHUNK_SIZE);
                        await chrome.storage.local.set({ ['__clip_data_' + clipId + '_chunk_' + ci]: chunk });
                    }
                    // Store chunk count metadata
                    await chrome.storage.local.set({ ['__clip_data_' + clipId]: JSON.stringify({ chunked: true, numChunks }) });
                } else {
                    await chrome.storage.local.set({ ['__clip_data_' + clipId]: dataUrl });
                }

                queue.push({
                    clipId,
                    clipName: item.clipName,
                    setIndex: item.setIndex,
                    clipIndex: item.clipIndex,
                    basketName: item.basketName,
                    productName: item.productName,
                    productId: item.productId,
                    hashtags: item.hashtags,
                    customCaption: item.customCaption || '',
                    customHashtags: item.customHashtags || ''
                });
            }

            statusLog.innerHTML += `<p>✅ เตรียมไฟล์เสร็จ! เริ่มโพส...</p>`;

            // Collect settings
            const settings = {
                postMode: mode,
                noBasket: document.getElementById('apNoBasket')?.checked,
                storyMode: document.getElementById('apStoryMode')?.checked,
                scheduleDate: document.getElementById('apScheduleDate')?.value,
                scheduleHour: document.getElementById('apScheduleHour')?.value,
                scheduleMinute: document.getElementById('apScheduleMinute')?.value,
                scheduleInterval: document.getElementById('apScheduleInterval')?.value,
                postInterval: document.getElementById('apPostInterval')?.value,
                geminiApiKey: getGeminiKey() || ''
            };

            // Show the dashboard overlay
            showPostingOverlay(queue.length);

            // Send to background
            chrome.runtime.sendMessage({
                type: 'AUTO_POST_START',
                queue,
                settings
            }, (result) => {
                if (!result?.success) {
                    statusLog.innerHTML += `<p style="color:var(--accent-red);">❌ ${result?.error || 'Unknown error'}</p>`;
                    document.getElementById('apDashOverlay')?.remove();
                    startBtn.disabled = false;
                    startBtn.innerHTML = '🚀 เริ่มโพสคลิป + ปักตระกร้า (<span id="apTotalClips">' + updateTotalClipCount() + '</span> คลิป)';
                } else {
                    statusLog.innerHTML += `<p style="color:var(--accent-green);">🚀 เริ่มรันคิวโพสต์เบื้องหลัง...</p>`;
                    overlaySetStatus('🚀 เริ่มโพส...', true);
                    overlayLog('เริ่มรันคิวโพสต์');
                }
            });

            startBtn.innerHTML = '<span class="spinner"></span> ⏹️ หยุดโพส';
            startBtn.disabled = false;
            startBtn.onclick = () => {
                chrome.runtime.sendMessage({ type: 'AUTO_POST_STOP' });
                statusLog.innerHTML += `<p style="color:var(--accent-orange);">⏹️ กำลังหยุด...</p>`;
                startBtn.disabled = true;
            };

        } catch (err) {
            statusLog.innerHTML += `<p style="color:var(--accent-red);">❌ Error: ${err.message}</p>`;
            startBtn.disabled = false;
            startBtn.innerHTML = '🚀 เริ่มโพสคลิป + ปักตระกร้า (<span id="apTotalClips">0</span> คลิป)';
            updateTotalClipCount();
        }
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    // Listen for progress messages from background
    chrome.runtime?.onMessage?.addListener((message) => {
        // statusLog may be null when overlay replaces it — that's OK, overlay updates still proceed
        const statusLog = document.getElementById('apStatusLog');

        switch (message.type) {
            case 'AUTO_POST_STATE_UPDATE':
                const st = message.state;
                if (!st) break;
                if (window.__lastApStatus !== st.status) {
                    if (statusLog) statusLog.innerHTML += `<p>ℹ️ ${st.status}</p>`;
                    window.__lastApStatus = st.status;
                }
                if (!st.isRunning && window.__wasApRunning) {
                    const failText = st.totalFailed > 0 ? `ล้มเหลว: ${st.totalFailed}` : '';
                    if (statusLog) statusLog.innerHTML += `<p style="color:var(--accent-green);font-weight:600;">🎉 เสร็จสิ้น/หยุด! โพสสำเร็จ: ${st.totalSuccess} ${failText}</p>`;
                    resetStartButton();
                }
                window.__wasApRunning = st.isRunning;
                break;
            case 'AUTO_POST_PROGRESS':
                if (statusLog) statusLog.innerHTML += `<p>📤 โพสคลิป ${message.current}/${message.total}: ${message.clipName}</p>`;
                overlaySetStatus(`📤 กำลังโพสคลิป ${message.current}/${message.total}`, true);
                overlaySetClip(message.clipName);
                overlaySetTimer(0);
                overlayShowPauseBtn(false);
                break;
            case 'AUTO_POST_CLIP_DONE':
                if (message.success) {
                    if (statusLog) statusLog.innerHTML += `<p style="color:var(--accent-green);">✅ คลิป ${message.clipIndex + 1} สำเร็จ!</p>`;
                    markClipPosted(message.clipIndex);
                    _overlayState.posted++;
                } else {
                    if (statusLog) statusLog.innerHTML += `<p style="color:var(--accent-red);">❌ คลิป ${message.clipIndex + 1} ล้มเหลว: ${message.error}</p>`;
                    _overlayState.failed++;
                }
                updateOverlayProgress();
                break;
            case 'AUTO_POST_WAITING':
                if (statusLog) statusLog.innerHTML += `<p>⏳ รอ ${Math.round(message.waitMs / 60000)} นาที → คลิปที่ ${message.nextClip}...</p>`;
                _overlayState.countdownSec = message.remainingSec || Math.round(message.waitMs / 1000);
                overlaySetStatus(`⏳ รอคลิปที่ ${message.nextClip}...`, false);
                overlaySetClip('');
                overlaySetTimer(_overlayState.countdownSec);
                overlayShowPauseBtn(true);
                break;
            case 'AUTO_POST_COUNTDOWN':
                _overlayState.countdownSec = message.remainingSec;
                overlaySetTimer(message.remainingSec);
                break;
            case 'AUTO_POST_PAUSED':
                overlaySetPaused(true);
                overlaySetStatus('⏸️ หยุดชั่วคราว', false);
                overlaySetTimer(message.remainingSec);
                break;
            case 'AUTO_POST_RESUMED':
                overlaySetPaused(false);
                overlaySetStatus(`⏳ รอคลิปที่ ${message.nextClip}...`, false);
                overlaySetTimer(message.remainingSec);
                break;
            case 'AUTO_POST_FINISHED':
                if (statusLog) statusLog.innerHTML += `<p style="color:var(--accent-green);font-weight:600;">🎉 เสร็จสิ้น! โพส ${message.posted}/${message.total} | ล้มเหลว ${message.failed}</p>`;
                _overlayState.posted = message.posted;
                _overlayState.failed = message.failed;
                overlayShowCompleted(message.posted, message.failed, message.total);
                resetStartButton();
                break;
            case 'AUTO_POST_STOPPED':
                if (statusLog) statusLog.innerHTML += `<p style="color:var(--accent-orange);">⏹️ หยุดแล้ว — โพสแล้ว ${message.posted}, เหลือ ${message.remaining}</p>`;
                overlayShowCompleted(message.posted, message.failed || 0, (message.posted || 0) + (message.remaining || 0));
                resetStartButton();
                break;
            case 'AUTO_POST_LOG_UPDATE':
                if (statusLog) statusLog.innerHTML += `<p>${message.message}</p>`;
                break;
        }
        // Auto-scroll if statusLog still exists
        if (statusLog) statusLog.scrollTop = statusLog.scrollHeight;
    });

    function markClipPosted(queueIndex) {
        // Find which set/clip this corresponds to and mark as posted
        let idx = 0;
        for (let i = 0; i < MAX_SETS; i++) {
            for (let ci = 0; ci < productSets[i].clips.length; ci++) {
                if (!productSets[i].clips[ci].posted) {
                    if (idx === queueIndex) {
                        productSets[i].clips[ci].posted = true;
                        renderClips(i);
                        updateTotalClipCount();
                        autoSave();
                        return;
                    }
                    idx++;
                }
            }
        }
    }

    function resetStartButton() {
        const startBtn = document.getElementById('apStartBtn');
        if (!startBtn) return;
        updateTotalClipCount();
        const total = document.getElementById('apTotalClips')?.textContent || '0';
        startBtn.innerHTML = `🚀 เริ่มโพสคลิป + ปักตระกร้า (<span id="apTotalClips">${total}</span> คลิป)`;
        startBtn.disabled = parseInt(total) === 0;
        startBtn.onclick = startPosting;
    }

    /* ═══ HELPERS ═══ */
    function fmtDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

})();
