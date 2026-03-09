package com.aiaffiliate.browser;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * AiAffiliate Browser — Extension Bridge v2
 * Full Chrome Extension API bridge: storage, tabs, scripting, alarms,
 * sidePanel.
 * Supports Promise-based async APIs.
 */
public class ExtensionBridge {

    private static final String TAG = "ExtBridge";
    private static final String STORAGE_PREFS = "ext_storage";

    private final Context context;
    private final Handler mainHandler;
    private WebView contentWebView;
    private WebView backgroundWebView;

    // Side panel callback
    private SidePanelCallback sidePanelCallback;

    // Alarm storage
    private final Map<String, Runnable> activeAlarms = new HashMap<>();
    private final Map<String, Long> alarmScheduledTimes = new HashMap<>();
    private final Map<String, Double> alarmPeriods = new HashMap<>();

    public interface SidePanelCallback {
        void onOpenSidePanel();
    }

    public ExtensionBridge(Context context) {
        this.context = context;
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    public void setContentWebView(WebView webView) {
        this.contentWebView = webView;
    }

    public void setBackgroundWebView(WebView webView) {
        this.backgroundWebView = webView;
    }

    public void setSidePanelCallback(SidePanelCallback cb) {
        this.sidePanelCallback = cb;
    }

    // ─── chrome.runtime.sendMessage ───
    @JavascriptInterface
    public void runtimeSendMessage(String messageJson, int callbackId) {
        mainHandler.post(() -> {
            if (backgroundWebView != null) {
                String escaped = esc(messageJson);
                String senderJson = "{\"id\":\"aiaffiliate-extension\",\"tab\":{\"id\":1}}";
                backgroundWebView.evaluateJavascript(
                        "if(window.__aab_dispatchMessage){window.__aab_dispatchMessage('" +
                                escaped + "','" + esc(senderJson) + "')}",
                        null);
            }
            // Also dispatch to content WebView (broadcastToSidePanel uses this)
            if (contentWebView != null) {
                String escaped = esc(messageJson);
                contentWebView.evaluateJavascript(
                        "if(window.__aab_dispatchMessage){window.__aab_dispatchMessage('" +
                                escaped + "','{\"id\":\"aiaffiliate-extension\"}')}",
                        null);
            }
            deliverCb(callbackId, null);
        });
    }

    @JavascriptInterface
    public void sendMessageResponse(String responseJson) {
        // Response handling — message cycle completed
    }

    // ─── chrome.tabs.sendMessage ───
    @JavascriptInterface
    public void tabsSendMessage(int tabId, String messageJson, int callbackId) {
        mainHandler.post(() -> {
            if (contentWebView != null) {
                String escaped = esc(messageJson);
                contentWebView.evaluateJavascript(
                        "if(window.__aab_dispatchMessage){window.__aab_dispatchMessage('" +
                                escaped + "','{\"id\":\"aiaffiliate-extension\"}')}",
                        null);
            }
            deliverCb(callbackId, null);
        });
    }

    // ─── chrome.tabs.query ───
    @JavascriptInterface
    public void tabsQuery(String queryJson, int callbackId) {
        mainHandler.post(() -> {
            try {
                String url = contentWebView != null && contentWebView.getUrl() != null ? contentWebView.getUrl() : "";
                String title = contentWebView != null && contentWebView.getTitle() != null ? contentWebView.getTitle()
                        : "";

                // Check URL filter
                JSONObject query = new JSONObject(queryJson);
                String urlFilter = query.optString("url", "");

                if (!urlFilter.isEmpty()) {
                    // Match URL pattern
                    String pattern = urlFilter.replace("*", ".*");
                    if (!url.matches(pattern)) {
                        // No match — return empty array
                        deliverCb(callbackId, "[]");
                        return;
                    }
                }

                String tabJson = "[{\"id\":1,\"active\":true,\"url\":\"" + esc(url) +
                        "\",\"title\":\"" + esc(title) + "\",\"windowId\":1}]";
                deliverCb(callbackId, tabJson);
            } catch (Exception e) {
                deliverCb(callbackId, "[]");
            }
        });
    }

    // ─── chrome.tabs.create ───
    @JavascriptInterface
    public void tabsCreate(String propsJson, int callbackId) {
        mainHandler.post(() -> {
            try {
                JSONObject props = new JSONObject(propsJson);
                String url = props.optString("url", "");
                boolean active = props.optBoolean("active", true);
                if (!url.isEmpty() && contentWebView != null) {
                    contentWebView.loadUrl(url);
                }
                String tabJson = "{\"id\":1,\"url\":\"" + esc(url) + "\",\"active\":" + active + ",\"windowId\":1}";
                deliverCb(callbackId, tabJson);

                // Notify tab updated listeners after load
                if (!url.isEmpty()) {
                    mainHandler.postDelayed(() -> {
                        notifyTabUpdated(1, "loading", url);
                    }, 500);
                }
            } catch (JSONException e) {
                deliverCb(callbackId, "{\"id\":1}");
            }
        });
    }

    // ─── chrome.tabs.update ───
    @JavascriptInterface
    public void tabsUpdate(int tabId, String propsJson, int callbackId) {
        mainHandler.post(() -> {
            try {
                JSONObject props = new JSONObject(propsJson);
                String url = props.optString("url", "");
                if (!url.isEmpty() && contentWebView != null) {
                    contentWebView.loadUrl(url);
                }
                String tabJson = "{\"id\":" + (tabId > 0 ? tabId : 1) + ",\"url\":\"" + esc(url)
                        + "\",\"active\":true}";
                deliverCb(callbackId, tabJson);
            } catch (JSONException e) {
                deliverCb(callbackId, "{\"id\":" + tabId + "}");
            }
        });
    }

    // ─── chrome.tabs.remove ───
    @JavascriptInterface
    public void tabsRemove(String tabIdsJson, int callbackId) {
        mainHandler.post(() -> {
            try {
                JSONArray ids = new JSONArray(tabIdsJson);
                for (int i = 0; i < ids.length(); i++) {
                    int tabId = ids.getInt(i);
                    // Since we only have one tab, just notify removal
                    notifyTabRemoved(tabId);
                }
            } catch (JSONException e) {
                /* ignore */ }
            deliverCb(callbackId, null);
        });
    }

    // ─── chrome.tabs.get (async) ───
    @JavascriptInterface
    public void tabsGetAsync(int tabId, int callbackId) {
        mainHandler.post(() -> {
            String url = contentWebView != null && contentWebView.getUrl() != null ? contentWebView.getUrl() : "";
            String title = contentWebView != null && contentWebView.getTitle() != null ? contentWebView.getTitle() : "";
            String tabJson = "{\"id\":" + tabId + ",\"url\":\"" + esc(url) +
                    "\",\"title\":\"" + esc(title) + "\",\"active\":true,\"status\":\"complete\",\"windowId\":1}";
            deliverCb(callbackId, tabJson);
        });
    }

    // ─── chrome.tabs.reload ───
    @JavascriptInterface
    public void tabsReload(int tabId) {
        mainHandler.post(() -> {
            if (contentWebView != null)
                contentWebView.reload();
        });
    }

    // ─── chrome.scripting.executeScript ───
    @JavascriptInterface
    public void executeScript(int tabId, String code, int callbackId) {
        mainHandler.post(() -> {
            if (contentWebView != null) {
                contentWebView.evaluateJavascript(code, result -> {
                    if (callbackId > 0) {
                        String r = result != null && !result.equals("null") ? result : "null";
                        deliverCbOnBg(callbackId, "[{\"result\":" + r + "}]");
                    }
                });
            }
        });
    }

    @JavascriptInterface
    public void executeScriptFiles(int tabId, String filesJson, int callbackId) {
        mainHandler.post(() -> {
            try {
                JSONArray files = new JSONArray(filesJson);
                for (int i = 0; i < files.length(); i++) {
                    String file = files.getString(i);
                    if (contentWebView != null) {
                        injectAssetScript(contentWebView, "extension/" + file);
                    }
                }
            } catch (JSONException e) {
                /* ignore */ }
            deliverCbOnBg(callbackId, "[]");
        });
    }

    // ─── chrome.storage.local ───
    @JavascriptInterface
    public void storageGet(String keysJson, int callbackId) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(STORAGE_PREFS, Context.MODE_PRIVATE);
            JSONArray keys = new JSONArray(keysJson);
            JSONObject result = new JSONObject();

            if (keys.length() == 0) {
                Map<String, ?> all = prefs.getAll();
                for (Map.Entry<String, ?> entry : all.entrySet()) {
                    putParsedValue(result, entry.getKey(), (String) entry.getValue());
                }
            } else {
                for (int i = 0; i < keys.length(); i++) {
                    String key = keys.getString(i);
                    String val = prefs.getString(key, null);
                    if (val != null) {
                        putParsedValue(result, key, val);
                    }
                }
            }
            deliverCbToAll(callbackId, result.toString());
        } catch (JSONException e) {
            deliverCbToAll(callbackId, "{}");
        }
    }

    @JavascriptInterface
    public void storageSet(String itemsJson, int callbackId) {
        try {
            JSONObject items = new JSONObject(itemsJson);
            SharedPreferences prefs = context.getSharedPreferences(STORAGE_PREFS, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();

            JSONObject changes = new JSONObject();
            Iterator<String> keys = items.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                Object value = items.get(key);
                String oldVal = prefs.getString(key, null);
                String newVal = value instanceof String ? (String) value : value.toString();
                // Store objects as JSON strings
                if (value instanceof JSONObject || value instanceof JSONArray) {
                    newVal = value.toString();
                }
                editor.putString(key, newVal);

                JSONObject change = new JSONObject();
                change.put("newValue", value);
                if (oldVal != null) {
                    try {
                        change.put("oldValue", new JSONObject(oldVal));
                    } catch (Exception e2) {
                        change.put("oldValue", oldVal);
                    }
                }
                changes.put(key, change);
            }
            editor.apply();
            notifyStorageChanged(changes.toString());
            deliverCbToAll(callbackId, null);
        } catch (JSONException e) {
            deliverCbToAll(callbackId, null);
        }
    }

    @JavascriptInterface
    public void storageRemove(String keysJson, int callbackId) {
        try {
            JSONArray keys = new JSONArray(keysJson);
            SharedPreferences prefs = context.getSharedPreferences(STORAGE_PREFS, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            JSONObject changes = new JSONObject();
            for (int i = 0; i < keys.length(); i++) {
                String key = keys.getString(i);
                String oldVal = prefs.getString(key, null);
                editor.remove(key);
                if (oldVal != null) {
                    JSONObject change = new JSONObject();
                    try {
                        change.put("oldValue", new JSONObject(oldVal));
                    } catch (Exception e2) {
                        change.put("oldValue", oldVal);
                    }
                    changes.put(key, change);
                }
            }
            editor.apply();
            if (changes.length() > 0) {
                notifyStorageChanged(changes.toString());
            }
        } catch (JSONException e) {
            /* ignore */ }
        deliverCbToAll(callbackId, null);
    }

    @JavascriptInterface
    public void storageClear(int callbackId) {
        context.getSharedPreferences(STORAGE_PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        deliverCbToAll(callbackId, null);
    }

    // ─── chrome.browsingData.remove ───
    @JavascriptInterface
    public void clearBrowsingData(String dataTypesJson) {
        mainHandler.post(() -> {
            if (contentWebView != null) {
                contentWebView.clearCache(true);
                contentWebView.clearHistory();
            }
            CookieManager.getInstance().removeAllCookies(null);
        });
    }

    // ─── chrome.alarms ───
    @JavascriptInterface
    public void alarmsCreate(String name, String infoJson) {
        try {
            JSONObject info = new JSONObject(infoJson);
            double periodMinutes = info.optDouble("periodInMinutes", 0);
            long delayMs = 0;

            if (info.has("delayInMinutes")) {
                delayMs = (long) (info.getDouble("delayInMinutes") * 60000);
            } else if (periodMinutes > 0) {
                delayMs = (long) (periodMinutes * 60000);
            }
            if (info.has("when")) {
                delayMs = Math.max(0, info.getLong("when") - System.currentTimeMillis());
            }

            final long fDelay = Math.max(delayMs, 1000);
            final String alarmName = name;
            final double period = periodMinutes;

            // Cancel existing
            alarmsClear(alarmName);

            Runnable alarmRunnable = new Runnable() {
                @Override
                public void run() {
                    String alarmJson = "{\"name\":\"" + esc(alarmName) +
                            "\",\"scheduledTime\":" + System.currentTimeMillis() + "}";
                    fireAlarm(alarmJson);

                    // Repeat if periodic
                    if (period > 0) {
                        long nextDelay = (long) (period * 60000);
                        alarmScheduledTimes.put(alarmName, System.currentTimeMillis() + nextDelay);
                        mainHandler.postDelayed(this, nextDelay);
                    } else {
                        activeAlarms.remove(alarmName);
                        alarmScheduledTimes.remove(alarmName);
                        alarmPeriods.remove(alarmName);
                    }
                }
            };

            activeAlarms.put(alarmName, alarmRunnable);
            alarmScheduledTimes.put(alarmName, System.currentTimeMillis() + fDelay);
            if (period > 0)
                alarmPeriods.put(alarmName, period);

            mainHandler.postDelayed(alarmRunnable, fDelay);
            Log.d(TAG, "Alarm created: " + alarmName + " delay=" + fDelay + "ms period=" + period + "min");
        } catch (JSONException e) {
            /* ignore */ }
    }

    @JavascriptInterface
    public void alarmsClear(String name) {
        Runnable existing = activeAlarms.remove(name);
        if (existing != null)
            mainHandler.removeCallbacks(existing);
        alarmScheduledTimes.remove(name);
        alarmPeriods.remove(name);
    }

    @JavascriptInterface
    public void alarmsClearAll() {
        for (Map.Entry<String, Runnable> entry : activeAlarms.entrySet()) {
            mainHandler.removeCallbacks(entry.getValue());
        }
        activeAlarms.clear();
        alarmScheduledTimes.clear();
        alarmPeriods.clear();
    }

    @JavascriptInterface
    public void alarmsGet(String name, int callbackId) {
        Long scheduledTime = alarmScheduledTimes.get(name);
        if (scheduledTime != null) {
            Double period = alarmPeriods.get(name);
            String alarmJson = "{\"name\":\"" + esc(name) +
                    "\",\"scheduledTime\":" + scheduledTime;
            if (period != null && period > 0) {
                alarmJson += ",\"periodInMinutes\":" + period;
            }
            alarmJson += "}";
            deliverCbToAll(callbackId, alarmJson);
        } else {
            deliverCbToAll(callbackId, "null");
        }
    }

    // ─── chrome.sidePanel.open ───
    @JavascriptInterface
    public void sidePanelOpen(String optionsJson) {
        mainHandler.post(() -> {
            if (sidePanelCallback != null) {
                sidePanelCallback.onOpenSidePanel();
            }
        });
    }

    // ─── chrome.action.setBadgeText ───
    @JavascriptInterface
    public void setBadgeText(String text) {
        // Could update UI badge
    }

    // ─── Fire onInstalled / onStartup in background ───
    public void fireOnInstalled() {
        mainHandler.postDelayed(() -> {
            if (backgroundWebView != null) {
                backgroundWebView.evaluateJavascript(
                        "if(window.__aab_onInstalled){window.__aab_onInstalled()}", null);
            }
        }, 1000);
    }

    public void fireOnStartup() {
        mainHandler.postDelayed(() -> {
            if (backgroundWebView != null) {
                backgroundWebView.evaluateJavascript(
                        "if(window.__aab_onStartup){window.__aab_onStartup()}", null);
            }
        }, 1500);
    }

    // ─── Fire action.onClicked (called when user taps extension button) ───
    public void fireActionClicked() {
        mainHandler.post(() -> {
            String tabJson = "{\"id\":1,\"windowId\":1,\"url\":\"" +
                    esc(contentWebView != null && contentWebView.getUrl() != null ? contentWebView.getUrl() : "")
                    + "\"}";
            if (backgroundWebView != null) {
                backgroundWebView.evaluateJavascript(
                        "if(window.chrome&&window.chrome.action&&window.chrome.action.onClicked.hasListeners()){" +
                                "var _listeners=[];window.chrome.action.onClicked.addListener=function(fn){_listeners.push(fn)};"
                                +
                                "}" +
                // Direct dispatch via shim internal
                                "try{var e=new CustomEvent('__aab_action_clicked');document.dispatchEvent(e)}catch(e){}",
                        null);
            }
        });
    }

    // ─── Helper: deliver callback to appropriate WebView(s) ───
    private void deliverCb(int cbId, String resultJson) {
        if (cbId <= 0)
            return;
        mainHandler.post(() -> {
            String js = buildCbJs(cbId, resultJson);
            if (contentWebView != null)
                contentWebView.evaluateJavascript(js, null);
            if (backgroundWebView != null)
                backgroundWebView.evaluateJavascript(js, null);
        });
    }

    private void deliverCbOnBg(int cbId, String resultJson) {
        if (cbId <= 0)
            return;
        mainHandler.post(() -> {
            String js = buildCbJs(cbId, resultJson);
            if (backgroundWebView != null)
                backgroundWebView.evaluateJavascript(js, null);
            else if (contentWebView != null)
                contentWebView.evaluateJavascript(js, null);
        });
    }

    private void deliverCbToAll(int cbId, String resultJson) {
        if (cbId <= 0)
            return;
        mainHandler.post(() -> {
            String js = buildCbJs(cbId, resultJson);
            if (contentWebView != null)
                contentWebView.evaluateJavascript(js, null);
            if (backgroundWebView != null)
                backgroundWebView.evaluateJavascript(js, null);
        });
    }

    private String buildCbJs(int cbId, String resultJson) {
        if (resultJson == null || resultJson.equals("null")) {
            return "if(window.__aab_callback){window.__aab_callback(" + cbId + ",null)}";
        }
        return "if(window.__aab_callback){window.__aab_callback(" + cbId + ",'" + esc(resultJson) + "')}";
    }

    // ─── Helper: notify storage change ───
    private void notifyStorageChanged(String changesJson) {
        mainHandler.post(() -> {
            String escaped = esc(changesJson);
            String js = "if(window.__aab_storageChanged){window.__aab_storageChanged('" + escaped + "','local')}";
            if (contentWebView != null)
                contentWebView.evaluateJavascript(js, null);
            if (backgroundWebView != null)
                backgroundWebView.evaluateJavascript(js, null);
        });
    }

    // ─── Helper: notify tab updated ───
    private void notifyTabUpdated(int tabId, String status, String url) {
        String changeInfoJson = "{\"status\":\"" + status + "\"}";
        String tabJson = "{\"id\":" + tabId + ",\"url\":\"" + esc(url) + "\",\"status\":\"" + status + "\"}";
        String js = "if(window.__aab_tabUpdated){window.__aab_tabUpdated(" + tabId +
                ",'" + esc(changeInfoJson) + "','" + esc(tabJson) + "')}";
        mainHandler.post(() -> {
            if (backgroundWebView != null)
                backgroundWebView.evaluateJavascript(js, null);
            if (contentWebView != null)
                contentWebView.evaluateJavascript(js, null);
        });
    }

    public void notifyTabComplete(String url) {
        notifyTabUpdated(1, "complete", url);
    }

    private void notifyTabRemoved(int tabId) {
        String js = "if(window.__aab_tabRemoved){window.__aab_tabRemoved(" + tabId + ")}";
        mainHandler.post(() -> {
            if (backgroundWebView != null)
                backgroundWebView.evaluateJavascript(js, null);
        });
    }

    // ─── Helper: fire alarm ───
    private void fireAlarm(String alarmJson) {
        String js = "if(window.__aab_alarmFired){window.__aab_alarmFired('" + esc(alarmJson) + "')}";
        mainHandler.post(() -> {
            if (backgroundWebView != null)
                backgroundWebView.evaluateJavascript(js, null);
            if (contentWebView != null)
                contentWebView.evaluateJavascript(js, null);
        });
    }

    // ─── Helper: inject script from assets ───
    @SuppressLint("SetJavaScriptEnabled")
    public void injectAssetScript(WebView webView, String assetPath) {
        try {
            java.io.InputStream is = context.getAssets().open(assetPath);
            byte[] buffer = new byte[is.available()];
            is.read(buffer);
            is.close();
            String code = new String(buffer, "UTF-8");
            webView.evaluateJavascript(code, null);
        } catch (Exception e) {
            Log.e(TAG, "Failed to inject " + assetPath + ": " + e.getMessage());
        }
    }

    // ─── Helper: parse stored value ───
    private void putParsedValue(JSONObject result, String key, String val) throws JSONException {
        if (val == null)
            return;
        if (val.startsWith("{") || val.startsWith("[")) {
            try {
                result.put(key, new JSONObject(val));
                return;
            } catch (Exception e) {
            }
            try {
                result.put(key, new JSONArray(val));
                return;
            } catch (Exception e) {
            }
        }
        if (val.equals("true")) {
            result.put(key, true);
            return;
        }
        if (val.equals("false")) {
            result.put(key, false);
            return;
        }
        try {
            result.put(key, Long.parseLong(val));
            return;
        } catch (Exception e) {
        }
        try {
            result.put(key, Double.parseDouble(val));
            return;
        } catch (Exception e) {
        }
        result.put(key, val);
    }

    // ─── Helper: escape for JS ───
    private static String esc(String s) {
        if (s == null)
            return "";
        return s.replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }
}
