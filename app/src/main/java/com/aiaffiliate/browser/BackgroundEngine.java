package com.aiaffiliate.browser;

import android.annotation.SuppressLint;
import android.content.Context;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * AiAffiliate Browser — Background Engine v2
 * Runs background.js in a hidden WebView.
 * Fires onInstalled/onStartup after scripts load.
 */
public class BackgroundEngine {

    private static final String TAG = "BgEngine";
    private WebView bgWebView;
    private final Context context;
    private final ExtensionBridge bridge;
    private boolean isReady = false;

    public BackgroundEngine(Context context, ExtensionBridge bridge) {
        this.context = context;
        this.bridge = bridge;
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    public void initialize() {
        bgWebView = new WebView(context);

        WebSettings settings = bgWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        // Allow network for license checks, API calls
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        bgWebView.addJavascriptInterface(bridge, "aabBridge");
        bridge.setBackgroundWebView(bgWebView);

        bgWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                String level = cm.messageLevel() == ConsoleMessage.MessageLevel.ERROR ? "E" :
                               cm.messageLevel() == ConsoleMessage.MessageLevel.WARNING ? "W" : "D";
                Log.println(level.equals("E") ? Log.ERROR : level.equals("W") ? Log.WARN : Log.DEBUG,
                    TAG, "[BG] " + cm.message());
                return true;
            }
        });

        bgWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (!isReady) {
                    isReady = true;
                    loadBackgroundScripts();
                }
            }
        });

        bgWebView.loadData(
            "<!DOCTYPE html><html><head><title>BG</title></head><body></body></html>",
            "text/html", "UTF-8");

        Log.i(TAG, "Background engine initializing...");
    }

    private void loadBackgroundScripts() {
        // 1. Chrome API shim
        bridge.injectAssetScript(bgWebView, "extension/chrome-api-shim.js");

        // 2. Background script
        bridge.injectAssetScript(bgWebView, "extension/background.js");

        // 3. Fire lifecycle events
        bridge.fireOnInstalled();
        bridge.fireOnStartup();

        Log.i(TAG, "Background scripts loaded + lifecycle events fired ✅");
    }

    public WebView getWebView() { return bgWebView; }
    public boolean isReady() { return isReady; }

    public void destroy() {
        if (bgWebView != null) {
            bgWebView.destroy();
            bgWebView = null;
        }
        isReady = false;
    }
}
