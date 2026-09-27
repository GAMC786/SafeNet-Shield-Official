package com.safenet.dns;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Device-local launch policy for explicitly selected VPN and proxy apps. */
public final class VpnProxyBrowserBlockerManager {
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
        Set<String> saved = prefs(context).getStringSet(PREF_BLOCKED_PACKAGES, null);
        if (saved == null || saved.isEmpty()) {
            return new HashSet<>();
        }
        return new HashSet<>(saved);
    }

    private static Set<String> getInstalledBlockedPackages(Context context) {
        Set<String> installedBlockedPackages = getBlockedPackages(context);
        installedBlockedPackages.retainAll(getLaunchablePackageNames(context));
        return installedBlockedPackages;
    }

    public static Set<String> setBlockedPackages(Context context, Set<String> packageNames) {
        Set<String> launchablePackages = getLaunchablePackageNames(context);
        Set<String> validated = new HashSet<>();
        if (packageNames != null) {
            for (String packageName : packageNames) {
                if (packageName != null && launchablePackages.contains(packageName)) {
                    validated.add(packageName);
                }
            }
        }
        prefs(context).edit().putStringSet(PREF_BLOCKED_PACKAGES, validated).apply();
        return validated;
    }

    public static boolean shouldBlockPackage(Context context, String packageName) {
        return shouldBlockPackage(
                isEnabled(context),
                AppLockManager.isAccessibilityServiceEnabled(context),
                getBlockedPackages(context),
                packageName,
                context.getPackageName()
        );
    }

    static boolean shouldBlockPackage(
            boolean enabled,
            boolean accessibilityEnabled,
            Set<String> blockedPackages,
            String packageName,
            String safeNetPackage
    ) {
        return enabled
                && accessibilityEnabled
                && packageName != null
                && !packageName.isEmpty()
                && !packageName.equals(safeNetPackage)
                && blockedPackages != null
                && blockedPackages.contains(packageName);
    }

    public static JSObject status(Context context) {
        boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N;
        boolean enabled = isEnabled(context);
        boolean accessibilityEnabled = AppLockManager.isAccessibilityServiceEnabled(context);
        Set<String> blockedPackages = getInstalledBlockedPackages(context);
        boolean active = supported
                && enabled
                && accessibilityEnabled
                && !blockedPackages.isEmpty();

        JSArray packageArray = new JSArray();
        List<String> sortedPackages = new ArrayList<>(blockedPackages);
        Collections.sort(sortedPackages);
        for (String packageName : sortedPackages) {
            packageArray.put(packageName);
        }

        String message;
        if (!supported) {
            message = "The launch blocker requires Android 7.0 or newer.";
        } else if (!enabled) {
            message = "Choose apps to block, then turn on the launch blocker.";
        } else if (blockedPackages.isEmpty()) {
            message = "Choose at least one installed app to block.";
        } else if (!accessibilityEnabled) {
            message = "Enable the SafeNet Accessibility Service in Android Settings to block selected app launches.";
        } else {
            message = "Active. Selected app launches return to the Android Home screen.";
        }

        JSObject result = new JSObject();
        result.put("supported", supported);
        result.put("enabled", enabled);
        result.put("active", active);
        result.put("accessibilityServiceEnabled", accessibilityEnabled);
        result.put("blockedPackages", packageArray);
        result.put("message", message);
        return result;
    }

    public static JSObject launchableApps(Context context) {
        Map<String, String> uniqueApps = getLaunchableAppsByPackage(context);
        List<Map.Entry<String, String>> sortedApps = new ArrayList<>(uniqueApps.entrySet());
        sortedApps.sort((left, right) ->
                String.CASE_INSENSITIVE_ORDER.compare(left.getValue(), right.getValue())
        );

        JSArray apps = new JSArray();
        for (Map.Entry<String, String> app : sortedApps) {
            JSObject item = new JSObject();
            item.put("packageName", app.getKey());
            item.put("displayName", app.getValue());
            apps.put(item);
        }
        JSObject result = new JSObject();
        result.put("apps", apps);
        return result;
    }

    private static Set<String> getLaunchablePackageNames(Context context) {
        return new HashSet<>(getLaunchableAppsByPackage(context).keySet());
    }

    private static Map<String, String> getLaunchableAppsByPackage(Context context) {
        PackageManager packageManager = context.getPackageManager();
        Set<String> excludedPackages = getExcludedPackages(context, packageManager);
        Intent launcherIntent = new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> resolvedApps =
                packageManager.queryIntentActivities(launcherIntent, 0);
        Map<String, String> uniqueApps = new LinkedHashMap<>();

        for (ResolveInfo resolvedApp : resolvedApps) {
            if (resolvedApp.activityInfo == null) {
                continue;
            }
            String packageName = resolvedApp.activityInfo.packageName;
            if (packageName == null
                    || packageName.isEmpty()
                    || excludedPackages.contains(packageName)
                    || uniqueApps.containsKey(packageName)) {
                continue;
            }
            CharSequence label = resolvedApp.loadLabel(packageManager);
            uniqueApps.put(
                    packageName,
                    label == null || label.length() == 0 ? packageName : label.toString()
            );
        }
        return uniqueApps;
    }

    private static Set<String> getExcludedPackages(
            Context context,
            PackageManager packageManager
    ) {
        Set<String> excluded = new HashSet<>();
        excluded.add(context.getPackageName());

        Intent homeIntent = new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_HOME);
        ResolveInfo home = packageManager.resolveActivity(
                homeIntent,
                PackageManager.MATCH_DEFAULT_ONLY
        );
        if (home != null && home.activityInfo != null) {
            excluded.add(home.activityInfo.packageName);
        }

        Intent settingsIntent = new Intent(android.provider.Settings.ACTION_SETTINGS);
        ResolveInfo settings = packageManager.resolveActivity(
                settingsIntent,
                PackageManager.MATCH_DEFAULT_ONLY
        );
        if (settings != null && settings.activityInfo != null) {
            excluded.add(settings.activityInfo.packageName);
        }
        return excluded;
    }

    private static android.content.SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }
}