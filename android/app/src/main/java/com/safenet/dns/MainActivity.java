package com.safenet.dns;

import android.os.Bundle;
import android.os.Build;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.WebSettings;

import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.ViewCompat;

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
        WebView webView = getBridge().getWebView();
        Log.i(TAG, "Capacitor WebView created; url=" + webView.getUrl());
        webView.setBackgroundColor(Color.rgb(9, 11, 20));
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        // Allow the SafeNet soundtrack to begin after the startup loader.
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

        configureSystemBars(webView);
    }

    private void configureSystemBars(WebView webView) {
        Window window = getWindow();
        // Explicitly opt out of fullscreen flags. This keeps the Android
        // status bar present during both the native launch surface and the
        // WebView handoff, including devices that restore window flags.
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.addFlags(WindowManager.LayoutParams.FLAG_FORCE_NOT_FULLSCREEN);
        // Android 15+ enforces edge-to-edge for newer target SDKs. Keep the
        // status/navigation regions black and move WebView content below the
        // live insets instead of allowing content to paint under white icons.
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.setStatusBarColor(Color.BLACK);
        window.setNavigationBarColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        WindowInsetsControllerCompat insetsController =
                WindowCompat.getInsetsController(window, window.getDecorView());
        insetsController.show(WindowInsetsCompat.Type.statusBars());
        insetsController.show(WindowInsetsCompat.Type.navigationBars());
        insetsController.setAppearanceLightStatusBars(false);
        insetsController.setAppearanceLightNavigationBars(false);

        if (webView.getParent() instanceof ViewGroup) {
            ViewGroup container = (ViewGroup) webView.getParent();
            container.setBackgroundColor(Color.BLACK);
            ViewCompat.setOnApplyWindowInsetsListener(container, (view, insets) -> {
                Insets systemBars = insets.getInsets(
                        WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                view.setPadding(0, systemBars.top, 0, systemBars.bottom);
                return insets;
            });
            ViewCompat.requestApplyInsets(container);
        }
    }

    private void restoreSystemBars() {
        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.addFlags(WindowManager.LayoutParams.FLAG_FORCE_NOT_FULLSCREEN);
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
                        "(function(){" +
                                "const loader=document.getElementById('startup-loader');" +
                                "const fallback=document.getElementById('dashboard-fallback');" +
                                "const pagePainted=!!document.querySelector('#root > *')||!!fallback;" +
                                "const controls=Array.from(document.querySelectorAll('button,[role=\"button\"]'))" +
                                        ".filter((element)=>/soundtrack|volume|music/i.test(" +
                                                "(element.getAttribute('aria-label')||'')+' '+element.textContent));" +
                                "return 'pagePainted='+(pagePainted?'true':'false')+" +
                                        "';loaderPresent='+(loader?'true':'false')+" +
                                        "';loaderBusy='+(loader?(loader.getAttribute('aria-busy')||'none'):'none')+" +
                                        "';loaderValue='+(loader?(loader.getAttribute('aria-valuenow')||'none'):'none')+" +
                                        "';fallbackPresent='+(fallback?'true':'false')+" +
                                        "';soundtrackControls='+controls.length;" +
                        "})()",
                        value -> {
                            Log.i(TAG, "WebView startup state: " + value);
                            boolean pagePainted = value.contains("pagePainted=true");
                            boolean loaderPresent = value.contains("loaderPresent=true");
                            if (pagePainted) {
                                if (startupFallback != null) {
                                    startupFallback.setVisibility(View.GONE);
                                }
                            }

                            if (!pagePainted &&
                                    SystemClock.uptimeMillis() >= startupDeadline &&
                                    startupFallback != null) {
                                Log.e(TAG, "WebView did not paint SafeNet content; showing native fallback");
                                startupFallback.setVisibility(View.VISIBLE);
                            }

                            if (!loaderPresent && pagePainted) {
                                Log.i(TAG, "WebView startup handoff complete");
                                return;
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
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        restoreSystemBars();
        resumeSoundtrack();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            restoreSystemBars();
        }
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

    private void resumeSoundtrack() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().getWebView().evaluateJavascript(
                "(function(){const a=document.getElementById('safenet-soundtrack-audio');" +
                        "if(!document.getElementById('startup-loader')&&a&&!a.muted)" +
                        "{void a.play().catch(()=>{});}})();",
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
