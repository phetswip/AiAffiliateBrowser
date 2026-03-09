package com.aiaffiliate.browser;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Bitmap;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * AiAffiliate Browser — Tab Manager
 * Manages multiple WebView instances (tabs) for Chrome Extension compatibility.
 * Background tabs run JS fully but are not visible.
 */
public class TabManager {

    private static final String TAG = "TabManager";

    private static final String DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    // Block these URI schemes to prevent app redirects
    private static final String[] BLOCKED_SCHEMES = {
            "intent://", "market://", "snssdk://", "musically://",
            "tiktok://", "tbopen://", "shopeeid://", "lazada://"
    };

    // Content script rules from manifest.json
    private static final ContentScriptRule[] CONTENT_SCRIPT_RULES = {
            // ChatGPT / Sora
            new ContentScriptRule(
                    new String[] { "https://sora.chatgpt.com/*", "https://chatgpt.com/*" },
                    new String[] { "content-script.js" }),
            // TikTok all pages (broadest match AFTER more specific rules)
            new ContentScriptRule(
                    new String[] { "https://www.tiktok.com/*" },
                    new String[] { "tiktok-content-script.js", "overlay-notification.js" }),
            // AI Studio / Google Flow / Labs
            new ContentScriptRule(
                    new String[] {
                            "https://aistudio.google.com/*",
                            "https://labs.google.com/fx/*",
                            "https://labs.google/fx/*"
                    },
                    new String[] {
                            "aistudio-content-script.js",
                            "aistudio-video-extend-script.js",
                            "story-content-script.js",
                            "flow-content-script.js",
                            "overlay-notification.js"
                    }),
            // TikTok Studio / Seller
            new ContentScriptRule(
                    new String[] {
                            "https://seller-th.tiktok.com/*",
                            "https://seller.tiktok.com/*",
                            "https://www.tiktok.com/tiktokstudio/*",
                            "https://tiktok.com/tiktokstudio/*"
                    },
                    new String[] {
                            "aaa-ai-proxy.js",
                            "tiktok-seller-content-script.js",
                            "tiktok-comment-bot.js",
                            "overlay-notification.js"
                    }),
            // TikTok Product
            new ContentScriptRule(
                    new String[] { "https://www.tiktok.com/view/product/*" },
                    new String[] { "tiktok-product-content-script.js", "overlay-notification.js" }),
            // FastMoss
            new ContentScriptRule(
                    new String[] { "https://www.fastmoss.com/*" },
                    new String[] { "fastmoss-product-content-script.js", "overlay-notification.js" }),
            // Kalodata
            new ContentScriptRule(
                    new String[] { "https://www.kalodata.com/*" },
                    new String[] { "kalodata-product-content-script.js", "overlay-notification.js" }),
            // TikTok Shop
            new ContentScriptRule(
                    new String[] { "https://shop.tiktok.com/*" },
                    new String[] { "tiktok-live-content-script.js", "overlay-notification.js" })
    };

    private final Context context;
    private final ExtensionBridge bridge;
    private final FrameLayout container;

    // Tab storage: tabId → TabInfo
    private final Map<Integer, TabInfo> tabs = new LinkedHashMap<>();
    private int nextTabId = 1;
    private int activeTabId = -1;

    // Callback to update URL bar
    private TabEventListener eventListener;

    public interface TabEventListener {
        void onUrlChanged(int tabId, String url);

        void onTitleChanged(int tabId, String title);

        void onProgressChanged(int tabId, int progress);

        void onTabCreated(int tabId);

        void onTabRemoved(int tabId);
    }

    static class TabInfo {
        int id;
        WebView webView;
        String url = "";
        String title = "";
        boolean active;
        boolean isLoading = false;

        TabInfo(int id, WebView wv, boolean active) {
            this.id = id;
            this.webView = wv;
            this.active = active;
        }
    }

    public TabManager(Context context, ExtensionBridge bridge, FrameLayout container) {
        this.context = context;
        this.bridge = bridge;
        this.container = container;
    }

    public void setEventListener(TabEventListener listener) {
        this.eventListener = listener;
    }

    // ─── Create Tab ───
    @SuppressLint({ "SetJavaScriptEnabled", "JavascriptInterface" })
    public int createTab(String url, boolean active) {
        int tabId = nextTabId++;
        WebView wv = new WebView(context);

        // Configure WebView
        WebSettings settings = wv.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(DESKTOP_UA);

        // Cookies
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true);

        // Register bridge
        wv.addJavascriptInterface(bridge, "aabBridge");

        final int fTabId = tabId;

