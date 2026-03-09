package com.aiaffiliate.browser;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
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
 * AiAffiliate Browser — Extension Bridge
 * Java-side bridge for Chrome Extension API shim.
 * Registered as `window.aabBridge` in WebView.
 */
public class ExtensionBridge {

    private static final String TAG = "ExtBridge";
    private static final String STORAGE_PREFS = "ext_storage";

    private final Context context;
    private final Handler mainHandler;
    private WebView contentWebView; // The visible browser WebView
    private WebView backgroundWebView; // Hidden WebView for background.js

    // Alarm timers
    private final Map<String, Runnable> activeAlarms = new HashMap<>();

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

    // ─── chrome.runtime.sendMessage ───
    // Content script → Background
    @JavascriptInterface
    public void runtimeSendMessage(String messageJson, int callbackId) {
        mainHandler.post(() -> {
            if (backgroundWebView != null) {
                // Forward message to background WebView
                String escaped = escapeForJs(messageJson);
                String senderJson = "{\"id\":\"aiaffiliate-extension\",\"tab\":{\"id\":1}}";
                backgroundWebView.evaluateJavascript(
                        "if(window.__aab_dispatchMessage){window.__aab_dispatchMessage('"
                                + escaped + "','" + escapeForJs(senderJson) + "')}",
                        null);
            }
            // Return empty response via callback
            if (callbackId > 0 && contentWebView != null) {
                contentWebView.evaluateJavascript(
                        "if(window.__aab_callback){window.__aab_callback(" + callbackId + ",null)}", null);
            }
        });
    }

    // Background → Content response
    @JavascriptInterface
    public void sendMessageResponse(String responseJson) {
        // Response from background to content - dispatched by the shim
    }

    // ─── Background → Content script message forwarding ───
    @JavascriptInterface
    public void tabsSendMessage(int tabId, String messageJson, int callbackId) {
        mainHandler.post(() -> {
            if (contentWebView != null) {
                String escaped = escapeForJs(messageJson);
                String senderJson = "{\"id\":\"aiaffiliate-extension\"}";
                contentWebView.evaluateJavascript(
                        "if(window.__aab_dispatchMessage){window.__aab_dispatchMessage('"
                                + escaped + "','" + escapeForJs(senderJson) + "')}",
                        null);
            }
            if (callbackId > 0 && backgroundWebView != null) {
                backgroundWebView.evaluateJavascript(
                        "if(window.__aab_callback){window.__aab_callback(" + callbackId + ",null)}", null);
            }
        });
    }

    // ─── chrome.tabs.query ───
    @JavascriptInterface
    public void tabsQuery(String queryJson, int callbackId) {
        mainHandler.post(() -> {
            String url = contentWebView != null ? contentWebView.getUrl() : "";
            String title = contentWebView != null ? contentWebView.getTitle() : "";
            String tabJson = "[{\"id\":1,\"active\":true,\"url\":\""
                    + escapeForJs(url != null ? url : "")
                    + "\",\"title\":\"" + escapeForJs(title != null ? title : "") + "\"}]";

            WebView target = (backgroundWebView != null) ? backgroundWebView : contentWebView;
            if (target != null) {
                target.evaluateJavascript(
                        "if(window.__aab_callback){window.__aab_callback(" + callbackId + ",'"
                                + escapeForJs(tabJson) + "')}",
                        null);
            }
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

    // ─── chrome.tabs.create ───
    @JavascriptInterface
    public void tabsCreate(String propsJson) {
        mainHandler.post(() -> {
            try {
                JSONObject props = new JSONObject(propsJson);
                String url = props.optString("url", "");
                if (!url.isEmpty() && contentWebView != null) {
                    contentWebView.loadUrl(url);
                }
            } catch (JSONException e) {
                /* ignore */ }
        });
    }

    // ─── chrome.tabs.get ───
    @JavascriptInterface
    public String tabsGet(int tabId) {
        String url = contentWebView != null && contentWebView.getUrl() != null ? contentWebView.getUrl() : "";
        return "{\"id\":" + tabId + ",\"url\":\"" + escapeForJs(url) + "\",\"active\":true}";
    }

    // ─── chrome.scripting.executeScript ───
    @JavascriptInterface
    public void executeScript(int tabId, String code, int callbackId) {
        mainHandler.post(() -> {
            if (contentWebView != null) {
                contentWebView.evaluateJavascript(code, result -> {
                    if (callbackId > 0) {
                        WebView target = (backgroundWebView != null) ? backgroundWebView : contentWebView;
                        target.evaluateJavascript(
                                "if(window.__aab_callback){window.__aab_callback(" + callbackId
                                        + ",'[{\"result\":' + JSON.stringify(" + (result != null ? result : "null")
                                        + ") + '}]')}",
                                null);
                    }
                });
            }
        });
    }

    // ─── chrome.scripting.executeScript (files) ───
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

            if (callbackId > 0) {
                WebView target = (backgroundWebView != null) ? backgroundWebView : contentWebView;
                if (target != null) {
                    target.evaluateJavascript(
                            "if(window.__aab_callback){window.__aab_callback(" + callbackId + ",'[]')}", null);
                }
            }
        });
    }

    // ─── chrome.storage.local.get ───
    @JavascriptInterface
    public void storageGet(String keysJson, int callbackId) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(STORAGE_PREFS, Context.MODE_PRIVATE);
            JSONArray keys = new JSONArray(keysJson);
            JSONObject result = new JSONObject();

