package com.safenet.dns;

import android.accessibilityservice.AccessibilityService;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.Locale;

/**
 * LockLock-style foreground-app monitor.
 *
 * SafeNet is always protected by default; users can also select launchable
 * apps in the LockLock setup surface. The service only reads the visible
 * accessibility tree when anti-uninstall mode is enabled.
 */
public final class LockLockAccessibilityService extends AccessibilityService {
    private static final String SETTINGS_PACKAGE = "com.android.settings";
    private static final long TEMPORARY_UNLOCK_MS = 15_000L;
    private static volatile String temporarilyUnlockedPackage = "";
    private static volatile long temporarilyUnlockedUntil;
    private String lastOpenedPackage = "";
    private final BroadcastReceiver unlockReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String packageName = intent.getStringExtra(AppLockManager.EXTRA_PACKAGE_NAME);
            if (packageName != null && !packageName.isEmpty()) {
                temporarilyUnlockedPackage = packageName;
                temporarilyUnlockedUntil = System.currentTimeMillis() + TEMPORARY_UNLOCK_MS;
            }
        }
    };

    public static boolean isUnlockTemporarilyAllowed(String packageName) {
        return packageName != null
                && packageName.equals(temporarilyUnlockedPackage)
                && System.currentTimeMillis() < temporarilyUnlockedUntil;
    }

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        IntentFilter filter = new IntentFilter(AppLockManager.ACTION_APP_UNLOCKED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(unlockReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(unlockReceiver, filter);
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getPackageName() == null) {
            return;
        }

        String openedPackage = event.getPackageName().toString();
        if (AppLockManager.isAntiUninstallEnabled(this)
                && SETTINGS_PACKAGE.equals(openedPackage)) {
            blockSafeNetUninstallIfVisible(getRootInActiveWindow());
        }

        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                || openedPackage.equals(lastOpenedPackage)) {
            return;
        }
        lastOpenedPackage = openedPackage;

        if (!AppLockManager.shouldLockPackage(this, openedPackage)
                || isLockActivity(event)
                || isUnlockTemporarilyAllowed(openedPackage)) {
            return;
        }

        Intent intent = new Intent(this, LockLockActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
                .putExtra(AppLockManager.EXTRA_MODE, AppLockManager.MODE_UNLOCK)
                .putExtra(AppLockManager.EXTRA_LOCKED_PACKAGE, openedPackage);
        startActivity(intent);
    }

    private boolean isLockActivity(AccessibilityEvent event) {
        CharSequence className = event.getClassName();
        return className != null
                && className.toString().equals(LockLockActivity.class.getName());
    }

    private void blockSafeNetUninstallIfVisible(AccessibilityNodeInfo node) {
        if (node == null) {
            return;
        }
        String visibleText = nodeText(node);
        String normalized = visibleText.toLowerCase(Locale.ROOT);
        boolean uninstallVisible = normalized.contains("uninstall")
                || normalized.contains("remove app")
                || normalized.contains("uninstall updates");
        boolean safeNetVisible = normalized.contains("safenet")
                || normalized.contains("shield");
        if (uninstallVisible && safeNetVisible) {
            performGlobalAction(GLOBAL_ACTION_HOME);
            return;
        }
        for (int index = 0; index < node.getChildCount(); index++) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child != null) {
                blockSafeNetUninstallIfVisible(child);
                child.recycle();
            }
        }
    }

    private String nodeText(AccessibilityNodeInfo node) {
        StringBuilder text = new StringBuilder();
        if (node.getText() != null) {
            text.append(node.getText()).append(' ');
        }
        if (node.getContentDescription() != null) {
            text.append(node.getContentDescription()).append(' ');
        }
        return text.toString();
    }

    @Override
    public void onInterrupt() {
        // Android may interrupt accessibility delivery; the next event resumes monitoring.
    }

    @Override
    public void onDestroy() {
        try {
            unregisterReceiver(unlockReceiver);
        } catch (IllegalArgumentException ignored) {
            // The service may be destroyed before Android completed registration.
        }
        super.onDestroy();
    }
}