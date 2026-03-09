/**
 * AiAffiliate Browser — Chrome Extension API Shim v2
 * 
 * Full Chrome Extension API emulation for Android WebView.
 * Supports BOTH callback-style AND Promise-style APIs (async/await).
 * 
 * Bridge: JS ←→ Java via `window.aabBridge` (@JavascriptInterface)
 */
(function () {
    'use strict';
    if (window.__aab_shim_loaded) return;
    window.__aab_shim_loaded = true;

    const bridge = window.aabBridge;
    if (!bridge) {
        console.warn('[AAB Shim] aabBridge not available');
        return;
    }

    // ─── Callback Registry ───
    let _cbId = 0;
    const _cbs = {};

    function regCb(cb) {
        if (!cb) return -1;
        const id = ++_cbId;
        _cbs[id] = cb;
        return id;
    }

    // Wraps a bridge call: if callback provided, use it; otherwise return Promise
    function bridgeCall(fn, parseResult) {
        return function () {
            const args = Array.from(arguments);
            const lastArg = args[args.length - 1];
            const hasCallback = typeof lastArg === 'function';
            const cb = hasCallback ? args.pop() : null;

            if (cb) {
                fn.apply(null, args.concat([cb]));
            } else {
                return new Promise((resolve) => {
                    fn.apply(null, args.concat([resolve]));
                });
            }
        };
    }

    // Called by Java to deliver async results
    window.__aab_callback = function (id, resultJson) {
        const cb = _cbs[id];
        if (cb) {
            delete _cbs[id];
            try {
                if (resultJson === null || resultJson === undefined) {
                    cb(undefined);
                } else if (typeof resultJson === 'string') {
                    try { cb(JSON.parse(resultJson)); } catch (e) { cb(resultJson); }
                } else {
                    cb(resultJson);
                }
            } catch (e) {
                console.error('[AAB Shim] Callback error:', e);
            }
        }
    };

    // ─── Listener Registry ───
    const messageListeners = [];
    const storageChangeListeners = [];
    const alarmListeners = [];
    const tabsUpdatedListeners = [];
    const tabsRemovedListeners = [];
    const actionClickedListeners = [];
    const installedListeners = [];
    const startupListeners = [];

    function createEvent(arr) {
        return {
            addListener: function (fn) { if (typeof fn === 'function' && !arr.includes(fn)) arr.push(fn); },
            removeListener: function (fn) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); },
            hasListener: function (fn) { return arr.includes(fn); },
            hasListeners: function () { return arr.length > 0; }
        };
    }

    // ─── Message Dispatch (called by Java) ───
    window.__aab_dispatchMessage = function (messageJson, senderJson) {
        const message = JSON.parse(messageJson);
        const sender = senderJson ? JSON.parse(senderJson) : { id: 'aiaffiliate-extension' };
        let responseHandled = false;

        for (const listener of messageListeners) {
            try {
                const result = listener(message, sender, function sendResponse(response) {
                    if (!responseHandled) {
                        responseHandled = true;
                        try { bridge.sendMessageResponse(JSON.stringify(response || {})); } catch (e) { }
                    }
                });
                // If listener returns true, it will call sendResponse asynchronously
            } catch (e) {
                console.error('[AAB Shim] Message listener error:', e);
            }
        }
    };

    // Called by Java when storage changes
    window.__aab_storageChanged = function (changesJson, areaName) {
        const changes = JSON.parse(changesJson);
        for (const listener of storageChangeListeners) {
            try { listener(changes, areaName || 'local'); } catch (e) { }
        }
    };

    // Called by Java when alarm fires
    window.__aab_alarmFired = function (alarmJson) {
        const alarm = JSON.parse(alarmJson);
        for (const listener of alarmListeners) {
            try { listener(alarm); } catch (e) { }
        }
    };

    // Called by Java when tab is updated
    window.__aab_tabUpdated = function (tabId, changeInfoJson, tabJson) {
        const changeInfo = JSON.parse(changeInfoJson);
        const tab = JSON.parse(tabJson);
        for (const listener of tabsUpdatedListeners) {
            try { listener(tabId, changeInfo, tab); } catch (e) { }
        }
    };

    // Called by Java when tab is removed
    window.__aab_tabRemoved = function (tabId) {
        for (const listener of tabsRemovedListeners) {
            try { listener(tabId, {}); } catch (e) { }
        }
    };

    // Called by Java to fire onInstalled/onStartup
    window.__aab_onInstalled = function () {
        for (const listener of installedListeners) {
            try { listener({ reason: 'install' }); } catch (e) { }
        }
    };
    window.__aab_onStartup = function () {
        for (const listener of startupListeners) {
            try { listener(); } catch (e) { }
        }
    };

    // ─── chrome.runtime ───
    const runtime = {
        id: 'aiaffiliate-extension',
        lastError: null,

        sendMessage: function (message, callback) {
            const cbId = regCb(callback || null);
            try {
                bridge.runtimeSendMessage(JSON.stringify(message), cbId);
            } catch (e) {
                if (callback) callback(undefined);
            }
            if (!callback) {
                return new Promise((resolve) => {
                    // For fire-and-forget messages, resolve immediately
                    resolve();
                });
            }
        },

        onMessage: createEvent(messageListeners),
        onInstalled: createEvent(installedListeners),
        onStartup: createEvent(startupListeners),

        getURL: function (path) {
            return 'file:///android_asset/extension/' + path.replace(/^\//, '');
        },

        getManifest: function () {
            return {
                manifest_version: 3,
                name: 'Ai Affiliate Academy',
                version: '1.03.8'
            };
        }
    };

    // ─── chrome.storage.local (Promise + Callback) ───
    function _storageGet(keys, callback) {
        const cbId = regCb(callback);
        try {
            const keysJson = typeof keys === 'string' ? JSON.stringify([keys]) :
                Array.isArray(keys) ? JSON.stringify(keys) :
                    keys === null || keys === undefined ? JSON.stringify([]) :
                        JSON.stringify(Object.keys(keys));
            bridge.storageGet(keysJson, cbId);
        } catch (e) { callback({}); }
    }

    function _storageSet(items, callback) {
        const cbId = regCb(callback || function () { });
        try {
            bridge.storageSet(JSON.stringify(items), cbId);
        } catch (e) { if (callback) callback(); }
    }

    function _storageRemove(keys, callback) {
        const cbId = regCb(callback || function () { });
        try {
            const keysJson = typeof keys === 'string' ? JSON.stringify([keys]) : JSON.stringify(keys);
            bridge.storageRemove(keysJson, cbId);
        } catch (e) { if (callback) callback(); }
    }

    function _storageClear(callback) {
        const cbId = regCb(callback || function () { });
        try { bridge.storageClear(cbId); } catch (e) { if (callback) callback(); }
    }

    const storageLocal = {
        get: function (keys, callback) {
            if (typeof keys === 'function') { callback = keys; keys = null; }
            if (callback) { _storageGet(keys, callback); }
            else { return new Promise(resolve => _storageGet(keys, resolve)); }
        },
        set: function (items, callback) {
            if (callback) { _storageSet(items, callback); }
            else { return new Promise(resolve => _storageSet(items, resolve)); }
        },
        remove: function (keys, callback) {
            if (callback) { _storageRemove(keys, callback); }
            else { return new Promise(resolve => _storageRemove(keys, resolve)); }
        },
        clear: function (callback) {
            if (callback) { _storageClear(callback); }
            else { return new Promise(resolve => _storageClear(resolve)); }
        }
    };

    const storage = {
        local: storageLocal,
        sync: storageLocal,
        onChanged: createEvent(storageChangeListeners)
    };

    // ─── chrome.tabs (Promise + Callback) ───
    function _tabsQuery(queryInfo, callback) {
        const cbId = regCb(callback);
        try { bridge.tabsQuery(JSON.stringify(queryInfo || {}), cbId); }
        catch (e) { callback([]); }
    }

    function _tabsSendMessage(tabId, message, callback) {
        const cbId = regCb(callback);
        try { bridge.tabsSendMessage(tabId, JSON.stringify(message), cbId); }
        catch (e) { if (callback) callback(undefined); }
    }

    function _tabsCreate(props, callback) {
        const cbId = regCb(callback);
        try { bridge.tabsCreate(JSON.stringify(props || {}), cbId); }
        catch (e) { if (callback) callback({ id: 1 }); }
    }

    function _tabsUpdate(tabId, props, callback) {
        const cbId = regCb(callback);
        try { bridge.tabsUpdate(tabId, JSON.stringify(props || {}), cbId); }
        catch (e) { if (callback) callback({ id: tabId }); }
    }

    function _tabsRemove(tabIdOrIds, callback) {
        const tabIds = Array.isArray(tabIdOrIds) ? tabIdOrIds : [tabIdOrIds];
        const cbId = regCb(callback);
        try { bridge.tabsRemove(JSON.stringify(tabIds), cbId); }
        catch (e) { if (callback) callback(); }
    }

    function _tabsGet(tabId, callback) {
        const cbId = regCb(callback);
        try { bridge.tabsGetAsync(tabId, cbId); }
        catch (e) { if (callback) callback({ id: tabId, url: '', active: true }); }
    }

    const tabs = {
        query: function (q, cb) {
            if (cb) { _tabsQuery(q, cb); }
            else { return new Promise(r => _tabsQuery(q, r)); }
        },
        sendMessage: function (tabId, msg, cb) {
            if (cb) { _tabsSendMessage(tabId, msg, cb); }
            else { return new Promise(r => _tabsSendMessage(tabId, msg, r)); }
        },
        create: function (props, cb) {
            if (cb) { _tabsCreate(props, cb); }
            else { return new Promise(r => _tabsCreate(props, r)); }
        },
        update: function (tabId, props, cb) {
            if (typeof tabId === 'object') { cb = props; props = tabId; tabId = undefined; }
            if (cb) { _tabsUpdate(tabId || 0, props, cb); }
            else { return new Promise(r => _tabsUpdate(tabId || 0, props, r)); }
        },
        remove: function (tabIds, cb) {
            if (cb) { _tabsRemove(tabIds, cb); }
            else { return new Promise(r => _tabsRemove(tabIds, r)); }
        },
        get: function (tabId, cb) {
            if (cb) { _tabsGet(tabId, cb); }
            else { return new Promise(r => _tabsGet(tabId, r)); }
        },
        reload: function (tabId) {
            try { bridge.tabsReload(tabId || 0); } catch (e) { }
        },
        onUpdated: createEvent(tabsUpdatedListeners),
        onActivated: createEvent([]),
        onRemoved: createEvent(tabsRemovedListeners)
    };

    // ─── chrome.scripting (Promise + Callback) ───
    function _executeScript(details, callback) {
        const cbId = regCb(callback);
        try {
            const target = details.target || {};
            const tabId = target.tabId || 0;
            if (details.func) {
                const code = '(' + details.func.toString() + ')(' +
                    (details.args || []).map(a => JSON.stringify(a)).join(',') + ')';
                bridge.executeScript(tabId, code, cbId);
            } else if (details.files) {
                bridge.executeScriptFiles(tabId, JSON.stringify(details.files), cbId);
            }
        } catch (e) { if (callback) callback([]); }
    }

    const scripting = {
        executeScript: function (details, cb) {
            if (cb) { _executeScript(details, cb); }
            else { return new Promise(r => _executeScript(details, r)); }
        }
    };

    // ─── chrome.alarms (Promise + Callback) ───
    function _alarmsGet(name, callback) {
        const cbId = regCb(callback);
        try { bridge.alarmsGet(name || 'default', cbId); }
        catch (e) { if (callback) callback(null); }
    }

    const alarms = {
        create: function (name, alarmInfo) {
            if (typeof name === 'object') { alarmInfo = name; name = 'default'; }
            try {
                bridge.alarmsCreate(name || 'default', JSON.stringify(alarmInfo || {}));
            } catch (e) { }
        },
        get: function (name, cb) {
            if (typeof name === 'function') { cb = name; name = 'default'; }
            if (cb) { _alarmsGet(name, cb); }
            else { return new Promise(r => _alarmsGet(name, r)); }
        },
        clear: function (name, cb) {
            try { bridge.alarmsClear(name || 'default'); } catch (e) { }
            if (cb) cb(true);
            else return Promise.resolve(true);
        },
        clearAll: function (cb) {
            try { bridge.alarmsClearAll(); } catch (e) { }
            if (cb) cb(true);
            else return Promise.resolve(true);
        },
        onAlarm: createEvent(alarmListeners)
    };

    // ─── chrome.browsingData ───
    const browsingData = {
        remove: function (options, dataToRemove, cb) {
            try { bridge.clearBrowsingData(JSON.stringify(dataToRemove || {})); } catch (e) { }
            if (cb) cb();
            else return Promise.resolve();
        }
    };

    // ─── chrome.sidePanel ───
    const sidePanel = {
        open: function (options) {
            try { bridge.sidePanelOpen(JSON.stringify(options || {})); } catch (e) { }
            return Promise.resolve();
        },
        setOptions: function (options) { return Promise.resolve(); },
        setPanelBehavior: function (behavior) { return Promise.resolve(); },
        getOptions: function (cb) {
            const r = { enabled: true };
            if (cb) cb(r);
            else return Promise.resolve(r);
        }
    };

    // ─── chrome.action ───
    const action = {
        onClicked: createEvent(actionClickedListeners),
        setIcon: function () { return Promise.resolve(); },
        setBadgeText: function (details) {
            try { bridge.setBadgeText(details.text || ''); } catch (e) { }
            return Promise.resolve();
        },
        setBadgeBackgroundColor: function () { return Promise.resolve(); }
    };

    // ─── Assemble chrome object ───
    window.chrome = {
        runtime: runtime,
        storage: storage,
        tabs: tabs,
        scripting: scripting,
        browsingData: browsingData,
        alarms: alarms,
        sidePanel: sidePanel,
        action: action,
        extension: { getURL: runtime.getURL }
    };

    console.log('[AAB Shim] Chrome API Bridge v2 loaded ✅ (Promise+Callback)');
})();
