package com.safenet.dns;

import android.os.Bundle;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Window;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebSettings;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "SafeNetWebView";
    private final Handler startupHandler = new Handler(Looper.getMainLooper());
    private NativeStartupFallbackView startupFallback;
    private Runnable startupCheck;
    private long startupDeadline;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafeNetVpnPlugin.class);
        super.onCreate(savedInstanceState);

        Log.i(TAG, "SafeNet activity created");
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        WebView webView = getBridge().getWebView();
        Log.i(TAG, "Capacitor WebView created; url=" + webView.getUrl());
        webView.setBackgroundColor(Color.rgb(9, 11, 20));
        cookieManager.setAcceptThirdPartyCookies(webView, true);
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        // Allow the SafeNet soundtrack to begin when the app shell mounts.
        // Browser builds still respect autoplay policy and expose a
        // tap-to-enable fallback in the soundtrack control.
        webSettings.setMediaPlaybackRequiresUserGesture(false);
        installNativeFallback(webView);
        webView.postDelayed(
                () -> Log.i(
                        TAG,
                        "WebView startup check; url=" + webView.getUrl() +
                                ", title=" + webView.getTitle() +
                                ", width=" + webView.getWidth() +
                                ", height=" + webView.getHeight()
                ),
                5000
        );

        Window window = getWindow();
        // Keep the web content below system bars where the platform allows it.
        // Android 15+ may enforce edge-to-edge for newer target SDKs, so the
        // web layer also declares safe-area padding in index.css.
        WindowCompat.setDecorFitsSystemWindows(window, true);
        window.setStatusBarColor(ContextCompat.getColor(this, R.color.status_bar));
        window.setNavigationBarColor(ContextCompat.getColor(this, R.color.navigation_bar));

        WindowInsetsControllerCompat insetsController =
                WindowCompat.getInsetsController(window, window.getDecorView());
        insetsController.show(WindowInsetsCompat.Type.statusBars());
        insetsController.show(WindowInsetsCompat.Type.navigationBars());
        insetsController.setAppearanceLightStatusBars(false);
        insetsController.setAppearanceLightNavigationBars(false);
    }

    private void installNativeFallback(WebView webView) {
        if (!(webView.getParent() instanceof ViewGroup)) {
            return;
        }

        ViewGroup container = (ViewGroup) webView.getParent();
        startupFallback = new NativeStartupFallbackView(this);
        startupFallback.setVisibility(View.GONE);
        startupFallback.setElevation(100f);
        startupFallback.setOnClickListener(view -> {
            webView.reload();
            beginStartupCheck(webView);
        });
        container.addView(
                startupFallback,
                new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                )
        );
        beginStartupCheck(webView);
    }

    private void beginStartupCheck(WebView webView) {
        if (startupCheck != null) {
            startupHandler.removeCallbacks(startupCheck);
        }
        startupDeadline = SystemClock.uptimeMillis() + 4500L;
        startupCheck = new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(
                        "(function(){return !!document.querySelector('#root > *') || !!document.querySelector('#dashboard-fallback');})()",
                        value -> {
                            boolean pagePainted = "true".equals(value);
                            if (pagePainted) {
                                if (startupFallback != null) {
                                    startupFallback.setVisibility(View.GONE);
                                }
                                return;
                            }

                            if (SystemClock.uptimeMillis() >= startupDeadline && startupFallback != null) {
                                Log.e(TAG, "WebView did not paint SafeNet content; showing native fallback");
                                startupFallback.setVisibility(View.VISIBLE);
                            }
                            startupHandler.postDelayed(this, 1000L);
                        }
                );
            }
        };
        startupHandler.post(startupCheck);
    }

    @Override
    public void onDestroy() {
        if (startupCheck != null) {
            startupHandler.removeCallbacks(startupCheck);
        }
        startupFallback = null;
        stopSoundtrack();
        super.onDestroy();
    }

    @Override
    public void onPause() {
        stopSoundtrack();
        super.onPause();
    }

    private void stopSoundtrack() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().getWebView().evaluateJavascript(
                "(function(){const a=document.getElementById('safenet-soundtrack-audio');" +
                        "if(a){a.pause();a.currentTime=0;}})();",
                null
        );
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge().getWebView();
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}
