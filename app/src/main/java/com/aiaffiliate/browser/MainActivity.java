package com.aiaffiliate.browser;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.animation.Animation;
import android.view.animation.TranslateAnimation;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/**
 * AiAffiliate Browser — Main Activity v2
 * Full browser + Chrome Extension Bridge + Side Panel
 */
public class MainActivity extends AppCompatActivity implements ExtensionBridge.SidePanelCallback {

    private static final String TAG = "AiBrowser";

    private WebView webView;
    private EditText urlBar;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefresh;
    private ImageButton btnBack, btnMenu, btnExtension;

    // Side Panel
    private FrameLayout sidePanelOverlay;
    private FrameLayout sidePanelContainer;
    private View sidePanelBackdrop;
    private ImageButton btnClosePanel;
    private WebView sidePanelWebView;
    private boolean sidePanelOpen = false;

    // Extension Bridge
    private ExtensionBridge extensionBridge;
    private BackgroundEngine backgroundEngine;

    // URLs
    private static final String NTP_URL = "file:///android_asset/custom-pages/new-tab/new-tab.html";
    private static final String SETTINGS_URL = "file:///android_asset/custom-pages/settings/settings.html";
    private static final String EXT_MANAGER_URL = "file:///android_asset/custom-pages/extension-manager/extension-manager.html";
    private static final String POPUP_URL = "file:///android_asset/extension/popup.html";

    private static final String DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    private SharedPreferences prefs;
    private boolean desktopMode = true;

    // Content Script Rules
    private static final ContentScriptRule[] CONTENT_SCRIPT_RULES = {
            new ContentScriptRule(
                    new String[] { "https://www.tiktok.com/view/product/*" },
                    new String[] { "tiktok-product-content-script.js" }),
            new ContentScriptRule(
                    new String[] { "https://www.fastmoss.com/*" },
                    new String[] { "fastmoss-product-content-script.js" }),
            new ContentScriptRule(
                    new String[] { "https://www.kalodata.com/*" },
                    new String[] { "kalodata-product-content-script.js" }),
            new ContentScriptRule(
                    new String[] { "https://www.tiktok.com/tiktokstudio/*" },
                    new String[] {
                            "overlay-notification.js",
                            "tiktok-seller-content-script.js",
                            "tiktok-comment-bot.js"
                    }),
            new ContentScriptRule(
                    new String[] { "https://www.tiktok.com/*" },
                    new String[] { "tiktok-injected.js", "tiktok-poster-content.js" })
    };

    @Override
    @SuppressLint({ "SetJavaScriptEnabled", "JavascriptInterface" })
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences("aiaffiliate_prefs", MODE_PRIVATE);
        desktopMode = prefs.getBoolean("desktop_mode", true);

        // Init Extension Bridge
        extensionBridge = new ExtensionBridge(this);
        extensionBridge.setSidePanelCallback(this);

        initViews();
        setupWebView();
        setupSidePanel();
        setupUrlBar();
        setupMenu();

        // Init Background Engine
        backgroundEngine = new BackgroundEngine(this, extensionBridge);
        backgroundEngine.initialize();

        Log.i(TAG, "Browser + Extension Bridge initialized ✅");