        // WebViewClient — handles redirects, content script injection
        wv.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String reqUrl = request.getUrl().toString();
                // Block app redirect schemes
                for (String scheme : BLOCKED_SCHEMES) {
                    if (reqUrl.startsWith(scheme)) {
                        Log.d(TAG, "Blocked redirect: " + reqUrl);
                        return true;
                    }
                }
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String pageUrl, Bitmap favicon) {
                super.onPageStarted(view, pageUrl, favicon);
                TabInfo tab = tabs.get(fTabId);
                if (tab != null) {
                    tab.url = pageUrl != null ? pageUrl : "";
                    tab.isLoading = true;
                }
                if (eventListener != null && isActiveTab(fTabId)) {
                    eventListener.onUrlChanged(fTabId, pageUrl);
                }
                // Notify background: tab loading
                bridge.notifyTabStatus(fTabId, "loading", pageUrl != null ? pageUrl : "");
            }

            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                super.onPageFinished(view, pageUrl);
                TabInfo tab = tabs.get(fTabId);
                if (tab != null) {
                    tab.url = pageUrl != null ? pageUrl : "";
                    tab.title = view.getTitle() != null ? view.getTitle() : "";
                    tab.isLoading = false;
                }
                if (eventListener != null && isActiveTab(fTabId)) {
                    eventListener.onUrlChanged(fTabId, pageUrl);
                }
                // Inject chrome shim + content scripts
                if (pageUrl != null && !pageUrl.startsWith("file://") && !pageUrl.startsWith("data:")
                        && !pageUrl.startsWith("about:")) {
                    injectShimAndScripts(view, pageUrl);
                }
                // Notify background: tab complete
                bridge.notifyTabStatus(fTabId, "complete", pageUrl != null ? pageUrl : "");
            }
        });

        // WebChromeClient
        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (eventListener != null && isActiveTab(fTabId)) {
                    eventListener.onProgressChanged(fTabId, newProgress);
                }
            }

            @Override
            public void onReceivedTitle(WebView view, String title) {
                TabInfo tab = tabs.get(fTabId);
                if (tab != null)
                    tab.title = title != null ? title : "";
                if (eventListener != null && isActiveTab(fTabId)) {
                    eventListener.onTitleChanged(fTabId, title);
                }
            }
        });

        // Store tab
        TabInfo tabInfo = new TabInfo(tabId, wv, active);
        tabs.put(tabId, tabInfo);

        if (active) {
            switchToTab(tabId);
        } else {
            // Background tab: add hidden to container with 0 size
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(0, 0);
            wv.setLayoutParams(params);
            wv.setVisibility(View.INVISIBLE);
            container.addView(wv);
        }

        // Load URL
        if (url != null && !url.isEmpty()) {
            wv.loadUrl(url);
            tabInfo.url = url;
        }

        if (eventListener != null)
            eventListener.onTabCreated(tabId);
        Log.i(TAG, "Tab " + tabId + " created (active=" + active + ") url=" + url);

        return tabId;
    }

    // ─── Remove Tab ───
    public void removeTab(int tabId) {
        TabInfo tab = tabs.remove(tabId);
        if (tab != null) {
            tab.webView.stopLoading();
            tab.webView.loadUrl("about:blank");
            container.removeView(tab.webView);
            tab.webView.destroy();

            if (eventListener != null)
                eventListener.onTabRemoved(tabId);
            Log.i(TAG, "Tab " + tabId + " removed");

            // If we removed the active tab, switch to another
            if (tabId == activeTabId && !tabs.isEmpty()) {
                int lastTabId = -1;
                for (int id : tabs.keySet())
                    lastTabId = id;
                if (lastTabId > 0)
                    switchToTab(lastTabId);
            }
        }
    }

    // ─── Update Tab ───
    public void updateTab(int tabId, String url) {
        TabInfo tab = tabs.get(tabId);
        if (tab != null && url != null && !url.isEmpty()) {
            tab.webView.loadUrl(url);
            tab.url = url;
            Log.d(TAG, "Tab " + tabId + " navigating to: " + url);
        }
    }

    // ─── Switch Active Tab ───
    public void switchToTab(int tabId) {
        TabInfo newTab = tabs.get(tabId);
        if (newTab == null)
            return;

        // Hide current active tab
        if (activeTabId > 0 && tabs.containsKey(activeTabId)) {
            TabInfo oldTab = tabs.get(activeTabId);
            if (oldTab != null) {
                oldTab.active = false;
                FrameLayout.LayoutParams hideParams = new FrameLayout.LayoutParams(0, 0);
                oldTab.webView.setLayoutParams(hideParams);
                oldTab.webView.setVisibility(View.INVISIBLE);
            }
        }

        // Show new active tab
        activeTabId = tabId;
        newTab.active = true;
        FrameLayout.LayoutParams showParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
        newTab.webView.setLayoutParams(showParams);
        newTab.webView.setVisibility(View.VISIBLE);
        container.bringChildToFront(newTab.webView);

        // Update bridge to point to this tab as "active"
        bridge.setContentWebView(newTab.webView);

        Log.d(TAG, "Switched to tab " + tabId);
    }

    // ─── Query Tabs ───
    public List<TabInfo> queryTabs(String urlPattern) {
        List<TabInfo> result = new ArrayList<>();
        for (TabInfo tab : tabs.values()) {
            if (urlPattern == null || urlPattern.isEmpty()) {
                result.add(tab);
            } else {
                try {
                    String regex = urlPattern
                            .replace(".", "\\.")
                            .replace("*", ".*");
                    if (tab.url.matches(regex)) {
                        result.add(tab);
                    }
                } catch (Exception e) {
                    // Fall back to prefix matching
                    String prefix = urlPattern.replace("*", "");
                    if (tab.url.startsWith(prefix)) {
                        result.add(tab);
                    }
                }
            }
        }
        return result;
    }

    // ─── Get Tab ───
    public TabInfo getTab(int tabId) {
        return tabs.get(tabId);
    }

    public int getActiveTabId() {
        return activeTabId;
    }

    public WebView getActiveWebView() {
        TabInfo tab = tabs.get(activeTabId);
        return tab != null ? tab.webView : null;
    }

    public boolean isActiveTab(int tabId) {
        return tabId == activeTabId;
    }

    public int getTabCount() {
        return tabs.size();
    }

    // ─── Send Message to Tab ───
    public void sendMessageToTab(int tabId, String messageJson) {
        TabInfo tab = tabs.get(tabId);
        if (tab != null) {
            String escaped = messageJson.replace("\\", "\\\\")
                    .replace("'", "\\'")
                    .replace("\"", "\\\"")
                    .replace("\n", "\\n")
                    .replace("\r", "\\r");
            tab.webView.evaluateJavascript(
                    "if(window.__aab_dispatchMessage){window.__aab_dispatchMessage('" +
                            escaped + "','{\"id\":\"aiaffiliate-extension\"}')}",
                    null);
        }
    }

    // ─── Execute Script on Tab ───
    public void executeScriptOnTab(int tabId, String code, android.webkit.ValueCallback<String> callback) {
        TabInfo tab = tabs.get(tabId);
        if (tab != null) {
            tab.webView.evaluateJavascript(code, callback);
        } else if (callback != null) {
            callback.onReceiveValue("null");
        }
    }

    // ─── Inject Script Files on Tab ───
    public void injectScriptFilesOnTab(int tabId, String[] files) {
        TabInfo tab = tabs.get(tabId);
        if (tab != null) {
            for (String file : files) {
                bridge.injectAssetScript(tab.webView, "extension/" + file);
            }
        }
    }

    // ─── Content Script Injection ───
    private void injectShimAndScripts(WebView view, String url) {
        // 1. Always inject chrome-api-shim.js
        bridge.injectAssetScript(view, "extension/chrome-api-shim.js");

        // 2. Inject matching content scripts
        for (ContentScriptRule rule : CONTENT_SCRIPT_RULES) {
            if (rule.matches(url)) {
                for (String script : rule.scripts) {
                    bridge.injectAssetScript(view, "extension/" + script);
                }
                Log.d(TAG, "Injected " + rule.scripts.length + " scripts for: " + url);
            }
        }
    }

    // ─── Reload Active Tab ───
    public void reloadActiveTab() {
        TabInfo tab = tabs.get(activeTabId);
        if (tab != null)
            tab.webView.reload();
    }

    // ─── Check if active tab can go back ───
    public boolean canGoBack() {
        TabInfo tab = tabs.get(activeTabId);
        return tab != null && tab.webView.canGoBack();
    }

    public void goBack() {
        TabInfo tab = tabs.get(activeTabId);
        if (tab != null)
            tab.webView.goBack();
    }

    // ─── Cleanup ───
    public void destroyAll() {
        for (TabInfo tab : tabs.values()) {
            tab.webView.stopLoading();
            tab.webView.loadUrl("about:blank");
            container.removeView(tab.webView);
            tab.webView.destroy();
        }
        tabs.clear();
        activeTabId = -1;
    }

    public void pauseAll() {
        for (TabInfo tab : tabs.values())
            tab.webView.onPause();
    }

    public void resumeAll() {
        for (TabInfo tab : tabs.values())
            tab.webView.onResume();
    }

    // ─── Content Script Rule ───
    private static class ContentScriptRule {
        final String[] patterns;
        final String[] scripts;

        ContentScriptRule(String[] matchPatterns, String[] scripts) {
            this.patterns = matchPatterns;
            this.scripts = scripts;
        }

        boolean matches(String url) {
            if (url == null)
                return false;
            for (String pattern : patterns) {
                String regex = pattern
                        .replace(".", "\\.")
                        .replace("*", ".*");
                try {
                    if (url.matches(regex))
                        return true;
                } catch (Exception e) {
                    String prefix = pattern.replace("*", "");
                    if (url.startsWith(prefix))
                        return true;
                }
            }
            return false;
        }
    }
}
