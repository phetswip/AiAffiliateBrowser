/**
 * AiAffiliate Browser — Chrome Extension API Shim
 * 
 * Emulates the Chrome Extension API surface so that existing
 * Chrome extensions can run inside our Android WebView browser.
 * 
 * Bridge: JS ←→ Java via `window.aabBridge` (@JavascriptInterface)
 * 
 * Supported APIs:
 *   chrome.runtime.sendMessage / onMessage / getURL / lastError
 *   chrome.storage.local.get / set / remove
 *   chrome.storage.onChanged
 *   chrome.tabs.sendMessage / reload / query / create
 *   chrome.scripting.executeScript
 *   chrome.browsingData.remove
 *   chrome.alarms.create / onAlarm
 *   chrome.sidePanel (stub)
 */
(function () {
    'use strict';

    // Prevent double-injection
    if (window.__aab_shim_loaded) return;
    window.__aab_shim_loaded = true;

    const bridge = window.aabBridge;
    if (!bridge) {
        console.warn('[AAB Shim] aabBridge not available');
        return;
    }

    // ─── Listener Registry ───
    const messageListeners = [];
    const storageChangeListeners = [];
    const alarmListeners = [];

    // Callback registry for async responses
    let _callbackId = 0;
    const _callbacks = {};

    function registerCallback(cb) {
        if (!cb) return -1;
        const id = ++_callbackId;
        _callbacks[id] = cb;
        return id;
    }

    // Called by Java to deliver async callback results
    window.__aab_callback = function (id, resultJson) {
        const cb = _callbacks[id];
        if (cb) {
            delete _callbacks[id];
            try {
                cb(resultJson ? JSON.parse(resultJson) : undefined);
            } catch (e) {
                cb(resultJson);
            }
        }
    };

    // Called by Java to dispatch incoming messages to content scripts
    window.__aab_dispatchMessage = function (messageJson, senderJson) {
        const message = JSON.parse(messageJson);
        const sender = senderJson ? JSON.parse(senderJson) : { id: 'aiaffiliate-extension' };

        for (const listener of messageListeners) {
            try {
                // Chrome onMessage: listener(message, sender, sendResponse)
                const result = listener(message, sender, function sendResponse(response) {
                    // Send response back via bridge
                    bridge.sendMessageResponse(JSON.stringify(response || {}));
                });
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

    // ─── Event Emitter Helper ───
    function createEventTarget(listenerArray) {
        return {
            addListener: function (fn) {
                if (typeof fn === 'function' && !listenerArray.includes(fn)) {
                    listenerArray.push(fn);
                }
            },
            removeListener: function (fn) {
                const idx = listenerArray.indexOf(fn);
                if (idx >= 0) listenerArray.splice(idx, 1);
            },
            hasListener: function (fn) {
                return listenerArray.includes(fn);
            },
            hasListeners: function () {
                return listenerArray.length > 0;
            }
        };
    }

    // ─── chrome.runtime ───
    const runtime = {
        id: 'aiaffiliate-extension',
        lastError: null,

        sendMessage: function (message, callback) {
            const cbId = registerCallback(callback);
            try {
                bridge.runtimeSendMessage(JSON.stringify(message), cbId);
            } catch (e) {
                console.error('[AAB Shim] sendMessage error:', e);
                if (callback) callback(undefined);
            }
        },

        onMessage: createEventTarget(messageListeners),

        getURL: function (path) {
            // Return the asset path for bundled extension files
            return 'file:///android_asset/extension/' + path.replace(/^\//, '');
        },

        onInstalled: createEventTarget([]),
        onStartup: createEventTarget([]),

        getManifest: function () {
            return {
                manifest_version: 3,
                name: 'Ai Affiliate Academy',
                version: '1.03.8'
            };
        }
    };

    // ─── chrome.storage ───
    const storageLocal = {
        get: function (keys, callback) {
            const cbId = registerCallback(callback);
            try {
                const keysJson = typeof keys === 'string' ? JSON.stringify([keys]) :
                    Array.isArray(keys) ? JSON.stringify(keys) :
                        keys === null || keys === undefined ? JSON.stringify([]) :
                            JSON.stringify(Object.keys(keys));
                bridge.storageGet(keysJson, cbId);
            } catch (e) {
                console.error('[AAB Shim] storage.get error:', e);
                if (callback) callback({});
            }
        },

        set: function (items, callback) {
            const cbId = registerCallback(callback);
            try {
                bridge.storageSet(JSON.stringify(items), cbId);
            } catch (e) {
                console.error('[AAB Shim] storage.set error:', e);
                if (callback) callback();
            }
        },

        remove: function (keys, callback) {
            const cbId = registerCallback(callback);
            try {
                const keysJson = typeof keys === 'string' ? JSON.stringify([keys]) : JSON.stringify(keys);
                bridge.storageRemove(keysJson, cbId);
            } catch (e) {
                console.error('[AAB Shim] storage.remove error:', e);
                if (callback) callback();
            }
        },

        clear: function (callback) {
            const cbId = registerCallback(callback);
            try {
                bridge.storageClear(cbId);
            } catch (e) {
                if (callback) callback();
            }
        }
    };

    const storage = {
        local: storageLocal,
        sync: storageLocal, // Map sync to local
        onChanged: createEventTarget(storageChangeListeners)
    };

    // ─── chrome.tabs ───
    const tabs = {
        query: function (queryInfo, callback) {
            const cbId = registerCallback(callback);
            try {
                bridge.tabsQuery(JSON.stringify(queryInfo || {}), cbId);
            } catch (e) {
                if (callback) callback([]);
            }
        },

        sendMessage: function (tabId, message, callback) {
            const cbId = registerCallback(callback);
            try {
                bridge.tabsSendMessage(tabId, JSON.stringify(message), cbId);
            } catch (e) {
                if (callback) callback(undefined);
            }
        },

        reload: function (tabId, reloadProperties) {
            try { bridge.tabsReload(tabId || 0); } catch (e) { }
        },

        create: function (createProperties, callback) {
            try {
                bridge.tabsCreate(JSON.stringify(createProperties || {}));
                if (callback) callback({ id: 1, url: createProperties.url });
            } catch (e) {
                if (callback) callback(undefined);
            }
        },

        get: function (tabId, callback) {
            try {
                const tabJson = bridge.tabsGet(tabId);
                if (callback) callback(JSON.parse(tabJson));
            } catch (e) {
                if (callback) callback({ id: tabId, url: '' });
            }
        },

        update: function (tabId, updateProperties, callback) {
            if (updateProperties && updateProperties.url) {
                try { bridge.tabsCreate(JSON.stringify(updateProperties)); } catch (e) { }
            }
            if (callback) callback({ id: tabId });
        },

        onUpdated: createEventTarget([]),
        onActivated: createEventTarget([]),
        onRemoved: createEventTarget([])
    };

    // ─── chrome.scripting ───
    const scripting = {
        executeScript: function (details, callback) {
            const cbId = registerCallback(callback);
            try {
                const target = details.target || {};
                const tabId = target.tabId || 0;

                if (details.func) {
                    // Convert function to string and execute
                    const code = '(' + details.func.toString() + ')(' +
                        (details.args || []).map(a => JSON.stringify(a)).join(',') + ')';
                    bridge.executeScript(tabId, code, cbId);
                } else if (details.files) {
                    // Load files from assets
                    bridge.executeScriptFiles(tabId, JSON.stringify(details.files), cbId);
                }
            } catch (e) {
                console.error('[AAB Shim] executeScript error:', e);
                if (callback) callback([]);
            }
        }
    };

    // ─── chrome.browsingData ───
    const browsingData = {
        remove: function (options, dataToRemove, callback) {
            try {
                bridge.clearBrowsingData(JSON.stringify(dataToRemove || {}));
            } catch (e) { }
            if (callback) callback();
        }
    };

    // ─── chrome.alarms ───
    const alarms = {
        create: function (name, alarmInfo) {
            try {
                bridge.alarmsCreate(
                    typeof name === 'string' ? name : 'default',
                    JSON.stringify(typeof name === 'object' ? name : (alarmInfo || {}))
                );
            } catch (e) { }
        },

        clear: function (name, callback) {
            try { bridge.alarmsClear(name || 'default'); } catch (e) { }
            if (callback) callback(true);
        },

        onAlarm: createEventTarget(alarmListeners)
    };

    // ─── chrome.sidePanel (stub) ───
    const sidePanel = {
        open: function () { },
        setOptions: function () { },
        setPanelBehavior: function () { },
        getOptions: function (callback) { if (callback) callback({}); }
    };

    // ─── chrome.action (stub for popup) ───
    const action = {
        onClicked: createEventTarget([]),
        setIcon: function () { },
        setBadgeText: function (details) {
            try { bridge.setBadgeText(details.text || ''); } catch (e) { }
        },
        setBadgeBackgroundColor: function () { }
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

        // Legacy compatibility
        extension: {
            getURL: runtime.getURL
        }
    };

    console.log('[AAB Shim] Chrome API Bridge loaded ✅');
})();
