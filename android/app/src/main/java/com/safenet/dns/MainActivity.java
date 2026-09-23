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
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.ViewCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "SafeNetWebView";
    private static final int APP_LOCK_ACTIVITY_REQUEST = 6201;
    private final Handler startupHandler = new Handler(Looper.getMainLooper());
    private NativeStartupFallbackView startupFallback;
    private NativeAppLockView appLockView;
    private WebView appLockWebView;
    private boolean appLockHasResumed;
    private boolean appLockNeedsUnlockOnResume;
    private boolean appLockActivityActive;
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
        installAppLock(webView);
        handleAppLockRecoveryIntent(getIntent());
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

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAppLockRecoveryIntent(intent);
    }

    private void handleAppLockRecoveryIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }
        Uri data = intent.getData();
        if (data == null
                || !"safenet".equalsIgnoreCase(data.getScheme())
                || !"app-lock".equalsIgnoreCase(data.getHost())
                || !"/recovery".equals(data.getPath())) {
            return;
        }
        String handoff = data.getQueryParameter("handoff");
        String nonce = data.getQueryParameter("nonce");
        if (handoff == null
                || handoff.trim().isEmpty()
                || !AppLockManager.hasPendingRecoveryNonce(this, nonce)) {
            Log.w(TAG, "Ignoring an App Lock recovery link without a matching local request.");
            return;
        }
        startActivity(
                new Intent(this, AppLockActivity.class)
                        .putExtra(AppLockManager.EXTRA_MODE, AppLockManager.MODE_ACCOUNT_RECOVERY)
                        .putExtra(AppLockManager.EXTRA_RECOVERY_HANDOFF, handoff)
                        .putExtra(AppLockManager.EXTRA_RECOVERY_NONCE, nonce)
                        .putExtra(AppLockManager.EXTRA_LOCKED_PACKAGE, getPackageName())
        );
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
        }
        applySystemBarInsets(webView);
        applySystemBarInsets(startupFallback);
        applySystemBarInsets(appLockView);
    }

    private void applySystemBarInsets(View view) {
        if (view == null) {
            return;
        }
        ViewCompat.setOnApplyWindowInsetsListener(view, (target, insets) -> {
            Insets systemBars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            if (target instanceof WebView) {
                // The web shell owns system-bar spacing for its fixed menus and
                // scroll content. Padding the WebView here would apply those
                // insets a second time.
                target.setPadding(0, 0, 0, 0);
                setWebViewSystemBarInsets(
                        (WebView) target,
                        systemBars.top,
                        systemBars.bottom
                );
            } else {
                target.setPadding(0, systemBars.top, 0, systemBars.bottom);
            }
            return insets;
        });
        ViewCompat.requestApplyInsets(view);
    }

    private void setWebViewSystemBarInsets(WebView webView, int topInset, int bottomInset) {
        webView.evaluateJavascript(
                "(function(){document.documentElement.style.setProperty(" +
                        "'--safenet-status-bar-inset','" + topInset + "px');" +
                        "document.documentElement.style.setProperty(" +
                        "'--safenet-navigation-bar-inset','" + bottomInset + "px');})();",
                null
        );
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

    private void installAppLock(WebView webView) {
        if (!(webView.getParent() instanceof ViewGroup)) {
            return;
        }

        appLockWebView = webView;
        ViewGroup container = (ViewGroup) webView.getParent();
        appLockView = new NativeAppLockView(this);
        appLockView.setVisibility(View.GONE);
        appLockView.setElevation(200f);
        appLockView.setOnUnlockClickListener(view -> requestAppUnlock());
        appLockView.setOnSecuritySettingsClickListener(view -> openAndroidSecuritySettings());
        container.addView(
                appLockView,
                new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                )
        );

        if (AppLockManager.isEnabled(this)) {
            appLockWebView.setVisibility(View.INVISIBLE);
            appLockView.setVisibility(View.VISIBLE);
            appLockView.setMessage(
                    AppLockManager.availabilityMessage(this)
            );
        }
    }

    private void requestAppUnlock() {
        if (appLockWebView == null || appLockView == null) {
            return;
        }
        if (!AppLockManager.isEnabled(this)) {
            appLockWebView.setVisibility(View.VISIBLE);
            appLockView.setVisibility(View.GONE);
            return;
        }
        if (appLockActivityActive) {
            appLockView.setMessage("The SafeNet authentication screen is already open.");
            return;
        }

        appLockWebView.setVisibility(View.INVISIBLE);
        appLockView.setVisibility(View.VISIBLE);
        appLockActivityActive = true;
        String mode = AppLockManager.hasPin(this)
                ? AppLockManager.MODE_UNLOCK
                : AppLockManager.MODE_SETUP;
        appLockView.setMessage(
                AppLockManager.hasPin(this)
                        ? "Enter your SafeNet passcode to continue."
                        : "Set up App Lock and a local SafeNet passcode."
        );
        startActivityForResult(
                new Intent(this, AppLockActivity.class)
                        .putExtra(AppLockManager.EXTRA_MODE, mode)
                        .putExtra(AppLockManager.EXTRA_LOCKED_PACKAGE, getPackageName()),
                APP_LOCK_ACTIVITY_REQUEST
        );
    }

    private void openAndroidSecuritySettings() {
        if (appLockActivityActive) {
            return;
        }
        appLockActivityActive = true;
        Intent intent = new Intent(this, AppLockActivity.class)
                .putExtra(
                        AppLockManager.EXTRA_MODE,
                        AppLockManager.hasPin(this)
                                ? AppLockManager.MODE_UNLOCK
                                : AppLockManager.MODE_SETUP
                )
                .putExtra(AppLockManager.EXTRA_LOCKED_PACKAGE, getPackageName());
        if (AppLockManager.hasPin(this)) {
            intent.putExtra(AppLockManager.EXTRA_OPEN_DASHBOARD_AFTER_AUTH, true);
        }
        startActivityForResult(
                intent,
                APP_LOCK_ACTIVITY_REQUEST
        );
    }

    public void lockAppNow() {
        if (appLockWebView == null || appLockView == null) {
            return;
        }
        appLockWebView.setVisibility(View.INVISIBLE);
        appLockView.setVisibility(View.VISIBLE);
        requestAppUnlock();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != APP_LOCK_ACTIVITY_REQUEST) {
            return;
        }
        appLockActivityActive = false;
        if (resultCode == RESULT_OK) {
            AppLockManager.markAuthenticated();
            appLockNeedsUnlockOnResume = false;
            if (appLockView != null) {
                appLockView.setVisibility(View.GONE);
            }
            if (appLockWebView != null) {
                appLockWebView.setVisibility(View.VISIBLE);
                beginStartupCheck(appLockWebView);
            }
        } else if (appLockView != null && AppLockManager.isEnabled(this)) {
            appLockView.setVisibility(View.VISIBLE);
            appLockView.setMessage("Enter your SafeNet passcode to continue.");
        }
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
        appLockView = null;
        appLockWebView = null;
        stopSoundtrack();
        super.onDestroy();
    }

    @Override
    public void onPause() {
        stopSoundtrack();
        if (AppLockManager.isEnabled(this) && !appLockActivityActive) {
            AppLockManager.clearSession();
            if (appLockHasResumed) {
                appLockNeedsUnlockOnResume = true;
            }
            if (appLockWebView != null) {
                appLockWebView.setVisibility(View.INVISIBLE);
            }
            if (appLockView != null) {
                appLockView.setVisibility(View.VISIBLE);
            }
        }
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        restoreSystemBars();
        resumeSoundtrack();
        AppLockManager.startMonitorServiceIfReady(this);
        if (!appLockHasResumed) {
            appLockHasResumed = true;
            appLockNeedsUnlockOnResume = AppLockManager.isEnabled(this)
                    && !AppLockManager.isSessionAuthenticated();
        }
        if (appLockNeedsUnlockOnResume
                && AppLockManager.isEnabled(this)
                && !AppLockManager.isSessionAuthenticated()
                && appLockView != null) {
            appLockNeedsUnlockOnResume = false;
            appLockView.post(this::requestAppUnlock);
        }
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
                        "if(a&&!a.muted){const p=a.play();" +
                        "if(p&&typeof p.catch==='function'){p.catch(()=>{});}}})();",
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