            if (keys.length() == 0) {
                // Return all
                Map<String, ?> all = prefs.getAll();
                for (Map.Entry<String, ?> entry : all.entrySet()) {
                    try {
                        result.put(entry.getKey(), new JSONObject((String) entry.getValue()));
                    } catch (Exception e) {
                        result.put(entry.getKey(), entry.getValue());
                    }
                }
            } else {
                for (int i = 0; i < keys.length(); i++) {
                    String key = keys.getString(i);
                    String val = prefs.getString(key, null);
                    if (val != null) {
                        try {
                            // Try to parse as JSON
                            if (val.startsWith("{") || val.startsWith("[")) {
                                result.put(key, new JSONObject(val));
                            } else if (val.equals("true") || val.equals("false")) {
                                result.put(key, Boolean.parseBoolean(val));
                            } else {
                                try {
                                    result.put(key, Long.parseLong(val));
                                } catch (Exception e2) {
                                    result.put(key, val);
                                }
                            }
                        } catch (Exception e) {
                            result.put(key, val);
                        }
                    }
                }
            }

            deliverCallback(callbackId, result.toString());
        } catch (JSONException e) {
            deliverCallback(callbackId, "{}");
        }
    }

    // ─── chrome.storage.local.set ───
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
                String newVal = value.toString();
                editor.putString(key, newVal);

                // Build changes for onChanged
                JSONObject change = new JSONObject();
                change.put("newValue", value);
                if (oldVal != null)
                    change.put("oldValue", oldVal);
                changes.put(key, change);
            }
            editor.apply();

            // Fire storage.onChanged in both webviews
            notifyStorageChanged(changes.toString());
            deliverCallback(callbackId, null);
        } catch (JSONException e) {
            deliverCallback(callbackId, null);
        }
    }

    // ─── chrome.storage.local.remove ───
    @JavascriptInterface
    public void storageRemove(String keysJson, int callbackId) {
        try {
            JSONArray keys = new JSONArray(keysJson);
            SharedPreferences prefs = context.getSharedPreferences(STORAGE_PREFS, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            for (int i = 0; i < keys.length(); i++) {
                editor.remove(keys.getString(i));
            }
            editor.apply();
        } catch (JSONException e) {
            /* ignore */ }
        deliverCallback(callbackId, null);
    }

    // ─── chrome.storage.local.clear ───
    @JavascriptInterface
    public void storageClear(int callbackId) {
        context.getSharedPreferences(STORAGE_PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        deliverCallback(callbackId, null);
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

    // ─── chrome.alarms.create ───
    @JavascriptInterface
    public void alarmsCreate(String name, String infoJson) {
        try {
            JSONObject info = new JSONObject(infoJson);
            long delayMs = 0;
            if (info.has("delayInMinutes")) {
                delayMs = (long) (info.getDouble("delayInMinutes") * 60000);
            }
            if (info.has("periodInMinutes")) {
                delayMs = (long) (info.getDouble("periodInMinutes") * 60000);
            }
            if (info.has("when")) {
                delayMs = Math.max(0, info.getLong("when") - System.currentTimeMillis());
            }

            final long fDelay = Math.max(delayMs, 1000); // minimum 1 second
            final String alarmName = name;

            // Cancel existing alarm with same name
            alarmsClear(alarmName);

            Runnable alarmRunnable = () -> {
                String alarmJson = "{\"name\":\"" + escapeForJs(alarmName) + "\"}";
                // Fire in background WebView
                if (backgroundWebView != null) {
                    backgroundWebView.evaluateJavascript(
                            "if(window.__aab_alarmFired){window.__aab_alarmFired('" + escapeForJs(alarmJson) + "')}",
                            null);
                }
                // Fire in content WebView
                if (contentWebView != null) {
                    contentWebView.evaluateJavascript(
                            "if(window.__aab_alarmFired){window.__aab_alarmFired('" + escapeForJs(alarmJson) + "')}",
                            null);
                }
            };

            activeAlarms.put(alarmName, alarmRunnable);
            mainHandler.postDelayed(alarmRunnable, fDelay);
        } catch (JSONException e) {
            /* ignore */ }
    }

    // ─── chrome.alarms.clear ───
    @JavascriptInterface
    public void alarmsClear(String name) {
        Runnable existing = activeAlarms.remove(name);
        if (existing != null) {
            mainHandler.removeCallbacks(existing);
        }
    }

    // ─── chrome.action.setBadgeText ───
    @JavascriptInterface
    public void setBadgeText(String text) {
        // Could show notification badge or update UI
    }

    // ─── Helper: deliver callback to appropriate WebView ───
    private void deliverCallback(int callbackId, String resultJson) {
        if (callbackId <= 0)
            return;
        mainHandler.post(() -> {
            String safe = resultJson != null ? escapeForJs(resultJson) : "null";
            String js = "if(window.__aab_callback){window.__aab_callback(" + callbackId
                    + "," + (resultJson != null ? "'" + safe + "'" : "null") + ")}";

            // Try content WebView first, then background
            if (contentWebView != null) {
                contentWebView.evaluateJavascript(js, null);
            }
            if (backgroundWebView != null) {
                backgroundWebView.evaluateJavascript(js, null);
            }
        });
    }

    // ─── Helper: notify storage change across WebViews ───
    private void notifyStorageChanged(String changesJson) {
        mainHandler.post(() -> {
            String escaped = escapeForJs(changesJson);
            String js = "if(window.__aab_storageChanged){window.__aab_storageChanged('" + escaped + "','local')}";
            if (contentWebView != null)
                contentWebView.evaluateJavascript(js, null);
            if (backgroundWebView != null)
                backgroundWebView.evaluateJavascript(js, null);
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
            android.util.Log.e(TAG, "Failed to inject " + assetPath + ": " + e.getMessage());
        }
    }

    // ─── Helper: escape string for JS injection ───
    private static String escapeForJs(String s) {
        if (s == null)
            return "";
        return s.replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }
}
