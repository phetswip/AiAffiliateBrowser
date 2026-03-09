/**
 * ═══════════════════════════════════════════════════════
 * AiAffiliate Browser — New Tab Page Controller
 * PRODUCTION MODE — Real Chromium API Integration
 * ═══════════════════════════════════════════════════════
 */
(function () {
    'use strict';

    /* ── Chrome API Detection ── */
    var HAS_CHROME = typeof chrome !== 'undefined';
    var HAS_TABS = HAS_CHROME && chrome.tabs;
    var HAS_MANAGEMENT = HAS_CHROME && chrome.management;
    var HAS_RUNTIME = HAS_CHROME && chrome.runtime;
    var HAS_BROWSING_DATA = HAS_CHROME && chrome.browsingData;

    console.log('[NTP] Chrome APIs: tabs=' + !!HAS_TABS + ', management=' + !!HAS_MANAGEMENT + ', browsingData=' + !!HAS_BROWSING_DATA);

    /* ── Search Engine URLs ── */
    var SEARCH_ENGINES = {
        google: 'https://www.google.com/search?q=',
        bing: 'https://www.bing.com/search?q=',
        duckduckgo: 'https://duckduckgo.com/?q='
    };

    /* ── Zoom Levels ── */
    var ZOOM_LEVELS = [75, 80, 90, 100, 110, 125, 150];
    var currentZoomIndex = 3; // default 100%

    /* ── State ── */
    var activePanel = null; // 'ext' | 'settings' | null

    /* ══════════════════════════════════════════════
       INITIALIZATION
       ══════════════════════════════════════════════ */
    function init() {
        loadSettings();
        setupSearch();
        setupShortcuts();
        setupExtensionPanel();
        setupSettingsPanel();
        setupZoomControl();
        setupFaviconFallbacks();
        loadRecentSites();
        exposePublicAPI();
        console.log('✅ AiAffiliate Browser NTP initialized');
    }

    /* ══════════════════════════════════════════════
       SEARCH — Real navigation via window.location
       ══════════════════════════════════════════════ */
    function setupSearch() {
        var form = document.getElementById('searchForm');
        var input = document.getElementById('searchInput');

        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                performSearch();
            });
        }

        // Also handle search button click
        var searchBtn = document.getElementById('searchBtn');
        if (searchBtn) {
            searchBtn.addEventListener('click', function (e) {
                e.preventDefault();
                performSearch();
            });
        }
    }

    function performSearch() {
        var input = document.getElementById('searchInput');
        if (!input) return;

        var query = input.value.trim();
        if (!query) return;

        // Detect if input is a URL
        if (isURL(query)) {
            var url = query;
            if (!/^https?:\/\//i.test(url)) {
                url = 'https://' + url;
            }
            navigateTo(url);
        } else {
            // Search using selected engine
            var engine = getSetting('searchEngine', 'google');
            var searchUrl = SEARCH_ENGINES[engine] || SEARCH_ENGINES.google;
            navigateTo(searchUrl + encodeURIComponent(query));
        }
    }

    function isURL(str) {
        // Simple URL detection
        if (/^https?:\/\//i.test(str)) return true;
        if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}/.test(str)) return true;
        return false;
    }

    function navigateTo(url) {
        // Save to recent sites before navigating
        addRecentSite(url);

        // Use chrome.tabs API if available (real Chromium)
        if (HAS_TABS) {
            chrome.tabs.getCurrent(function (tab) {
                if (tab) {
                    chrome.tabs.update(tab.id, { url: url });
                } else {
                    window.location.href = url;
                }
            });
        } else {
            // Fallback: direct navigation
            window.location.href = url;
        }
    }

    /* ══════════════════════════════════════════════
       SHORTCUTS — Click to navigate real tab
       ══════════════════════════════════════════════ */
    function setupShortcuts() {
        var grid = document.getElementById('shortcutsGrid');
        if (!grid) return;

        grid.addEventListener('click', function (e) {
            var shortcut = e.target.closest('.shortcut');
            if (!shortcut) return;

            e.preventDefault();
            var url = shortcut.getAttribute('data-url');
            if (url) {
                navigateTo(url);
            }
        });
    }

    /* ══════════════════════════════════════════════
       FAVICON FALLBACKS
       ══════════════════════════════════════════════ */
    function setupFaviconFallbacks() {
        var favicons = document.querySelectorAll('.shortcut-favicon');
        favicons.forEach(function (img) {
            img.addEventListener('error', function () {
                this.style.display = 'none';
                var fallback = this.parentElement.querySelector('.shortcut-fallback');
                if (fallback) {
                    fallback.style.display = 'flex';
                }
            });
        });
    }

    /* ══════════════════════════════════════════════
       EXTENSION PANEL — Real chrome.management API
       ══════════════════════════════════════════════ */
    function setupExtensionPanel() {
        var toggleBtn = document.getElementById('extToggle');
        var closeBtn = document.getElementById('closeExtPanel');
        var backdrop = document.getElementById('panelBackdrop');
        var installCrxBtn = document.getElementById('installCrxBtn');
        var installUrlBtn = document.getElementById('installUrlBtn');
        var crxFileInput = document.getElementById('crxFileInput');
        var urlExtGo = document.getElementById('urlExtGo');

        if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
                togglePanel('ext');
                // Load real extensions when panel opens
                if (activePanel === 'ext') loadRealExtensions();
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                closeAllPanels();
            });
        }

        if (backdrop) {
            backdrop.addEventListener('click', function () {
                closeAllPanels();
            });
        }

        // Extension toggles — REAL chrome.management API
        var extPanel = document.getElementById('extPanel');
        if (extPanel) {
            extPanel.addEventListener('change', function (e) {
                var checkbox = e.target;
                if (checkbox.type === 'checkbox' && checkbox.dataset.extId) {
                    var extId = checkbox.dataset.extId;
                    var enabled = checkbox.checked;

                    if (HAS_MANAGEMENT) {
                        // REAL: Use chrome.management.setEnabled
                        chrome.management.setEnabled(extId, enabled, function () {
                            if (chrome.runtime.lastError) {
                                showToast('❌ ' + chrome.runtime.lastError.message);
                                checkbox.checked = !enabled; // Revert
                                return;
                            }
                            showToast((enabled ? '✅ เปิด' : '⏸️ ปิด') + 'ส่วนขยาย');
                            console.log('[NTP] Extension ' + extId + ': ' + (enabled ? 'ENABLED' : 'DISABLED'));
                        });
                    } else {
                        // Fallback: localStorage only
                        saveSetting('ext_' + extId, enabled);
                        showToast((enabled ? '✅ เปิด' : '⏸️ ปิด') + 'ส่วนขยาย');
                    }
                }
            });

            // Click card to open extension
            extPanel.addEventListener('click', function (e) {
                var card = e.target.closest('.ext-item');
                if (!card || e.target.closest('.ext-toggle')) return;
                var extId = card.dataset.extId;
                if (extId) openExtensionById(extId);
            });
        }

        // Install from CRX file — REAL
        if (installCrxBtn && crxFileInput) {
            installCrxBtn.addEventListener('click', function () {
                crxFileInput.click();
            });

            crxFileInput.addEventListener('change', function () {
                if (this.files && this.files.length > 0) {
                    var file = this.files[0];
                    showToast('📦 กำลังติดตั้ง ' + file.name + '...');
                    console.log('[NTP] Installing CRX:', file.name, file.size, 'bytes');

                    // Create blob URL for Kiwi Browser's CRX handler
                    var blob = new Blob([file], { type: 'application/x-chrome-extension' });
                    var blobUrl = URL.createObjectURL(blob);

                    if (HAS_TABS) {
                        // Open CRX URL — Kiwi/Chrome will handle installation dialog
                        chrome.tabs.create({ url: blobUrl, active: true });
                    } else {
                        window.location.href = blobUrl;
                    }
                }
            });
        }

        // Install from URL — REAL
        if (installUrlBtn) {
            installUrlBtn.addEventListener('click', function () {
                var wrap = document.getElementById('urlInputWrap');
                if (wrap) {
                    wrap.classList.toggle('hidden');
                    if (!wrap.classList.contains('hidden')) {
                        var input = document.getElementById('urlExtInput');
                        if (input) input.focus();
                    }
                }
            });
        }

        if (urlExtGo) {
            urlExtGo.addEventListener('click', function () {
                var input = document.getElementById('urlExtInput');
                if (input && input.value.trim()) {
                    var url = input.value.trim();
                    showToast('📥 กำลังดาวน์โหลด...');
                    console.log('[NTP] Installing from URL:', url);

                    // Open the URL directly — browser handles CRX install
                    if (HAS_TABS) {
                        chrome.tabs.create({ url: url, active: true });
                    } else {
                        window.location.href = url;
                    }

                    input.value = '';
                    var wrap = document.getElementById('urlInputWrap');
                    if (wrap) wrap.classList.add('hidden');
                }
            });
        }

        // Listen for extension install/uninstall events
        if (HAS_MANAGEMENT) {
            chrome.management.onInstalled.addListener(function (ext) {
                showToast('✅ ติดตั้ง ' + ext.name + ' สำเร็จ');
                loadRealExtensions();
            });
            chrome.management.onUninstalled.addListener(function () {
                loadRealExtensions();
            });
        }
    }

    /* ══════════════════════════════════════════════
       LOAD REAL EXTENSIONS — chrome.management API
       ══════════════════════════════════════════════ */
    function loadRealExtensions() {
        if (!HAS_MANAGEMENT) {
            console.warn('[NTP] chrome.management unavailable');
            return;
        }

        chrome.management.getAll(function (extensions) {
            var extList = document.querySelector('.ext-list');
            if (!extList) return;

            var ownId = HAS_RUNTIME ? chrome.runtime.id : null;
            var userExts = extensions.filter(function (ext) {
                return ext.type === 'extension' && ext.id !== ownId;
            });

            extList.innerHTML = '';

            userExts.forEach(function (ext) {
                var iconUrl = '';
                if (ext.icons && ext.icons.length > 0) {
                    iconUrl = ext.icons.sort(function (a, b) { return b.size - a.size; })[0].url;
                }

                var item = document.createElement('div');
                item.className = 'ext-item' + (ext.name.includes('Ai Affiliate') ? ' ext-featured' : '');
                item.dataset.extId = ext.id;
                item.innerHTML =
                    '<div class="ext-icon">' +
                    (iconUrl ? '<img src="' + iconUrl + '" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;">' : '🧩') +
                    '</div>' +
                    '<div class="ext-info">' +
                    '<div class="ext-name">' + escapeHtml(ext.name) + '</div>' +
                    '<div class="ext-version">v' + ext.version + '</div>' +
                    '</div>' +
                    '<label class="ext-toggle">' +
                    '<input type="checkbox" ' + (ext.enabled ? 'checked' : '') + ' data-ext-id="' + ext.id + '">' +
                    '<span class="ext-toggle-slider"></span>' +
                    '</label>';

                extList.appendChild(item);
            });

            if (userExts.length === 0) {
                extList.innerHTML = '<div class="ext-empty">ยังไม่มี Extension ติดตั้ง</div>';
            }

            // Update extension count badge
            var badge = document.getElementById('extCount');
            if (badge) badge.textContent = userExts.length;
        });
    }

    /* ══════════════════════════════════════════════
       OPEN EXTENSION — In new tab (mobile safe)
       ══════════════════════════════════════════════ */
    function openExtensionById(extId) {
        var extensionUrl = 'chrome-extension://' + extId + '/index.html';

        if (HAS_TABS) {
            // MOBILE-SAFE: Always create new tab
            chrome.tabs.create({ url: extensionUrl, active: true }, function (tab) {
                console.log('[NTP] Opened extension in tab ' + tab.id);
            });
        } else {
            window.open(extensionUrl, '_blank');
        }
    }

    /* ══════════════════════════════════════════════
       SETTINGS PANEL — Slide from right
       ══════════════════════════════════════════════ */
    function setupSettingsPanel() {
        var toggleBtn = document.getElementById('settingsToggle');
        var closeBtn = document.getElementById('closeSettingsPanel');

        if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
                togglePanel('settings');
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                closeAllPanels();
            });
        }

        // Theme buttons
        var themeOptions = document.getElementById('themeOptions');
        if (themeOptions) {
            themeOptions.addEventListener('click', function (e) {
                var btn = e.target.closest('.theme-btn');
                if (!btn) return;

                var theme = btn.getAttribute('data-theme');
                setTheme(theme);

                // Update active state
                themeOptions.querySelectorAll('.theme-btn').forEach(function (b) {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
            });
        }

        // Search engine select
        var searchEngineSelect = document.getElementById('searchEngineSelect');
        if (searchEngineSelect) {
            searchEngineSelect.addEventListener('change', function () {
                saveSetting('searchEngine', this.value);
                showToast('🔍 เครื่องมือค้นหา: ' + this.value);
            });
        }

        // Desktop view toggle — communicates with native layer
        var desktopToggle = document.getElementById('desktopViewToggle');
        if (desktopToggle) {
            desktopToggle.addEventListener('change', function () {
                var enabled = this.checked;
                saveSetting('desktopView', enabled);

                // Notify native Android layer if available
                if (typeof window.aabNative !== 'undefined' && window.aabNative.setDesktopMode) {
                    window.aabNative.setDesktopMode(enabled);
                }
                showToast(enabled ? '🖥️ Desktop Mode เปิด — เว็บจะแสดงเหมือน PC' : '📱 Mobile Mode — เว็บจะแสดงแบบมือถือ');
                console.log('[NTP] Desktop mode: ' + (enabled ? 'ON' : 'OFF'));
            });
        }

        // Clear cache — REAL chrome.browsingData API
        var clearCacheBtn = document.getElementById('clearCacheBtn');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', function () {
                if (confirm('ล้างข้อมูลการท่องเว็บทั้งหมด?')) {
                    if (HAS_BROWSING_DATA) {
                        // REAL: Use chrome.browsingData API
                        chrome.browsingData.remove({
                            since: 0
                        }, {
                            cache: true,
                            cookies: true,
                            history: true,
                            localStorage: false, // Keep our settings
                            formData: true,
                            downloads: true
                        }, function () {
                            showToast('🗑️ ล้างข้อมูลสำเร็จ (Cache + Cookies + History)');
                            console.log('[NTP] Browsing data cleared via chrome.browsingData');
                        });
                    } else {
                        // Fallback
                        var settings = localStorage.getItem('aab_theme');
                        var zoom = localStorage.getItem('aab_zoomLevel');
                        localStorage.clear();
                        sessionStorage.clear();
                        if (settings) localStorage.setItem('aab_theme', settings);
                        if (zoom) localStorage.setItem('aab_zoomLevel', zoom);
                        showToast('🗑️ ล้างข้อมูลสำเร็จ');
                        console.log('[NTP] Browsing data cleared (localStorage)');
                    }
                }
            });
        }
    }

    /* ══════════════════════════════════════════════
       PANEL MANAGEMENT
       ══════════════════════════════════════════════ */
    function togglePanel(panelId) {
        if (activePanel === panelId) {
            closeAllPanels();
        } else {
            openPanel(panelId);
        }
    }

    function openPanel(panelId) {
        closeAllPanels();

        var panel = document.getElementById(panelId + 'Panel');
        var backdrop = document.getElementById('panelBackdrop');

        if (panel) panel.classList.add('open');
        if (backdrop) backdrop.classList.add('visible');
        activePanel = panelId;

        // Close on Escape key
        document.addEventListener('keydown', handleEscKey);
    }

    function closeAllPanels() {
        var panels = document.querySelectorAll('.slide-panel');
        panels.forEach(function (p) { p.classList.remove('open'); });

        var backdrop = document.getElementById('panelBackdrop');
        if (backdrop) backdrop.classList.remove('visible');

        activePanel = null;
        document.removeEventListener('keydown', handleEscKey);
    }

    function handleEscKey(e) {
        if (e.key === 'Escape') {
            closeAllPanels();
        }
    }

    /* ══════════════════════════════════════════════
       ZOOM CONTROL
       ══════════════════════════════════════════════ */
    function setupZoomControl() {
        var zoomIn = document.getElementById('zoomIn');
        var zoomOut = document.getElementById('zoomOut');
        var zoomLevel = document.getElementById('zoomLevel');

        // Load saved zoom
        var savedZoom = getSetting('zoomLevel', 100);
        var savedIndex = ZOOM_LEVELS.indexOf(savedZoom);
        if (savedIndex >= 0) {
            currentZoomIndex = savedIndex;
        }
        applyZoom();

        if (zoomIn) {
            zoomIn.addEventListener('click', function () {
                if (currentZoomIndex < ZOOM_LEVELS.length - 1) {
                    currentZoomIndex++;
                    applyZoom();
                    saveSetting('zoomLevel', ZOOM_LEVELS[currentZoomIndex]);
                }
            });
        }

        if (zoomOut) {
            zoomOut.addEventListener('click', function () {
                if (currentZoomIndex > 0) {
                    currentZoomIndex--;
                    applyZoom();
                    saveSetting('zoomLevel', ZOOM_LEVELS[currentZoomIndex]);
                }
            });
        }
    }

    function applyZoom() {
        var level = ZOOM_LEVELS[currentZoomIndex];
        document.body.style.zoom = (level / 100).toString();

        var zoomLabel = document.getElementById('zoomLevel');
        if (zoomLabel) {
            zoomLabel.textContent = level + '%';
        }
    }

    /* ══════════════════════════════════════════════
       THEME SYSTEM
       ══════════════════════════════════════════════ */
    function setTheme(theme) {
        saveSetting('theme', theme);

        if (theme === 'auto') {
            var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    }

    function loadTheme() {
        var saved = getSetting('theme', 'light');
        setTheme(saved);

        // Update theme button active state
        var themeOptions = document.getElementById('themeOptions');
        if (themeOptions) {
            themeOptions.querySelectorAll('.theme-btn').forEach(function (btn) {
                btn.classList.toggle('active', btn.getAttribute('data-theme') === saved);
            });
        }

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
            if (getSetting('theme', 'light') === 'auto') {
                setTheme('auto');
            }
        });
    }

    /* ══════════════════════════════════════════════
       RECENT SITES
       ══════════════════════════════════════════════ */
    function loadRecentSites() {
        var sites = getRecentSites();
        var container = document.getElementById('recentList');
        var section = document.getElementById('recentSection');

        if (!container || !section) return;

        if (sites.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        container.innerHTML = '';

        sites.slice(0, 8).forEach(function (site) {
            var item = document.createElement('a');
            item.className = 'recent-item';
            item.href = 'javascript:void(0)';

            var domain = extractDomain(site.url);
            var faviconUrl = 'https://www.google.com/s2/favicons?domain=' + domain + '&sz=32';

            item.innerHTML =
                '<img src="' + faviconUrl + '" alt="" class="recent-item-favicon" onerror="this.style.opacity=\'0.3\'">' +
                '<div class="recent-item-info">' +
                '  <div class="recent-item-title">' + escapeHtml(site.title || domain) + '</div>' +
                '  <div class="recent-item-url">' + escapeHtml(site.url) + '</div>' +
                '</div>';

            item.addEventListener('click', function (e) {
                e.preventDefault();
                navigateTo(site.url);
            });

            container.appendChild(item);
        });
    }

    function addRecentSite(url) {
        try {
            var sites = getRecentSites();
            var domain = extractDomain(url);

            // Remove duplicate
            sites = sites.filter(function (s) { return s.url !== url; });

            // Add to front
            sites.unshift({
                url: url,
                title: domain,
                timestamp: Date.now()
            });

            // Keep max 20
            sites = sites.slice(0, 20);

            localStorage.setItem('aab_recent_sites', JSON.stringify(sites));
        } catch (e) {
            console.warn('⚠️ Could not save recent site:', e);
        }
    }

    function getRecentSites() {
        try {
            var data = localStorage.getItem('aab_recent_sites');
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    /* ══════════════════════════════════════════════
       SETTINGS PERSISTENCE
       ══════════════════════════════════════════════ */
    function saveSetting(key, value) {
        try {
            localStorage.setItem('aab_' + key, JSON.stringify(value));
        } catch (e) {
            console.warn('⚠️ Could not save setting:', key, e);
        }
    }

    function getSetting(key, fallback) {
        try {
            var data = localStorage.getItem('aab_' + key);
            return data !== null ? JSON.parse(data) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function loadSettings() {
        // Theme
        loadTheme();

        // Search engine
        var engineSelect = document.getElementById('searchEngineSelect');
        if (engineSelect) {
            engineSelect.value = getSetting('searchEngine', 'google');
        }

        // Desktop view
        var desktopToggle = document.getElementById('desktopViewToggle');
        if (desktopToggle) {
            desktopToggle.checked = getSetting('desktopView', true);
        }

        // Extension states
        var extToggles = document.querySelectorAll('[data-ext-id]');
        extToggles.forEach(function (el) {
            if (el.type === 'checkbox') {
                var saved = getSetting('ext_' + el.dataset.extId, el.checked);
                el.checked = saved;
            }
        });
    }

    /* ══════════════════════════════════════════════
       TOAST NOTIFICATIONS
       ══════════════════════════════════════════════ */
    var toastTimer = null;

    function showToast(msg) {
        // Remove existing toast
        var existing = document.querySelector('.toast');
        if (existing) existing.remove();
        if (toastTimer) clearTimeout(toastTimer);

        var toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        document.body.appendChild(toast);

        // Show with animation
        requestAnimationFrame(function () {
            toast.classList.add('visible');
        });

        toastTimer = setTimeout(function () {
            toast.classList.remove('visible');
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 2500);
    }

    /* ══════════════════════════════════════════════
       TAB COUNT — Real chrome.tabs integration
       ══════════════════════════════════════════════ */
    function updateTabCount() {
        if (!HAS_TABS) return;
        chrome.tabs.query({}, function (tabs) {
            var badge = document.querySelector('.tab-count');
            if (badge) badge.textContent = tabs.length;
        });
    }

    /* ══════════════════════════════════════════════
       PUBLIC API — For WebView bridge integration
       ══════════════════════════════════════════════ */
    function exposePublicAPI() {
        window.AiAffiliateBrowser = {
            navigate: function (url) {
                navigateTo(url);
            },
            goHome: function () {
                window.location.reload();
            },
            setTheme: function (theme) {
                setTheme(theme);
            },
            toggleExtensions: function () {
                togglePanel('ext');
                if (activePanel === 'ext') loadRealExtensions();
            },
            toggleSettings: function () {
                togglePanel('settings');
            },
            setZoom: function (level) {
                var idx = ZOOM_LEVELS.indexOf(level);
                if (idx >= 0) {
                    currentZoomIndex = idx;
                    applyZoom();
                    saveSetting('zoomLevel', level);
                }
            },
            openExtension: function (extId) {
                openExtensionById(extId);
            },
            getTabCount: function () {
                updateTabCount();
            },
            getVersion: function () {
                return '1.5.0-browser';
            }
        };

        // Auto-load extension list on init
        loadRealExtensions();
        updateTabCount();
    }

    /* ══════════════════════════════════════════════
       HELPERS
       ══════════════════════════════════════════════ */
    function extractDomain(url) {
        try {
            var match = url.match(/^https?:\/\/([^/?#]+)/i);
            return match ? match[1] : url;
        } catch (e) {
            return url;
        }
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /* ── Start ── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
