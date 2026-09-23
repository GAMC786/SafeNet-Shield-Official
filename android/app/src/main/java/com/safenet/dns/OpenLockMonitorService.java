package com.safenet.dns;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;

/**
 * AppLock-style foreground monitor.
 *
 * Android owns the service lifecycle after the user explicitly enables the
 * Accessibility Service. SafeNet only observes window package transitions and
 * starts its opaque native lock activity for selected packages.
 */
public final class OpenLockMonitorService extends AccessibilityService {
    private static final long RELAUNCH_GUARD_MS = 1_500L;
    private static final long TEMPORARY_UNLOCK_MS = 15_000L;
    private static final long RETRY_DELAY_MS = 350L;

    private static volatile String temporarilyUnlockedPackage = "";
    private static volatile long temporarilyUnlockedUntil;

    private String lastLaunchedPackage;
    private long lastLaunchAt;
    private String pendingPackage;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable retryPendingLaunch = () -> {
        String packageName = pendingPackage;
        pendingPackage = null;
        if (packageName != null) {
            requestLock(packageName);
        }
    };

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                temporarilyUnlockedUntil = 0L;
                AppLockManager.clearSession();
            }
        }
    };

    public static boolean isUnlockTemporarilyAllowed(String packageName) {
        return packageName != null
                && packageName.equals(temporarilyUnlockedPackage)
                && System.currentTimeMillis() < temporarilyUnlockedUntil;
    }

    public static void allowTemporaryUnlock(String packageName) {
        temporarilyUnlockedPackage = packageName == null ? "" : packageName;
        temporarilyUnlockedUntil = System.currentTimeMillis() + TEMPORARY_UNLOCK_MS;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(
                    screenReceiver,
                    new IntentFilter(Intent.ACTION_SCREEN_OFF),
                    Context.RECEIVER_NOT_EXPORTED
            );
        } else {
            registerReceiver(screenReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));
        }
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        AccessibilityServiceInfo configured = getServiceInfo();
        if (configured == null) {
            configured = new AccessibilityServiceInfo();
        }
        configured.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                | AccessibilityEvent.TYPE_WINDOWS_CHANGED;
        configured.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        configured.notificationTimeout = 100;
        configured.flags = configured.flags
                | AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        setServiceInfo(configured);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null
                || (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                && event.getEventType() != AccessibilityEvent.TYPE_WINDOWS_CHANGED)) {
            return;
        }

        CharSequence packageNameValue = event.getPackageName();
        if (packageNameValue == null) {
            return;
        }
        String packageName = packageNameValue.toString();
        if (packageName.isEmpty() || packageName.equals(getPackageName())) {
            return;
        }

        requestLock(packageName);
    }

    private void requestLock(String packageName) {
        if (!AppLockManager.shouldLockPackage(this, packageName)
                || AppLockManager.isLockActivityActive()) {
            return;
        }
        if (packageName.equals(pendingPackage)) {
            return;
        }
        long now = System.currentTimeMillis();
        if (packageName.equals(lastLaunchedPackage)
                && now - lastLaunchAt < RELAUNCH_GUARD_MS) {
            return;
        }

        Intent lockIntent = new Intent(this, AppLockActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_NO_ANIMATION
                        | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(AppLockManager.EXTRA_LOCKED_PACKAGE, packageName);
        try {
            startActivity(lockIntent);
            lastLaunchedPackage = packageName;
            lastLaunchAt = System.currentTimeMillis();
        } catch (RuntimeException error) {
            // Android may briefly reject a background activity launch during a
            // window transition. Retry the same package instead of waiting for
            // another distinct foreground event.
            pendingPackage = packageName;
            mainHandler.removeCallbacks(retryPendingLaunch);
            mainHandler.postDelayed(retryPendingLaunch, RETRY_DELAY_MS);
        }
    }

    @Override
    public void onInterrupt() {
        // No polling or foreground notification is required for this service.
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(retryPendingLaunch);
        try {
            unregisterReceiver(screenReceiver);
        } catch (IllegalArgumentException ignored) {
            // The receiver may not have completed registration.
        }
        super.onDestroy();
    }
}