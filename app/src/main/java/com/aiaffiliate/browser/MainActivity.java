package com.aiaffiliate.browser;

import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.KeyEvent;
import android.view.View;
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
import android.widget.ImageButton;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/**
 * AiAffiliate Browser — Main Browser Activity
 * Full-featured mobile browser with:
 * - Desktop User-Agent (Chrome PC mode)
 * - Custom New Tab Page from assets
 * - Downloads manager
 * - Pull-to-refresh
 * - URL bar with smart search
 */
public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private EditText urlBar;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefresh;
    private ImageButton btnBack, btnMenu;

    // NTP and settings URLs (bundled in assets)
    private static final String NTP_URL = "file:///android_asset/custom-pages/new-tab/new-tab.html";
    private static final String SETTINGS_URL = "file:///android_asset/custom-pages/settings/settings.html";
    private static final String EXT_MANAGER_URL = "file:///android_asset/custom-pages/extension-manager/extension-manager.html";

    // Desktop User-Agent string
    private static final String DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    private SharedPreferences prefs;
    private boolean desktopMode = true;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences("aiaffiliate_prefs", MODE_PRIVATE);
        desktopMode = prefs.getBoolean("desktop_mode", true);

        initViews();
        setupWebView();
        setupUrlBar();
        setupMenu();

        // Handle incoming URLs from intents
        Intent intent = getIntent();
        String intentUrl = intent.getDataString();
        if (intentUrl != null && !intentUrl.isEmpty()) {
            loadUrl(intentUrl);
        } else {
            loadUrl(NTP_URL);
        }
    }

    private void initViews() {
        webView = findViewById(R.id.webView);
        urlBar = findViewById(R.id.urlBar);
        progressBar = findViewById(R.id.progressBar);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        btnBack = findViewById(R.id.btnBack);
        btnMenu = findViewById(R.id.btnMenu);

        swipeRefresh.setColorSchemeColors(0xFF4F7FFF, 0xFF7C3AED);
        swipeRefresh.setProgressBackgroundColorSchemeColor(0xFF1A1B2E);
        swipeRefresh.setOnRefreshListener(() -> {
            webView.reload();
        });

        btnBack.setOnClickListener(v -> {
            if (webView.canGoBack()) {
                webView.goBack();
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();

        // Core settings
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);

        // Performance
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);

        // Media
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Desktop mode
        if (desktopMode) {
            settings.setUserAgentString(DESKTOP_UA);
        }

        // Enable cookies
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        // Add native bridge for custom pages
        webView.addJavascriptInterface(new NativeBridge(this), "aabNative");

        // WebViewClient
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();

                // Handle special URLs
                if (url.startsWith("intent://") || url.startsWith("market://")) {
                    try {
                        Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                        startActivity(intent);
                    } catch (Exception e) {
                        // Ignore
                    }
                    return true;
                }

                // Internal navigation
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                progressBar.setVisibility(View.VISIBLE);
                updateUrlBar(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
                updateUrlBar(url);
            }
        });

        // WebChromeClient for progress & file uploads
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                if (newProgress >= 100) {
                    progressBar.setVisibility(View.GONE);
                }
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
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimetype, long contentLength) {
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

                    Toast.makeText(MainActivity.this, "⬇️ กำลังดาวน์โหลด: " + filename,
                            Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "❌ ดาวน์โหลดไม่สำเร็จ",
                            Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private void setupUrlBar() {
        urlBar.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO ||
                    (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                String input = urlBar.getText().toString().trim();
                if (!input.isEmpty()) {
                    navigateTo(input);
                }
                hideKeyboard();
                return true;
            }
            return false;
        });
    }

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
                    case 1: loadUrl(NTP_URL); return true;
                    case 2: webView.reload(); return true;
                    case 3: toggleDesktopMode(); return true;
                    case 4: loadUrl(EXT_MANAGER_URL); return true;
                    case 5: loadUrl(SETTINGS_URL); return true;
                    case 6: shareCurrentUrl(); return true;
                    case 7: clearBrowsingData(); return true;
                }
                return false;
            });

            popup.show();
        });
    }

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
            settings.setUserAgentString(null); // Reset to default mobile UA
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
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String url = intent.getDataString();
        if (url != null && !url.isEmpty()) {
            loadUrl(url);
        }
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
        webView.destroy();
        super.onDestroy();
    }
}
