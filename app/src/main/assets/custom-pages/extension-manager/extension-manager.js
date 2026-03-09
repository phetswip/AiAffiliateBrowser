/* ═══════════════════════════════════════════
   Extension Manager — Real Chromium API Integration
   Connects to chrome.management + chrome.tabs
   ═══════════════════════════════════════════ */

(function () {
    'use strict';

    // ─── Theme (shared with NTP) ───
    const THEME_KEY = 'aab_theme';
    function getTheme() {
        return localStorage.getItem(THEME_KEY) ||
            (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    document.documentElement.setAttribute('data-theme', getTheme());

    // ─── Chrome API Detection ───
    const HAS_CHROME = typeof chrome !== 'undefined';
    const HAS_MANAGEMENT = HAS_CHROME && chrome.management;
    const HAS_TABS = HAS_CHROME && chrome.tabs;
    const HAS_RUNTIME = HAS_CHROME && chrome.runtime;

    console.log(`[ExtManager] Chrome APIs: management=${!!HAS_MANAGEMENT}, tabs=${!!HAS_TABS}, runtime=${!!HAS_RUNTIME}`);

    // ─── Constants ───
    const BUNDLED_EXT_ID = 'ai-affiliate-academy';
    const EXT_STORAGE_KEY = 'aab_extensions';

    // ─── DOM Elements ───
    const extensionList = document.getElementById('extensionList');
    const emptyState = document.getElementById('emptyState');
    const crxFileInput = document.getElementById('crxFileInput');
    const installCrxBtn = document.getElementById('installCrxBtn');
    const installUrlBtn = document.getElementById('installUrlBtn');
    const urlInputWrap = document.getElementById('urlInputWrap');
    const urlInput = document.getElementById('urlInput');
    const urlGoBtn = document.getElementById('urlGoBtn');

    // ─── Back Button ───
    document.getElementById('backBtn').addEventListener('click', () => {
        if (HAS_TABS) {
            // Navigate back using Chrome tab API
            chrome.tabs.getCurrent((tab) => {
                if (tab) chrome.tabs.update(tab.id, { url: 'chrome://newtab' });
            });
        } else {
            history.back();
        }
    });

    // ═══════════════════════════════════════════
    //  REAL EXTENSION LOADING — chrome.management
    // ═══════════════════════════════════════════

    async function loadRealExtensions() {
        if (!HAS_MANAGEMENT) {
            console.warn('[ExtManager] chrome.management unavailable — using bundled list');
            loadBundledExtensionCard();
            return;
        }

        try {
            const extensions = await new Promise((resolve, reject) => {
                chrome.management.getAll((result) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(result);
                    }
                });
            });

            console.log(`[ExtManager] Found ${extensions.length} installed extensions`);

            // Clear the static placeholder
            extensionList.innerHTML = '';

            // Filter: only show extensions (not themes, not self)
            const ownId = HAS_RUNTIME ? chrome.runtime.id : null;
            const userExtensions = extensions.filter(ext =>
                ext.type === 'extension' && ext.id !== ownId
            );

            if (userExtensions.length === 0) {
                emptyState.classList.remove('hidden');
            }

            userExtensions.forEach(ext => {
                addRealExtensionCard(ext);
            });

        } catch (err) {
            console.error('[ExtManager] Failed to load extensions:', err);
            loadBundledExtensionCard();
        }
    }

    function addRealExtensionCard(ext) {
        const card = document.createElement('div');
        card.className = `em-card${ext.name.includes('Ai Affiliate') ? ' em-card-featured' : ''}`;
        card.dataset.extId = ext.id;

        // Get icon URL (prefer largest available)
        let iconUrl = '';
        if (ext.icons && ext.icons.length > 0) {
            const largestIcon = ext.icons.sort((a, b) => b.size - a.size)[0];
            iconUrl = largestIcon.url;
        }

        card.innerHTML = `
            <div class="em-card-icon ${iconUrl ? '' : 'em-icon-gradient'}">
                ${iconUrl ? `<img src="${iconUrl}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;">` : `<span>🧩</span>`}
            </div>
            <div class="em-card-info">
                <div class="em-card-name">${escapeHtml(ext.name)}</div>
                <div class="em-card-meta">
                    <span class="em-badge ${ext.enabled ? 'em-badge-active' : 'em-badge-inactive'}">${ext.enabled ? 'Active' : 'Inactive'}</span>
                    <span class="em-card-version">v${ext.version}</span>
                </div>
                <div class="em-card-desc">${escapeHtml(ext.shortDescription || ext.description || '')}</div>
            </div>
            <div class="em-card-actions">
                <label class="em-toggle">
                    <input type="checkbox" ${ext.enabled ? 'checked' : ''} data-ext-id="${ext.id}">
                    <span class="em-toggle-slider"></span>
                </label>
            </div>
        `;

        extensionList.appendChild(card);

        // Real toggle handler
        const toggle = card.querySelector('input[type="checkbox"]');
        toggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            const badge = card.querySelector('.em-badge');

            try {
                await new Promise((resolve, reject) => {
                    chrome.management.setEnabled(ext.id, enabled, () => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve();
                        }
                    });
                });

                badge.textContent = enabled ? 'Active' : 'Inactive';
                badge.className = 'em-badge ' + (enabled ? 'em-badge-active' : 'em-badge-inactive');
                console.log(`[ExtManager] ${ext.name} ${enabled ? 'ENABLED' : 'DISABLED'}`);

                showToast(`${ext.name} ${enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}แล้ว`);
            } catch (err) {
                console.error('[ExtManager] Toggle failed:', err);
                e.target.checked = !enabled; // Revert
                showToast('เกิดข้อผิดพลาด: ' + err.message);
            }
        });

        // Tap card to open extension
        card.addEventListener('click', (e) => {
            if (e.target.closest('.em-toggle')) return; // Skip if clicking toggle
            openExtension(ext);
        });
    }

    function loadBundledExtensionCard() {
        // Fallback: show the static card for bundled extension
        console.log('[ExtManager] Using static bundled extension card');
    }

    // ═══════════════════════════════════════════
    //  OPEN EXTENSION — IN NEW TAB (Mobile Safe)
    // ═══════════════════════════════════════════

    function openExtension(ext) {
        if (!ext.enabled) {
            showToast('กรุณาเปิดใช้งาน Extension ก่อน');
            return;
        }

        // For popup-based extensions, open in a new tab
        const extensionUrl = `chrome-extension://${ext.id}/index.html`;

        if (HAS_TABS) {
            // MOBILE-SAFE: Always create new tab (never update current)
            chrome.tabs.create({ url: extensionUrl, active: true }, (tab) => {
                console.log(`[ExtManager] Opened ${ext.name} in tab ${tab.id}`);
            });
        } else {
            window.open(extensionUrl, '_blank');
        }
    }

    // ═══════════════════════════════════════════
    //  CRX INSTALLATION — Real File Handler
    // ═══════════════════════════════════════════

    installCrxBtn.addEventListener('click', () => {
        crxFileInput.click();
    });

    crxFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const label = installCrxBtn.querySelector('.em-install-label');
        const hint = installCrxBtn.querySelector('.em-install-hint');
        const originalLabel = label.textContent;
        const originalHint = hint.textContent;

        label.textContent = 'กำลังติดตั้ง...';
        hint.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
        installCrxBtn.style.borderColor = 'var(--accent)';

        try {
            if (HAS_MANAGEMENT && chrome.management.installReplacementWebApp) {
                // Kiwi Browser supports direct CRX installation
                // Convert file to data URL for installation
                const reader = new FileReader();
                const dataUrl = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                // Try Kiwi's extension install flow
                // Kiwi loads CRX from file:// or content:// URIs
                console.log(`[ExtManager] CRX file ready: ${file.name} (${file.size} bytes)`);

                // Store the CRX data for the native layer to pick up
                if (typeof window.aabNative !== 'undefined' && window.aabNative.installExtension) {
                    await window.aabNative.installExtension(dataUrl);
                } else {
                    // Fallback: use Kiwi's built-in extension install page
                    const blob = new Blob([await file.arrayBuffer()], { type: 'application/x-chrome-extension' });
                    const blobUrl = URL.createObjectURL(blob);

                    if (HAS_TABS) {
                        chrome.tabs.create({ url: blobUrl, active: true });
                    } else {
                        window.location.href = blobUrl;
                    }
                }

                label.textContent = '✅ ส่งไฟล์ติดตั้งแล้ว';
                hint.textContent = 'ระบบกำลังติดตั้ง...';
                showToast('กำลังติดตั้ง Extension...');

            } else {
                // For browsers without direct CRX install, redirect to chrome://extensions
                console.log('[ExtManager] No direct CRX install API — redirecting to extensions page');

                label.textContent = '⚠️ ต้องติดตั้งด้วยตนเอง';
                hint.textContent = 'กำลังเปิดหน้าจัดการส่วนขยาย...';

                setTimeout(() => {
                    if (HAS_TABS) {
                        chrome.tabs.create({ url: 'chrome://extensions', active: true });
                    } else {
                        window.location.href = 'chrome://extensions';
                    }
                }, 1000);
            }

        } catch (err) {
            console.error('[ExtManager] CRX install error:', err);
            label.textContent = '❌ ติดตั้งไม่สำเร็จ';
            hint.textContent = err.message;
            showToast('เกิดข้อผิดพลาด: ' + err.message);
        }

        // Reset UI after 3 seconds
        setTimeout(() => {
            label.textContent = originalLabel;
            hint.textContent = originalHint;
            installCrxBtn.style.borderColor = '';
        }, 3000);

        crxFileInput.value = '';
    });

    // ═══════════════════════════════════════════
    //  URL INSTALLATION
    // ═══════════════════════════════════════════

    installUrlBtn.addEventListener('click', () => {
        urlInputWrap.classList.toggle('hidden');
        if (!urlInputWrap.classList.contains('hidden')) {
            urlInput.focus();
        }
    });

    urlGoBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) return;

        if (!url.match(/\.(crx|zip)(\?.*)?$/i) && !url.includes('chrome.google.com/webstore')) {
            showToast('กรุณาใส่ URL ที่ลงท้ายด้วย .crx หรือ .zip');
            return;
        }

        urlGoBtn.textContent = 'กำลังดาวน์โหลด...';
        urlGoBtn.disabled = true;

        try {
            if (HAS_TABS) {
                // Open the URL directly — Kiwi/Chrome will handle CRX installation
                chrome.tabs.create({ url: url, active: true }, (tab) => {
                    console.log(`[ExtManager] Opened CRX URL in tab ${tab.id}`);
                });
                showToast('กำลังดาวน์โหลดและติดตั้ง...');
            } else {
                window.location.href = url;
            }

            urlGoBtn.textContent = '✅ เปิดลิงก์แล้ว';
            urlInput.value = '';

        } catch (err) {
            console.error('[ExtManager] URL install error:', err);
            urlGoBtn.textContent = '❌ ล้มเหลว';
            showToast('เกิดข้อผิดพลาด: ' + err.message);
        }

        setTimeout(() => {
            urlGoBtn.textContent = 'ติดตั้ง';
            urlGoBtn.disabled = false;
            urlInputWrap.classList.add('hidden');
        }, 2500);
    });

    urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') urlGoBtn.click();
    });

    // ═══════════════════════════════════════════
    //  BOTTOM NAV — Real Navigation
    // ═══════════════════════════════════════════

    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            let url;

            switch (action) {
                case 'home':
                    url = 'chrome://newtab';
                    break;
                case 'tabs':
                    // Open native tab switcher (Android)
                    if (HAS_TABS) {
                        chrome.tabs.query({}, (tabs) => {
                            console.log(`[ExtManager] ${tabs.length} tabs open`);
                            showToast(`${tabs.length} แท็บเปิดอยู่`);
                        });
                    }
                    return;
                case 'extensions':
                    return; // Already here
                case 'settings':
                    url = '../settings/settings.html';
                    break;
            }

            if (url) {
                if (HAS_TABS) {
                    chrome.tabs.getCurrent((tab) => {
                        if (tab) chrome.tabs.update(tab.id, { url });
                    });
                } else {
                    window.location.href = url;
                }
            }
        });
    });

    // ═══════════════════════════════════════════
    //  EXTENSION EVENT LISTENERS — Live Updates
    // ═══════════════════════════════════════════

    if (HAS_MANAGEMENT) {
        chrome.management.onInstalled.addListener((ext) => {
            console.log(`[ExtManager] Extension installed: ${ext.name}`);
            showToast(`ติดตั้ง ${ext.name} สำเร็จ!`);
            loadRealExtensions(); // Refresh list
        });

        chrome.management.onUninstalled.addListener((id) => {
            console.log(`[ExtManager] Extension uninstalled: ${id}`);
            const card = extensionList.querySelector(`[data-ext-id="${id}"]`);
            if (card) {
                card.style.transition = 'opacity 0.3s, transform 0.3s';
                card.style.opacity = '0';
                card.style.transform = 'translateX(100%)';
                setTimeout(() => card.remove(), 300);
            }
            showToast('ลบส่วนขยายแล้ว');
        });

        chrome.management.onEnabled.addListener((ext) => {
            const card = extensionList.querySelector(`[data-ext-id="${ext.id}"]`);
            if (card) {
                const badge = card.querySelector('.em-badge');
                const toggle = card.querySelector('input[type="checkbox"]');
                if (badge) {
                    badge.textContent = 'Active';
                    badge.className = 'em-badge em-badge-active';
                }
                if (toggle) toggle.checked = true;
            }
        });

        chrome.management.onDisabled.addListener((ext) => {
            const card = extensionList.querySelector(`[data-ext-id="${ext.id}"]`);
            if (card) {
                const badge = card.querySelector('.em-badge');
                const toggle = card.querySelector('input[type="checkbox"]');
                if (badge) {
                    badge.textContent = 'Inactive';
                    badge.className = 'em-badge em-badge-inactive';
                }
                if (toggle) toggle.checked = false;
            }
        });
    }

    // ═══════════════════════════════════════════
    //  UTILITIES
    // ═══════════════════════════════════════════

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showToast(message) {
        // Remove existing toast
        const existing = document.querySelector('.em-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'em-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 90px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: var(--text-primary);
            color: var(--bg-main);
            padding: 10px 20px;
            border-radius: 20px;
            font-family: var(--font-thai);
            font-size: 13px;
            font-weight: 500;
            z-index: 9999;
            opacity: 0;
            transition: all 0.3s ease;
            max-width: 300px;
            text-align: center;
            box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        `;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    // ─── Tab count badge ───
    async function updateTabCount() {
        if (!HAS_TABS) return;
        try {
            const tabs = await new Promise(resolve => chrome.tabs.query({}, resolve));
            const badge = document.querySelector('.tab-count-badge');
            if (badge) badge.textContent = tabs.length;
        } catch (e) { /* ignore */ }
    }

    // ═══════════════════════════════════════════
    //  INIT — Load real extension data
    // ═══════════════════════════════════════════

    loadRealExtensions();
    updateTabCount();

    // Public API for integration
    window.aabExtManager = {
        refresh: loadRealExtensions,
        openExtension,
        updateTabCount
    };

    console.log('[AiAffiliate Browser] Extension Manager — PRODUCTION MODE');
})();
