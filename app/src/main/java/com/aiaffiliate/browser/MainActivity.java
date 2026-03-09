package com.aiaffiliate.browser;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
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
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
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
 * AiAffiliate Browser — Main Activity v3
 * Multi-tab browser + Chrome Extension Bridge + Side Panel + ForegroundService
 */
public class MainActivity extends AppCompatActivity
        implements ExtensionBridge.SidePanelCallback, TabManager.TabEventListener {

    private static final String TAG = "AiBrowser";

    private EditText urlBar;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefresh;
    private FrameLayout webViewContainer;
    private ImageButton btnBack, btnMenu, btnExtension;

    // Side Panel
    private FrameLayout sidePanelOverlay;
    private FrameLayout sidePanelContainer;
    private View sidePanelBackdrop;
    private ImageButton btnClosePanel;
    private WebView sidePanelWebView;
    private boolean sidePanelOpen = false;

    // Core components
    private ExtensionBridge extensionBridge;
    private BackgroundEngine backgroundEngine;
    private TabManager tabManager;

    // URLs
    private static final String NTP_URL = "file:///android_asset/custom-pages/new-tab/new-tab.html";
    private static final String SETTINGS_URL = "file:///android_asset/custom-pages/settings/settings.html";
    private static final String EXT_MANAGER_URL = "file:///android_asset/custom-pages/extension-manager/extension-manager.html";
    private static final String POPUP_URL = "file:///android_asset/extension/popup.html";

    private SharedPreferences prefs;

    @Override
    @SuppressLint({ "SetJavaScriptEnabled", "JavascriptInterface" })
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences("aiaffiliate_prefs", MODE_PRIVATE);

        // Init Extension Bridge
        extensionBridge = new ExtensionBridge(this);
        extensionBridge.setSidePanelCallback(this);

        initViews();

        // Init TabManager
        tabManager = new TabManager(this, extensionBridge, webViewContainer);
        tabManager.setEventListener(this);
        extensionBridge.setTabManager(tabManager);

        setupSidePanel();
        setupUrlBar();
        setupMenu();

        // Init Background Engine
        backgroundEngine = new BackgroundEngine(this, extensionBridge);
        backgroundEngine.initialize();

        // Create first tab
        Intent intent = getIntent();
        String intentUrl = intent.getDataString();
        String startUrl = (intentUrl != null && !intentUrl.isEmpty()) ? intentUrl : NTP_URL;
        tabManager.createTab(startUrl, true);

        // Start foreground service for background persistence
        startExtensionService();

        Log.i(TAG, "Browser v3 initialized ✅ Multi-tab + Extension Bridge");
    }

    private void initViews() {
        webViewContainer = findViewById(R.id.webViewContainer);
        urlBar = findViewById(R.id.urlBar);
        progressBar = findViewById(R.id.progressBar);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        btnBack = findViewById(R.id.btnBack);
        btnMenu = findViewById(R.id.btnMenu);
        btnExtension = findViewById(R.id.btnExtension);

        swipeRefresh.setColorSchemeColors(0xFF4F7FFF, 0xFF7C3AED);
        swipeRefresh.setProgressBackgroundColorSchemeColor(0xFF1A1B2E);
        swipeRefresh.setOnRefreshListener(() -> {
            tabManager.reloadActiveTab();
            swipeRefresh.setRefreshing(false);
        });

        btnBack.setOnClickListener(v -> {
            if (tabManager.canGoBack())
                tabManager.goBack();
        });

        btnExtension.setOnClickListener(v -> {
            if (sidePanelOpen)
                closeSidePanel();
            else
                openSidePanel();
        });
    }

    // ─── TabManager.TabEventListener ───
    @Override
    public void onUrlChanged(int tabId, String url) {
        runOnUiThread(() -> updateUrlBar(url));
    }

    @Override
    public void onTitleChanged(int tabId, String title) {
        /* could update title */ }

    @Override
    public void onProgressChanged(int tabId, int progress) {
        runOnUiThread(() -> {
            progressBar.setProgress(progress);
            progressBar.setVisibility(progress < 100 ? View.VISIBLE : View.GONE);
        });
    }

    @Override
    public void onTabCreated(int tabId) {
        Log.d(TAG, "Tab created: " + tabId + " (total: " + tabManager.getTabCount() + ")");
    }

    @Override
    public void onTabRemoved(int tabId) {
        Log.d(TAG, "Tab removed: " + tabId + " (total: " + tabManager.getTabCount() + ")");
    }

    // ─── Side Panel ───
    @SuppressLint({ "SetJavaScriptEnabled", "JavascriptInterface" })
    private void setupSidePanel() {
        sidePanelOverlay = findViewById(R.id.sidePanelOverlay);
        sidePanelContainer = findViewById(R.id.sidePanelContainer);
        sidePanelBackdrop = findViewById(R.id.sidePanelBackdrop);
        btnClosePanel = findViewById(R.id.btnClosePanel);
        sidePanelWebView = findViewById(R.id.sidePanelWebView);

        WebSettings spSettings = sidePanelWebView.getSettings();
        spSettings.setJavaScriptEnabled(true);
        spSettings.setDomStorageEnabled(true);
        spSettings.setAllowFileAccess(true);
        spSettings.setAllowFileAccessFromFileURLs(true);
        spSettings.setAllowUniversalAccessFromFileURLs(true);
        spSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        sidePanelWebView.addJavascriptInterface(extensionBridge, "aabBridge");

        sidePanelWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                extensionBridge.injectAssetScript(view, "extension/chrome-api-shim.js");
            }
        });

        sidePanelWebView.setWebChromeClient(new WebChromeClient());

        btnClosePanel.setOnClickListener(v -> closeSidePanel());
        sidePanelBackdrop.setOnClickListener(v -> closeSidePanel());
    }

    @Override
    public void onOpenSidePanel() {
        runOnUiThread(this::openSidePanel);
    }

    private void openSidePanel() {
        if (sidePanelOpen)
            return;
        sidePanelOpen = true;
        sidePanelWebView.loadUrl(POPUP_URL);
        sidePanelOverlay.setVisibility(View.VISIBLE);

        Animation slideIn = new TranslateAnimation(
                Animation.RELATIVE_TO_SELF, 1.0f, Animation.RELATIVE_TO_SELF, 0.0f,
                Animation.RELATIVE_TO_SELF, 0.0f, Animation.RELATIVE_TO_SELF, 0.0f);
        slideIn.setDuration(250);
        slideIn.setFillAfter(true);
        sidePanelContainer.startAnimation(slideIn);

        sidePanelBackdrop.setAlpha(0f);
        sidePanelBackdrop.animate().alpha(1f).setDuration(250).start();
        btnExtension.setColorFilter(0xFF7C3AED);
    }

    private void closeSidePanel() {
        if (!sidePanelOpen)
            return;
        sidePanelOpen = false;

        Animation slideOut = new TranslateAnimation(
                Animation.RELATIVE_TO_SELF, 0.0f, Animation.RELATIVE_TO_SELF, 1.0f,
                Animation.RELATIVE_TO_SELF, 0.0f, Animation.RELATIVE_TO_SELF, 0.0f);
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
        sidePanelBackdrop.animate().alpha(0f).setDuration(200).start();
        btnExtension.setColorFilter(0xFF4F7FFF);
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
            popup.getMenu().add(0, 1, 0, "🏠 หน้าแรก");
            popup.getMenu().add(0, 2, 1, "🔄 รีเฟรช");
            popup.getMenu().add(0, 3, 2, "🧩 จัดการ Extension");
            popup.getMenu().add(0, 4, 3, "⚙️ ตั้งค่า");
            popup.getMenu().add(0, 5, 4, "📤 แชร์");
            popup.getMenu().add(0, 6, 5, "🗑️ ล้างข้อมูล");

            popup.setOnMenuItemClickListener(item -> {
                switch (item.getItemId()) {
                    case 1:
                        navigateActiveTab(NTP_URL);
                        return true;
                    case 2:
                        tabManager.reloadActiveTab();
                        return true;
                    case 3:
                        navigateActiveTab(EXT_MANAGER_URL);
                        return true;
                    case 4:
                        navigateActiveTab(SETTINGS_URL);
                        return true;
                    case 5:
                        shareCurrentUrl();
                        return true;
                    case 6:
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
        navigateActiveTab(url);
    }

    private void navigateActiveTab(String url) {
        int activeId = tabManager.getActiveTabId();
        if (activeId > 0) {
            tabManager.updateTab(activeId, url);
        } else {
            tabManager.createTab(url, true);
        }
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

    private void shareCurrentUrl() {
        WebView wv = tabManager.getActiveWebView();
        if (wv != null && wv.getUrl() != null && !wv.getUrl().startsWith("file://")) {
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("text/plain");
            share.putExtra(Intent.EXTRA_TEXT, wv.getUrl());
            startActivity(Intent.createChooser(share, "แชร์ลิงก์"));
        }
    }

    private void clearBrowsingData() {
        WebView wv = tabManager.getActiveWebView();
        if (wv != null) {
            wv.clearCache(true);
            wv.clearHistory();
            wv.clearFormData();
        }
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

    // ─── Foreground Service ───
    private void startExtensionService() {
        try {
            Intent serviceIntent = new Intent(this, ExtensionForegroundService.class);
            startForegroundService(serviceIntent);
        } catch (Exception e) {
            Log.w(TAG, "Could not start foreground service: " + e.getMessage());
        }
    }

    // ─── Lifecycle ───
    @Override
    public void onBackPressed() {
        if (sidePanelOpen) {
            closeSidePanel();
        } else if (tabManager.canGoBack()) {
            tabManager.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String url = intent.getDataString();
        if (url != null && !url.isEmpty())
            navigateActiveTab(url);
    }

    @Override
    protected void onPause() {
        super.onPause();
        tabManager.pauseAll();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        tabManager.resumeAll();
    }

    @Override
    protected void onDestroy() {
        try {
            stopService(new Intent(this, ExtensionForegroundService.class));
        } catch (Exception e) {
        }
        if (backgroundEngine != null)
            backgroundEngine.destroy();
        if (sidePanelWebView != null)
            sidePanelWebView.destroy();
        tabManager.destroyAll();
        super.onDestroy();
    }
}