        // Handle intent
        Intent intent = getIntent();
        String intentUrl = intent.getDataString();
        loadUrl(intentUrl != null && !intentUrl.isEmpty() ? intentUrl : NTP_URL);
    }

    private void initViews() {
        webView = findViewById(R.id.webView);
        urlBar = findViewById(R.id.urlBar);
        progressBar = findViewById(R.id.progressBar);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        btnBack = findViewById(R.id.btnBack);
        btnMenu = findViewById(R.id.btnMenu);
        btnExtension = findViewById(R.id.btnExtension);

        swipeRefresh.setColorSchemeColors(0xFF4F7FFF, 0xFF7C3AED);
        swipeRefresh.setProgressBackgroundColorSchemeColor(0xFF1A1B2E);
        swipeRefresh.setOnRefreshListener(() -> webView.reload());

        btnBack.setOnClickListener(v -> {
            if (webView.canGoBack())
                webView.goBack();
        });

        // Extension button → open side panel with popup.html
        btnExtension.setOnClickListener(v -> {
            if (sidePanelOpen) {
                closeSidePanel();
            } else {
                openSidePanel();
            }
        });
    }

    @SuppressLint({ "SetJavaScriptEnabled", "JavascriptInterface" })
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
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

        if (desktopMode)
            settings.setUserAgentString(DESKTOP_UA);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        // Register bridges
        webView.addJavascriptInterface(new NativeBridge(this), "aabNative");
        webView.addJavascriptInterface(extensionBridge, "aabBridge");
        extensionBridge.setContentWebView(webView);

        // WebViewClient with content script injection
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("intent://") || url.startsWith("market://")) {
                    try {
                        Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                        startActivity(intent);
                    } catch (Exception e) {
                        /* ignore */ }
                    return true;
                }
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                progressBar.setVisibility(View.VISIBLE);
                updateUrlBar(url);

                // Notify background of tab loading
                if (url != null && !url.startsWith("file://") && !url.startsWith("data:")) {
                    extensionBridge.notifyTabComplete(url); // status: loading
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
                updateUrlBar(url);

                // Inject extension on real web pages
                if (url != null && !url.startsWith("file://") && !url.startsWith("data:")) {
                    injectChromeShim(view);
                    injectMatchingContentScripts(view, url);

                    // Notify background: tab complete
                    extensionBridge.notifyTabComplete(url);
                }
            }
        });

        // WebChromeClient
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                if (newProgress >= 100)
                    progressBar.setVisibility(View.GONE);
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, 1001);
                } catch (Exception e) {
                    filePathCallback.onReceiveValue(null);
                }
                return true;
            }
        });

        // Download handler
        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                String filename = URLUtil.guessFileName(url, contentDisposition, mimetype);
                request.setTitle(filename);
                request.setDescription("Downloading...");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                request.addRequestHeader("User-Agent", userAgent);
                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                dm.enqueue(request);
                Toast.makeText(MainActivity.this, "⬇️ กำลังดาวน์โหลด: " + filename, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "❌ ดาวน์โหลดไม่สำเร็จ", Toast.LENGTH_SHORT).show();
            }
        });
    }

    // ─── Side Panel Setup ───
    @SuppressLint({ "SetJavaScriptEnabled", "JavascriptInterface" })
    private void setupSidePanel() {
        sidePanelOverlay = findViewById(R.id.sidePanelOverlay);
        sidePanelContainer = findViewById(R.id.sidePanelContainer);
        sidePanelBackdrop = findViewById(R.id.sidePanelBackdrop);
        btnClosePanel = findViewById(R.id.btnClosePanel);
        sidePanelWebView = findViewById(R.id.sidePanelWebView);

        // Configure side panel WebView
        WebSettings spSettings = sidePanelWebView.getSettings();
        spSettings.setJavaScriptEnabled(true);
        spSettings.setDomStorageEnabled(true);
        spSettings.setAllowFileAccess(true);
        spSettings.setAllowFileAccessFromFileURLs(true);
        spSettings.setAllowUniversalAccessFromFileURLs(true);
        spSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Register bridge on side panel too
        sidePanelWebView.addJavascriptInterface(extensionBridge, "aabBridge");

        sidePanelWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Inject shim so popup.html can use chrome.* APIs
                extensionBridge.injectAssetScript(view, "extension/chrome-api-shim.js");
            }
        });

        sidePanelWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, 1002);
                } catch (Exception e) {
                    filePathCallback.onReceiveValue(null);
                }
                return true;
            }
        });

        // Close actions
        btnClosePanel.setOnClickListener(v -> closeSidePanel());
        sidePanelBackdrop.setOnClickListener(v -> closeSidePanel());
    }

    // ─── Side Panel open/close ───
    @Override
    public void onOpenSidePanel() {
        // Called from ExtensionBridge when chrome.sidePanel.open() is invoked
        runOnUiThread(this::openSidePanel);
    }

    private void openSidePanel() {
        if (sidePanelOpen)
            return;
        sidePanelOpen = true;

        // Load popup.html
        sidePanelWebView.loadUrl(POPUP_URL);

        // Show overlay
        sidePanelOverlay.setVisibility(View.VISIBLE);

        // Slide in from right
        Animation slideIn = new TranslateAnimation(
                Animation.RELATIVE_TO_SELF, 1.0f,
                Animation.RELATIVE_TO_SELF, 0.0f,
                Animation.RELATIVE_TO_SELF, 0.0f,
                Animation.RELATIVE_TO_SELF, 0.0f);
        slideIn.setDuration(250);
        slideIn.setFillAfter(true);
        sidePanelContainer.startAnimation(slideIn);

        // Fade in backdrop
        sidePanelBackdrop.setAlpha(0f);
        sidePanelBackdrop.animate().alpha(1f).setDuration(250).start();

        // Highlight extension button
        btnExtension.setColorFilter(0xFF7C3AED);

        Log.d(TAG, "Side panel opened ✅");
    }

    private void closeSidePanel() {
        if (!sidePanelOpen)
            return;
        sidePanelOpen = false;

        // Slide out to right
        Animation slideOut = new TranslateAnimation(
                Animation.RELATIVE_TO_SELF, 0.0f,
                Animation.RELATIVE_TO_SELF, 1.0f,
                Animation.RELATIVE_TO_SELF, 0.0f,
                Animation.RELATIVE_TO_SELF, 0.0f);
        slideOut.setDuration(200);
        slideOut.setFillAfter(true);
        slideOut.setAnimationListener(new Animation.AnimationListener() {
            @Override
            public void onAnimationStart(Animation a) {
            }

            @Override
            public void onAnimationRepeat(Animation a) {
            }

            @Override
            public void onAnimationEnd(Animation a) {
                sidePanelOverlay.setVisibility(View.GONE);
            }
        });
        sidePanelContainer.startAnimation(slideOut);

        // Fade out backdrop
        sidePanelBackdrop.animate().alpha(0f).setDuration(200).start();

        // Reset extension button color
        btnExtension.setColorFilter(0xFF4F7FFF);

        Log.d(TAG, "Side panel closed");
    }

    // ─── Content Script Injection ───
    private void injectChromeShim(WebView view) {
        extensionBridge.injectAssetScript(view, "extension/chrome-api-shim.js");
    }

    private void injectMatchingContentScripts(WebView view, String url) {
        for (ContentScriptRule rule : CONTENT_SCRIPT_RULES) {
            if (rule.matches(url)) {
                Log.i(TAG, "Content scripts matched: " + url);
                for (String script : rule.scripts) {
                    extensionBridge.injectAssetScript(view, "extension/" + script);
                    Log.d(TAG, "  Injected: " + script);
                }
            }
        }
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

    // ─── URL Bar ───
    private void setupUrlBar() {
        urlBar.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO ||
                    (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                String input = urlBar.getText().toString().trim();
                if (!input.isEmpty())
                    navigateTo(input);
                hideKeyboard();
                return true;
            }
            return false;
        });
    }

    // ─── Menu ───
    private void setupMenu() {
        btnMenu.setOnClickListener(v -> {
            PopupMenu popup = new PopupMenu(this, v);
            popup.getMenu().add(0, 1, 0, "🏠 " + getString(R.string.new_tab));
            popup.getMenu().add(0, 2, 1, "🔄 รีเฟรช");
            popup.getMenu().add(0, 3, 2, (desktopMode ? "✅" : "☐") + " " + getString(R.string.desktop_mode));
            popup.getMenu().add(0, 4, 3, "🧩 " + getString(R.string.extensions));
            popup.getMenu().add(0, 5, 4, "⚙️ " + getString(R.string.settings));
            popup.getMenu().add(0, 6, 5, "📤 แชร์");
            popup.getMenu().add(0, 7, 6, "🗑️ " + getString(R.string.clear_data));

            popup.setOnMenuItemClickListener(item -> {
                switch (item.getItemId()) {
                    case 1:
                        loadUrl(NTP_URL);
                        return true;
                    case 2:
                        webView.reload();
                        return true;
                    case 3:
                        toggleDesktopMode();
                        return true;
                    case 4:
                        loadUrl(EXT_MANAGER_URL);
                        return true;
                    case 5:
                        loadUrl(SETTINGS_URL);
                        return true;
                    case 6:
                        shareCurrentUrl();
                        return true;
                    case 7:
                        clearBrowsingData();
                        return true;
                }
                return false;
            });
            popup.show();
        });
    }

    // ─── Navigation ───
    private void navigateTo(String input) {
        String url;
        if (input.startsWith("http://") || input.startsWith("https://") || input.startsWith("file://")) {
            url = input;
        } else if (input.contains(".") && !input.contains(" ")) {
            url = "https://" + input;
        } else {
            url = "https://www.google.com/search?q=" + Uri.encode(input);
        }
        loadUrl(url);
    }

    private void loadUrl(String url) {
        webView.loadUrl(url);
        updateUrlBar(url);
    }

    private void updateUrlBar(String url) {
        if (url != null && !url.startsWith("file://")) {
            urlBar.setText(url);
        } else if (url != null && url.contains("new-tab")) {
            urlBar.setText("");
            urlBar.setHint("ค้นหา หรือพิมพ์ URL");
        }
    }

    private void toggleDesktopMode() {
        desktopMode = !desktopMode;
        prefs.edit().putBoolean("desktop_mode", desktopMode).apply();
        WebSettings settings = webView.getSettings();
        if (desktopMode) {
            settings.setUserAgentString(DESKTOP_UA);
            Toast.makeText(this, "🖥️ Desktop Mode เปิด", Toast.LENGTH_SHORT).show();
        } else {
            settings.setUserAgentString(null);
            Toast.makeText(this, "📱 Mobile Mode", Toast.LENGTH_SHORT).show();
        }
        webView.reload();
    }

    private void shareCurrentUrl() {
        String url = webView.getUrl();
        if (url != null && !url.startsWith("file://")) {
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("text/plain");
            share.putExtra(Intent.EXTRA_TEXT, url);
            startActivity(Intent.createChooser(share, "แชร์ลิงก์"));
        }
    }

    private void clearBrowsingData() {
        webView.clearCache(true);
        webView.clearHistory();
        webView.clearFormData();
        CookieManager.getInstance().removeAllCookies(null);
        Toast.makeText(this, "🗑️ ล้างข้อมูลเรียบร้อย", Toast.LENGTH_SHORT).show();
    }

    private void hideKeyboard() {
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null && urlBar != null) {
            imm.hideSoftInputFromWindow(urlBar.getWindowToken(), 0);
        }
        urlBar.clearFocus();
    }

    @Override
    public void onBackPressed() {
        if (sidePanelOpen) {
            closeSidePanel();
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String url = intent.getDataString();
        if (url != null && !url.isEmpty())
            loadUrl(url);
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (backgroundEngine != null)
            backgroundEngine.destroy();
        if (sidePanelWebView != null)
            sidePanelWebView.destroy();
        webView.destroy();
        super.onDestroy();
    }
}
