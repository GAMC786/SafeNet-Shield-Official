package com.safenet.dns;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.graphics.Color;
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
    private final Handler startupHandler = new Handler(Looper.getMainLooper());
    private StartupLoaderView startupLoader;
    private Runnable startupLoaderCheck;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafeNetVpnPlugin.class);
        super.onCreate(savedInstanceState);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(Color.rgb(9, 11, 20));
        cookieManager.setAcceptThirdPartyCookies(webView, true);
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        // Allow the SafeNet soundtrack to begin after the web loader completes.
        // Browser builds still respect autoplay policy and expose a
        // tap-to-enable fallback in the soundtrack control.
        webSettings.setMediaPlaybackRequiresUserGesture(false);
        installNativeStartupLoader(webView);

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

    private void installNativeStartupLoader(WebView webView) {
        if (!(webView.getParent() instanceof ViewGroup)) {
            return;
        }

        ViewGroup webViewContainer = (ViewGroup) webView.getParent();
        startupLoader = new StartupLoaderView(this);
        startupLoader.setClickable(false);
        startupLoader.setFocusable(false);
        startupLoader.setElevation(100f);
        webViewContainer.addView(
                startupLoader,
                new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                )
        );

        final long earliestHideTime = SystemClock.uptimeMillis() + 10_000L;
        startupLoaderCheck = new Runnable() {
            @Override
            public void run() {
                boolean webContentReady =
                        webView.getProgress() >= 80 && webView.getContentHeight() > 0;
                if (webContentReady && SystemClock.uptimeMillis() >= earliestHideTime) {
                    if (startupLoader != null) {
                        startupLoader.setVisibility(View.GONE);
                    }
                    return;
                }
                startupHandler.postDelayed(this, 120L);
            }
        };
        startupHandler.post(startupLoaderCheck);
    }

    @Override
    public void onDestroy() {
        if (startupLoaderCheck != null) {
            startupHandler.removeCallbacks(startupLoaderCheck);
        }
        startupLoader = null;
        stopStartupAudio();
        super.onDestroy();
    }

    @Override
    public void onPause() {
        stopStartupAudio();
        super.onPause();
    }

    private void stopStartupAudio() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().getWebView().evaluateJavascript(
                "(function(){const a=document.getElementById('safenet-startup-audio');" +
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
