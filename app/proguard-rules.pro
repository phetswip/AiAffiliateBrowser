# AiAffiliate Browser ProGuard rules
-keepclassmembers class * extends android.webkit.WebViewClient { *; }
-keepclassmembers class * extends android.webkit.WebChromeClient { *; }
-keepclassmembers class com.aiaffiliate.browser.** { *; }
-dontwarn android.webkit.**
