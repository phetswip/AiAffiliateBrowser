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
 * AiAffiliate Browser — Background Engine
 * 
 * Runs the extension's background.js (service worker logic) in a hidden
 * WebView.
 * This WebView is never shown to the user — it only executes JavaScript.
 * 
 * Flow:
 * 1. Creates hidden WebView with JS enabled
 * 2. Injects chrome-api-shim.js
 * 3. Injects background.js
 * 4. Messages are routed between content WebView ←→ background WebView
 * via ExtensionBridge
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

    /**
     * Initialize the background engine.
     * Must be called on the UI thread.
     */
    @SuppressLint({ "SetJavaScriptEnabled", "JavascriptInterface" })
    public void initialize() {
        bgWebView = new WebView(context);

        // Configure WebView for background execution
        WebSettings settings = bgWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        // Register the bridge
        bgWebView.addJavascriptInterface(bridge, "aabBridge");
        bridge.setBackgroundWebView(bgWebView);

        // Console logging for debugging
        bgWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                Log.d(TAG, "[BG] " + cm.message() + " (" + cm.sourceId() + ":" + cm.lineNumber() + ")");
                return true;
            }
        });

        // Load a blank page, then inject scripts
        bgWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (!isReady) {
                    isReady = true;
                    loadBackgroundScripts();
                }
            }
        });

        // Load empty HTML as base for the background context
        bgWebView.loadData(
                "<!DOCTYPE html><html><head><title>BG Engine</title></head><body></body></html>",
                "text/html", "UTF-8");

        Log.i(TAG, "Background engine initialized");
    }

    /**
     * Inject the Chrome API shim and then background.js
     */
    private void loadBackgroundScripts() {
        // 1. Inject Chrome API shim first
        bridge.injectAssetScript(bgWebView, "extension/chrome-api-shim.js");

        // 2. Inject background.js
        bridge.injectAssetScript(bgWebView, "extension/background.js");

        Log.i(TAG, "Background scripts loaded ✅");
    }

    /**
     * Get the background WebView (for routing messages)
     */
    public WebView getWebView() {
        return bgWebView;
    }

    /**
     * Check if the background engine is ready
     */
    public boolean isReady() {
        return isReady;
    }

    /**
     * Destroy the background engine
     */
    public void destroy() {
        if (bgWebView != null) {
            bgWebView.destroy();
            bgWebView = null;
        }
        isReady = false;
    }
}
