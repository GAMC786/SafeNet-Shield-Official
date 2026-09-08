package com.safenet.dns;

import android.os.Bundle;
import android.graphics.Color;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebSettings;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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
        // Allow the SafeNet soundtrack to begin when the app shell mounts.
        // Browser builds still respect autoplay policy and expose a
        // tap-to-enable fallback in the soundtrack control.
        webSettings.setMediaPlaybackRequiresUserGesture(false);

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

    @Override
    public void onDestroy() {
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
