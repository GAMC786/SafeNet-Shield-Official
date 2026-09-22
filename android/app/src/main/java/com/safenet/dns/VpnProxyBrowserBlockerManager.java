package com.safenet.dns;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.text.TextUtils;

import com.getcapacitor.JSObject;

import java.util.HashSet;
import java.util.Set;

/**
 * Device-local policy for blocking selected VPN and proxy browser apps.
 *
 * The policy is enforced by the existing opt-in Accessibility service at the
 * foreground-app boundary. It does not inspect HTTPS or proxy tunnel traffic.
 */
public final class VpnProxyBrowserBlockerManager {
    public static final String EXTRA_MODE = "vpn_proxy_browser_blocker_mode";
    public static final String EXTRA_BLOCKED_PACKAGE = "vpn_proxy_browser_blocked_package";
    public static final String MODE_CONFIGURE = "configure";
    public static final String MODE_BLOCKED = "blocked";

    private static final String PREFS_NAME = "safenet_vpn_proxy_browser_blocker";
    private static final String PREF_ENABLED = "enabled";
    private static final String PREF_BLOCKED_PACKAGES = "blocked_packages";

    private VpnProxyBrowserBlockerManager() {}

    public static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(PREF_ENABLED, false);
    }

    public static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(PREF_ENABLED, enabled).apply();
    }

    public static Set<String> getBlockedPackages(Context context) {
        Set<String> stored = prefs(context).getStringSet(PREF_BLOCKED_PACKAGES, null);
        return stored == null ? new HashSet<>() : new HashSet<>(stored);
    }

    public static void setBlockedPackages(Context context, Set<String> packages) {
        HashSet<String> normalized = new HashSet<>();
        if (packages != null) {
            for (String packageName : packages) {
                if (!TextUtils.isEmpty(packageName)
                        && !context.getPackageName().equals(packageName)) {
                    normalized.add(packageName);
                }
            }
        }
        prefs(context).edit().putStringSet(PREF_BLOCKED_PACKAGES, normalized).apply();
    }

    public static boolean shouldBlockPackage(Context context, String packageName) {
        return isEnabled(context) && getBlockedPackages(context).contains(packageName);
    }

    public static boolean isLikelyVpnProxyBrowser(ApplicationInfo applicationInfo, PackageManager packageManager) {
        if (applicationInfo == null) {
            return false;
        }
        String label = "";
        try {
            label = applicationInfo.loadLabel(packageManager).toString();
        } catch (RuntimeException ignored) {
            // Package labels are best-effort; package name remains available.
        }
        String haystack = (label + " " + applicationInfo.packageName).toLowerCase(java.util.Locale.ROOT);
        return haystack.contains("upx")
                || haystack.contains("proxy")
                || haystack.contains("vpn")
                || haystack.contains("tor browser")
                || haystack.contains("orbot")
                || haystack.contains("psiphon")
                || haystack.contains("hola")
                || haystack.contains("turbovpn")
                || haystack.contains("turbo vpn")
                || haystack.contains("1.1.1.1");
    }

    public static JSObject status(Context context) {
        JSObject result = new JSObject();
        boolean accessibilityEnabled = AppLockManager.isAccessibilityEnabled(context);
        Set<String> blockedPackages = getBlockedPackages(context);
        result.put("supported", true);
        result.put("enabled", isEnabled(context));
        result.put("accessibilityEnabled", accessibilityEnabled);
        result.put("blockedPackageCount", blockedPackages.size());
        result.put("ready", isEnabled(context) && accessibilityEnabled && !blockedPackages.isEmpty());
        result.put("message", message(isEnabled(context), accessibilityEnabled, blockedPackages.size()));
        return result;
    }

    private static String message(boolean enabled, boolean accessibilityEnabled, int packageCount) {
        if (!enabled) {
            return "VPN and proxy browser blocking is off.";
        }
        if (packageCount == 0) {
            return "Select the VPN or proxy browsers SafeNet should block.";
        }
        if (!accessibilityEnabled) {
            return "Enable LockLock Accessibility so SafeNet can stop selected browser launches.";
        }
        return "Selected VPN and proxy browsers are blocked from opening.";
    }

    private static android.content.SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }
}