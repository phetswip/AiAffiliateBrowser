package com.aiaffiliate.browser;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

/**
 * AiAffiliate Browser — Native Bridge
 * Exposes Android native functionality to JavaScript in WebView.
 * Accessible via `window.aabNative` in custom pages.
 */
public class NativeBridge {

    private final Context context;
    private static final String PREFS = "aiaffiliate_prefs";

    public NativeBridge(Context context) {
        this.context = context;
    }

    @JavascriptInterface
    public String getVersion() {
        return "1.5.0";
    }

    @JavascriptInterface
    public String getEngineVersion() {
        // Get WebView version
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            String pkg = WebView.getCurrentWebViewPackage() != null ?
                    WebView.getCurrentWebViewPackage().packageName : "unknown";
            String ver = WebView.getCurrentWebViewPackage() != null ?
                    WebView.getCurrentWebViewPackage().versionName : "unknown";
            return "Chromium " + ver;
        }
        return "Chromium " + Build.VERSION.SDK_INT;
    }

    @JavascriptInterface
    public boolean isDesktopMode() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean("desktop_mode", true);
    }

    @JavascriptInterface
    public void setDesktopMode(boolean enabled) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean("desktop_mode", enabled).apply();
    }

    @JavascriptInterface
    public String getPreference(String key) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(key, "");
    }

    @JavascriptInterface
    public void setPreference(String key, String value) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(key, value).apply();
    }

    @JavascriptInterface
    public String getDeviceInfo() {
        return Build.MANUFACTURER + " " + Build.MODEL + " (Android " + Build.VERSION.RELEASE + ")";
    }
}
