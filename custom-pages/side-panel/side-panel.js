/* ═══════════════════════════════════════════
   Side Panel — Real Extension WebView Integration
   Loads actual extension content via chrome-extension:// URLs
   Manages Tab lifecycle for mobile-safe operation
   ═══════════════════════════════════════════ */

(function () {
    'use strict';

    // ─── Theme sync ───
    const THEME_KEY = 'aab_theme';
    function getTheme() {
        return localStorage.getItem(THEME_KEY) ||
            (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    document.documentElement.setAttribute('data-theme', getTheme());

    // ─── Chrome API Detection ───
    const HAS_CHROME = typeof chrome !== 'undefined';
    const HAS_TABS = HAS_CHROME && chrome.tabs;
    const HAS_MANAGEMENT = HAS_CHROME && chrome.management;
    const HAS_RUNTIME = HAS_CHROME && chrome.runtime;

    console.log(`[SidePanel] Chrome APIs: tabs=${!!HAS_TABS}, management=${!!HAS_MANAGEMENT}`);

    // ─── Elements ───
    const layout = document.getElementById('spLayout');
    const main = document.getElementById('spMain');
    const divider = document.getElementById('spDivider');
    const panel = document.getElementById('spPanel');
    const modeLabel = document.getElementById('modeLabel');
    const pinBtn = document.getElementById('pinBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const closeBtn = document.getElementById('closeBtn');
    const extTabs = document.getElementById('extTabs');
    const extBody = document.getElementById('extBody');

    // ─── State ───
    let currentMode = 'hidden';
    let splitRatio = 0.6;
    let isDragging = false;
    let activeExtensionId = null;
    let extensionTabId = null;  // Track the extension's tab for mobile
    let workTabId = null;       // Track the work tab (TikTok/Flow/etc)

    // ═══════════════════════════════════════════
    //  FIND AI AFFILIATE ACADEMY EXTENSION
    // ═══════════════════════════════════════════

    async function findExtension() {
        if (!HAS_MANAGEMENT) {
            console.warn('[SidePanel] No chrome.management — cannot locate extension');
            return null;
        }

        return new Promise((resolve) => {
            chrome.management.getAll((extensions) => {
                const ext = extensions.find(e =>
                    e.name.includes('Ai Affiliate') ||
                    e.name.includes('Triple Bot') ||
                    e.name.includes('AiAffiliate')
                );
                if (ext) {
                    activeExtensionId = ext.id;
                    console.log(`[SidePanel] Found extension: ${ext.name} (${ext.id})`);
                }
                resolve(ext || null);
            });
        });
    }

    // ═══════════════════════════════════════════
    //  LOAD EXTENSION CONTENT — REAL IFRAME
    // ═══════════════════════════════════════════

    async function loadExtensionContent(page = 'index.html') {
        const ext = await findExtension();

        if (!ext) {
            extBody.innerHTML = `
                <div class="sp-ext-placeholder">
                    <div class="sp-ext-placeholder-icon">⚠️</div>
                    <h3>ไม่พบ Extension</h3>
                    <p>กรุณาติดตั้ง Ai Affiliate Academy ก่อน</p>
                    <button class="sp-install-btn" id="installExtBtn">ติดตั้งตอนนี้</button>
                </div>
            `;
            const installBtn = document.getElementById('installExtBtn');
            if (installBtn) {
                installBtn.addEventListener('click', () => {
                    window.location.href = '../extension-manager/extension-manager.html';
                });
            }
            return;
        }

        if (!ext.enabled) {
            extBody.innerHTML = `
                <div class="sp-ext-placeholder">
                    <div class="sp-ext-placeholder-icon">🔒</div>
                    <h3>Extension ปิดอยู่</h3>
                    <p>${ext.name} ถูกปิดใช้งาน</p>
                    <button class="sp-install-btn" id="enableExtBtn">เปิดใช้งาน</button>
                </div>
            `;
            const enableBtn = document.getElementById('enableExtBtn');
            if (enableBtn) {
                enableBtn.addEventListener('click', async () => {
                    chrome.management.setEnabled(ext.id, true, () => {
                        loadExtensionContent(page);
                    });
                });
            }
            return;
        }

        // ─── LOAD REAL EXTENSION UI ───
        const extensionUrl = `chrome-extension://${ext.id}/${page}`;
        console.log(`[SidePanel] Loading extension: ${extensionUrl}`);

        // Update panel header
        const panelName = panel.querySelector('.sp-panel-name');
        const panelVersion = panel.querySelector('.sp-panel-version');
        if (panelName) panelName.textContent = ext.name;
        if (panelVersion) panelVersion.textContent = `v${ext.version}`;

        // Create iframe to load extension content
        extBody.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.id = 'extIframe';
        iframe.src = extensionUrl;
        iframe.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
            border-radius: 0;
            background: var(--bg-main);
        `;
        iframe.setAttribute('allow', 'clipboard-read; clipboard-write; downloads');

        // Handle load events
        iframe.addEventListener('load', () => {
            console.log(`[SidePanel] Extension loaded successfully: ${page}`);
        });

        iframe.addEventListener('error', (e) => {
            console.error('[SidePanel] Failed to load extension:', e);
            extBody.innerHTML = `
                <div class="sp-ext-placeholder">
                    <div class="sp-ext-placeholder-icon">❌</div>
                    <h3>โหลดไม่สำเร็จ</h3>
                    <p>ลองเปิดใน tab ใหม่แทน</p>
                    <button class="sp-install-btn" id="openTabBtn">เปิดใน Tab ใหม่</button>
                </div>
            `;
            document.getElementById('openTabBtn')?.addEventListener('click', () => {
                openExtensionInNewTab(extensionUrl);
            });
        });

        extBody.appendChild(iframe);
    }

    // ═══════════════════════════════════════════
    //  MOBILE-SAFE TAB MANAGEMENT
    // ═══════════════════════════════════════════

    function openExtensionInNewTab(url) {
        if (!url && activeExtensionId) {
            url = `chrome-extension://${activeExtensionId}/index.html`;
        }

        if (HAS_TABS) {
            // CRITICAL: Always create NEW tab on mobile to prevent self-displacement
            chrome.tabs.create({ url: url, active: true }, (tab) => {
                extensionTabId = tab.id;
                console.log(`[SidePanel] Extension opened in new tab: ${tab.id}`);
            });
        } else {
            window.open(url, '_blank');
        }
    }

    async function switchToWorkTab() {
        if (!HAS_TABS || !workTabId) return;

        try {
            await new Promise((resolve, reject) => {
                chrome.tabs.update(workTabId, { active: true }, (tab) => {
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve(tab);
                });
            });
            console.log(`[SidePanel] Switched to work tab: ${workTabId}`);
        } catch (e) {
            console.warn('[SidePanel] Work tab lost, creating new one');
            workTabId = null;
        }
    }

    async function switchToExtensionTab() {
        if (!HAS_TABS || !extensionTabId) {
            openExtensionInNewTab();
            return;
        }

        try {
            await new Promise((resolve, reject) => {
                chrome.tabs.update(extensionTabId, { active: true }, (tab) => {
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve(tab);
                });
            });
            console.log(`[SidePanel] Switched to extension tab: ${extensionTabId}`);
        } catch (e) {
            console.warn('[SidePanel] Extension tab lost, opening new one');
            extensionTabId = null;
            openExtensionInNewTab();
        }
    }

    // ═══════════════════════════════════════════
    //  MODE SWITCHING
    // ═══════════════════════════════════════════

    function setMode(mode) {
        currentMode = mode;
        layout.setAttribute('data-mode', mode);
        modeLabel.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);

        if (mode === 'split') {
            applySplitRatio();
        }

        if (mode !== 'hidden') {
            localStorage.setItem('aab_panel_mode', mode);
            // Load extension content when panel opens
            if (!extBody.querySelector('#extIframe')) {
                loadExtensionContent();
            }
        }

        console.log(`[SidePanel] Mode: ${mode}`);
    }

    function applySplitRatio() {
        main.style.flex = splitRatio;
        panel.style.flex = 1 - splitRatio;
    }

    function togglePanel() {
        if (currentMode === 'hidden') {
            const lastMode = localStorage.getItem('aab_panel_mode') || 'slide';
            setMode(lastMode);
        } else {
            setMode('hidden');
        }
    }

    // ─── Control Buttons ───
    pinBtn.addEventListener('click', () => {
        if (currentMode === 'slide') setMode('split');
        else if (currentMode === 'split') setMode('slide');
        else setMode('split');
    });

    fullscreenBtn.addEventListener('click', () => {
        if (currentMode === 'full') setMode('split');
        else setMode('full');
    });

    closeBtn.addEventListener('click', () => {
        setMode('hidden');
    });

    // ═══════════════════════════════════════════
    //  EXTENSION FEATURE TABS — Real Navigation
    // ═══════════════════════════════════════════

    const TAB_PAGES = {
        'auto-ultra': 'index.html',
        'fashion': 'fashion-mode.html',
        'storyboard': 'story-mode.html',
        'comment': 'comment-reply.html',
        'scraper': 'index.html',
        'auto-post': 'auto-post.html',
        'ultra-cut': 'ultra-cut.html'
    };

    extTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.sp-ext-tab');
        if (!tab) return;

        extTabs.querySelectorAll('.sp-ext-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const tabName = tab.dataset.tab;
        const page = TAB_PAGES[tabName] || 'index.html';

        console.log(`[SidePanel] Tab: ${tabName} → ${page}`);
        loadExtensionContent(page);
    });

    // ═══════════════════════════════════════════
    //  RESIZABLE DIVIDER (Split Mode)
    // ═══════════════════════════════════════════

    function startDrag(e) {
        if (currentMode !== 'split') return;
        isDragging = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
        const layoutWidth = layout.offsetWidth;
        const startRatio = splitRatio;

        function onMove(ev) {
            if (!isDragging) return;
            const currentX = ev.type === 'touchmove' ? ev.touches[0].clientX : ev.clientX;
            const delta = (currentX - startX) / layoutWidth;
            splitRatio = Math.max(0.3, Math.min(0.8, startRatio + delta));
            applySplitRatio();
        }

        function onEnd() {
            isDragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            localStorage.setItem('aab_split_ratio', splitRatio);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
    }

    divider.addEventListener('mousedown', startDrag);
    divider.addEventListener('touchstart', startDrag, { passive: false });

    // ═══════════════════════════════════════════
    //  SWIPE GESTURE (Open/Close Panel)
    // ═══════════════════════════════════════════

    let touchStartX = 0;
    let touchStartY = 0;

    document.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;

        if (Math.abs(deltaX) < 80 || Math.abs(deltaY) > Math.abs(deltaX)) return;

        if (deltaX < -80 && currentMode === 'hidden') {
            setMode('slide');
        } else if (deltaX > 80 && currentMode === 'slide') {
            setMode('hidden');
        }
    }, { passive: true });

    // ─── Backdrop close (slide mode) ───
    layout.addEventListener('click', (e) => {
        if (currentMode === 'slide' && e.target === layout) {
            setMode('hidden');
        }
    });

    // ─── Demo Controls ───
    document.querySelectorAll('.sp-demo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setMode(btn.dataset.mode);
        });
    });

    // ─── Load saved state ───
    const savedRatio = parseFloat(localStorage.getItem('aab_split_ratio'));
    if (!isNaN(savedRatio)) splitRatio = savedRatio;

    // ═══════════════════════════════════════════
    //  postMessage BRIDGE — Extension ↔ Browser
    // ═══════════════════════════════════════════

    window.addEventListener('message', (event) => {
        if (!event.data || event.data.source !== 'aab-extension') return;

        const { type, payload } = event.data;
        console.log(`[SidePanel] Message from extension: ${type}`, payload);

        switch (type) {
            case 'OPEN_URL':
                // Extension wants to open a URL (e.g., TikTok, Flow)
                if (HAS_TABS) {
                    chrome.tabs.create({ url: payload.url, active: true }, (tab) => {
                        workTabId = tab.id;
                        console.log(`[SidePanel] Opened work URL in tab ${tab.id}`);
                    });
                } else {
                    window.open(payload.url, '_blank');
                }
                break;

            case 'SWITCH_TAB':
                if (payload.target === 'work') switchToWorkTab();
                else if (payload.target === 'extension') switchToExtensionTab();
                break;

            case 'MODE_CHANGE':
                setMode(payload.mode);
                break;

            case 'STATUS_UPDATE':
                // Extension reports status (e.g., "posting to TikTok")
                console.log(`[SidePanel] Status: ${payload.status}`);
                break;
        }
    });

    // ═══════════════════════════════════════════
    //  GLOBAL API
    // ═══════════════════════════════════════════

    window.aabSidePanel = {
        toggle: togglePanel,
        setMode,
        getMode: () => currentMode,
        isOpen: () => currentMode !== 'hidden',
        loadExtension: loadExtensionContent,
        openInNewTab: openExtensionInNewTab,
        switchToWork: switchToWorkTab,
        switchToExtension: switchToExtensionTab,
        getExtensionId: () => activeExtensionId
    };

    console.log('[AiAffiliate Browser] Side Panel — PRODUCTION MODE (swipe left to open)');
})();
