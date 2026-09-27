package com.safenet.dns;

import android.app.admin.DevicePolicyManager;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.view.accessibility.AccessibilityManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.os.UserManager;

import com.getcapacitor.JSObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.HashSet;
import java.util.Set;

/**
 * Offline App Lock protection used by SafeNet's LockLock-derived
 * configuration surface.
 *
 * SafeNet uses Android's explicit Accessibility Service and an opaque lock
 * activity to observe protected foreground apps. The passcode remains local,
 * salted, and never leaves the device.
 */
public final class AppLockManager {
    public static final String ACTION_APP_UNLOCKED = "com.safenet.dns.APP_UNLOCKED";
    public static final String EXTRA_PACKAGE_NAME = "packageName";
    public static final String EXTRA_LOCKED_PACKAGE = "locked_package";
    public static final String EXTRA_AFTER_UNLOCK_PRIVATE_DNS = "after_unlock_private_dns";
    public static final String EXTRA_MODE = "mode";
    public static final String EXTRA_OPEN_DASHBOARD_AFTER_AUTH = "open_dashboard_after_auth";
    public static final String EXTRA_RECOVERY_HANDOFF = "recovery_handoff";
    public static final String EXTRA_RECOVERY_NONCE = "recovery_nonce";
    public static final String MODE_SETUP = "setup";
    public static final String MODE_UNLOCK = "unlock";
    public static final String MODE_DISABLE = "disable";
    public static final String MODE_ACCOUNT_RECOVERY = "account_recovery";

    private static final String PREFS_NAME = "safenet_openlock";
    private static final String PREF_ENABLED = "enabled";
    private static final String PREF_ANTI_UNINSTALL = "anti_uninstall";
    private static final String PREF_PIN_HASH = "pin_hash";
    private static final String PREF_PIN_SALT = "pin_salt";
    private static final String PREF_RECOVERY_QUESTION = "recovery_question";
    private static final String PREF_RECOVERY_HASH = "recovery_hash";
    private static final String PREF_RECOVERY_SALT = "recovery_salt";
    private static final String PREF_FAILED_ATTEMPTS = "failed_attempts";
    private static final String PREF_COOLDOWN_UNTIL = "cooldown_until";
    private static final String PREF_COOLDOWN_LEVEL = "cooldown_level";
    private static final String PREF_LOCKED_PACKAGES = "locked_packages";
    private static final String PREF_RECOVERY_NONCE = "recovery_nonce";
    private static final String PREF_MANAGED_RESTRICTIONS = "managed_device_owner_restrictions";
    private static final String PREF_MANAGED_SUSPENDED_PACKAGES =
            "managed_device_owner_suspended_packages";
    private static final String PREF_MANAGED_HIDDEN_PACKAGES =
            "managed_device_owner_hidden_packages";
    private static final int HASH_ROUNDS = 100_000;
    private static final int MAX_PIN_LENGTH = 12;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static volatile boolean sessionAuthenticated;
    private static int lockActivityCount;

    private AppLockManager() {}

    public static final class PinResult {
        public final boolean success;
        public final String message;
        public final long cooldownRemainingMs;

        private PinResult(boolean success, String message, long cooldownRemainingMs) {
            this.success = success;
            this.message = message;
            this.cooldownRemainingMs = cooldownRemainingMs;
        }

        public static PinResult success() {
            return new PinResult(true, "Passcode accepted.", 0L);
        }

        public static PinResult failure(String message, long cooldownRemainingMs) {
            return new PinResult(false, message, cooldownRemainingMs);
        }
    }

    public static boolean isSupported(Context context) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.N;
    }

    public static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(PREF_ENABLED, false);
    }

    public static boolean isProtectionActive(Context context) {
        return isSupported(context)
                && isEnabled(context)
                && hasPin(context)
                && isAccessibilityServiceEnabled(context)
                && isOverlayPermissionEnabled(context);
    }

    public static boolean hasPin(Context context) {
        return !TextUtils.isEmpty(prefs(context).getString(PREF_PIN_HASH, null));
    }

    public static boolean isAntiUninstallEnabled(Context context) {
        return prefs(context).getBoolean(PREF_ANTI_UNINSTALL, false);
    }

    public static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(PREF_ENABLED, enabled).apply();
        if (!enabled) {
            sessionAuthenticated = false;
            OpenLockMonitorService.clearTemporaryUnlock();
            stopMonitorService(context);
        } else {
            startMonitorServiceIfReady(context);
        }
    }

    public static void setAntiUninstallEnabled(Context context, boolean enabled) {
        if (isDeviceOwnerEnabled(context)) {
            DevicePolicyManager manager =
                    (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
            if (manager == null) {
                throw new IllegalStateException("Android Device Policy is unavailable.");
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P && enabled) {
                throw new IllegalStateException(
                        "Anti-uninstall protection requires Android 9.0 or newer."
                );
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                manager.setUninstallBlocked(
                        adminComponent(context),
                        context.getPackageName(),
                        enabled
                );
            }
        } else if (!enabled) {
            removeActiveDeviceAdmin(context);
        }
        prefs(context).edit().putBoolean(PREF_ANTI_UNINSTALL, enabled).apply();
    }

    public static boolean disableAntiUninstall(Context context) {
        setAntiUninstallEnabled(context, false);
        return !isAntiUninstallEnabled(context);
    }

    public static Set<String> getLockedPackages(Context context) {
        Set<String> stored = prefs(context).getStringSet(PREF_LOCKED_PACKAGES, null);
        if (stored == null || stored.isEmpty()) {
            HashSet<String> defaults = new HashSet<>();
            defaults.add(context.getPackageName());
            return defaults;
        }
        return new HashSet<>(stored);
    }

    public static void setLockedPackages(Context context, Set<String> packages) {
        HashSet<String> normalized = new HashSet<>();
        if (packages != null) {
            for (String packageName : packages) {
                if (!TextUtils.isEmpty(packageName)) {
                    normalized.add(packageName);
                }
            }
        }
        normalized.add(context.getPackageName());
        prefs(context).edit().putStringSet(PREF_LOCKED_PACKAGES, normalized).apply();
    }

    public static boolean isSessionAuthenticated() {
        return sessionAuthenticated;
    }

    public static void markAuthenticated() {
        sessionAuthenticated = true;
    }

    public static void clearSession() {
        sessionAuthenticated = false;
    }

    public static String createRecoveryNonce(Context context) {
        byte[] nonce = new byte[32];
        RANDOM.nextBytes(nonce);
        String encoded = android.util.Base64.encodeToString(
                nonce,
                android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING
        );
        prefs(context).edit().putString(PREF_RECOVERY_NONCE, encoded).apply();
        return encoded;
    }

    public static boolean hasPendingRecoveryNonce(Context context, String nonce) {
        return !TextUtils.isEmpty(nonce)
                && MessageDigest.isEqual(
                        nonce.getBytes(StandardCharsets.UTF_8),
                        prefs(context).getString(PREF_RECOVERY_NONCE, "").getBytes(StandardCharsets.UTF_8)
                );
    }

    public static boolean consumeRecoveryNonce(Context context, String nonce) {
        if (!hasPendingRecoveryNonce(context, nonce)) {
            return false;
        }
        prefs(context).edit().remove(PREF_RECOVERY_NONCE).apply();
        return true;
    }

    public static synchronized boolean isLockActivityActive() {
        return lockActivityCount > 0;
    }

    public static synchronized void markLockActivityActive() {
        lockActivityCount++;
    }

    public static synchronized void clearLockActivityActive() {
        lockActivityCount = Math.max(0, lockActivityCount - 1);
    }

    public static boolean isAccessibilityServiceEnabled(Context context) {
        AccessibilityManager manager =
                (AccessibilityManager) context.getSystemService(Context.ACCESSIBILITY_SERVICE);
        if (manager == null) {
            return false;
        }
        String expectedClassName = OpenLockMonitorService.class.getName();
        for (AccessibilityServiceInfo serviceInfo :
                manager.getEnabledAccessibilityServiceList(
                        AccessibilityServiceInfo.FEEDBACK_ALL_MASK
                )) {
            if (serviceInfo.getResolveInfo() == null
                    || serviceInfo.getResolveInfo().serviceInfo == null) {
                continue;
            }
            android.content.pm.ServiceInfo enabledService =
                    serviceInfo.getResolveInfo().serviceInfo;
            if (context.getPackageName().equals(enabledService.packageName)
                    && expectedClassName.equals(enabledService.name)) {
                return true;
            }
        }
        return false;
    }

    public static boolean isOverlayPermissionEnabled(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || Settings.canDrawOverlays(context);
    }

    public static boolean isDeviceAdminEnabled(Context context) {
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return manager != null && manager.isAdminActive(adminComponent(context));
    }

    public static boolean isDeviceOwnerEnabled(Context context) {
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return manager != null && manager.isDeviceOwnerApp(context.getPackageName());
    }

    public static boolean isAuthenticationAvailable(Context context) {
        return isSupported(context) && hasPin(context);
    }

    public static String availabilityMessage(Context context) {
        if (!isSupported(context)) {
            return "SafeNet App Lock requires Android 7.0 or newer.";
        }
        if (!hasPin(context)) {
            return "Create an offline passcode to enable SafeNet App Lock.";
        }
        if (!isAccessibilityServiceEnabled(context)) {
            return "Enable the SafeNet App Lock Accessibility Service to monitor protected app launches.";
        }
        if (!isOverlayPermissionEnabled(context)) {
            return "Allow App Lock to display the lock screen over protected apps.";
        }
        if (isAntiUninstallEnabled(context) && !isDeviceOwnerEnabled(context)) {
            return "Provision SafeNet as Device Owner from App Lock settings to enable anti-uninstall protection.";
        }
        return "SafeNet App Lock is ready with the local passcode and Accessibility Service.";
    }

    public static JSObject status(Context context) {
        JSObject result = new JSObject();
        boolean supported = isSupported(context);
        boolean enabled = isEnabled(context);
        boolean configured = hasPin(context);
        boolean accessibilityServiceEnabled = isAccessibilityServiceEnabled(context);
        boolean overlayEnabled = isOverlayPermissionEnabled(context);
        boolean deviceAdminEnabled = isDeviceAdminEnabled(context);
        boolean deviceOwnerEnabled = isDeviceOwnerEnabled(context);
        boolean antiUninstall = isAntiUninstallEnabled(context);
        boolean bruteForceProtected = getCooldownRemainingMs(context) > 0;

        result.put("supported", supported);
        result.put("enabled", enabled);
        result.put("available", supported && configured);
        result.put("configured", configured);
        result.put("locked", enabled && !sessionAuthenticated);
        result.put("accessibilityServiceEnabled", accessibilityServiceEnabled);
        result.put("overlayEnabled", overlayEnabled);
        result.put("deviceAdminEnabled", deviceAdminEnabled);
        result.put("deviceOwnerEnabled", deviceOwnerEnabled);
        result.put(
                "deviceOwnerProvisioningCommand",
                deviceOwnerProvisioningCommand(context)
        );
        result.put("antiUninstall", antiUninstall);
        result.put("bruteForceProtected", bruteForceProtected);
        String message;
        if (enabled) {
            message = accessibilityServiceEnabled && overlayEnabled
                    ? (antiUninstall && !deviceOwnerEnabled
                        ? "SafeNet App Lock is active. Provision SafeNet as Device Owner to enable anti-uninstall and system-wide controls."
                        : "SafeNet App Lock is active. Device Owner controls are available in App Lock settings.")
                    : !accessibilityServiceEnabled
                        ? "SafeNet App Lock is enabled. Enable the SafeNet Accessibility Service to monitor protected app launches."
                        : "SafeNet App Lock is enabled. Allow App Lock to display the lock screen over protected apps.";
        } else if (deviceOwnerEnabled) {
            message = "SafeNet App Lock is off. SafeNet remains Android Device Owner until you remove it in App Lock settings.";
        } else if (deviceAdminEnabled) {
            message = "SafeNet App Lock is off. SafeNet Device Administrator is still active.";
        } else {
            message = availabilityMessage(context);
        }
        result.put("message", message);
        return result;
    }

    public static void configure(
            Context context,
            String pin,
            String recoveryQuestion,
            String recoveryAnswer
    ) {
        if (!isValidPin(pin)) {
            throw new IllegalArgumentException("Passcode must contain 4 to 12 digits.");
        }
        if (TextUtils.isEmpty(recoveryQuestion) || TextUtils.isEmpty(recoveryAnswer)) {
            throw new IllegalArgumentException("A recovery question and answer are required.");
        }
        byte[] pinSalt = randomBytes();
        byte[] recoverySalt = randomBytes();
        prefs(context).edit()
                .putString(PREF_PIN_SALT, encode(pinSalt))
                .putString(PREF_PIN_HASH, encode(hash(pin, pinSalt)))
                .putString(PREF_RECOVERY_QUESTION, recoveryQuestion.trim())
                .putString(PREF_RECOVERY_SALT, encode(recoverySalt))
                .putString(PREF_RECOVERY_HASH, encode(hash(recoveryAnswer.trim(), recoverySalt)))
                .remove(PREF_FAILED_ATTEMPTS)
                .remove(PREF_COOLDOWN_UNTIL)
                .remove(PREF_COOLDOWN_LEVEL)
                .apply();
    }

    public static void resetPin(Context context, String pin) {
        if (!isValidPin(pin)) {
            throw new IllegalArgumentException("Passcode must contain 4 to 12 digits.");
        }
        byte[] pinSalt = randomBytes();
        prefs(context).edit()
                .putString(PREF_PIN_SALT, encode(pinSalt))
                .putString(PREF_PIN_HASH, encode(hash(pin, pinSalt)))
                .remove(PREF_FAILED_ATTEMPTS)
                .remove(PREF_COOLDOWN_UNTIL)
                .remove(PREF_COOLDOWN_LEVEL)
                .apply();
    }

    public static String recoveryQuestion(Context context) {
        return prefs(context).getString(
                PREF_RECOVERY_QUESTION,
                "What answer did you choose during SafeNet setup?"
        );
    }

    public static PinResult verifyPin(Context context, String pin) {
        long cooldownRemaining = getCooldownRemainingMs(context);
        if (cooldownRemaining > 0) {
            return PinResult.failure(
                    "Too many attempts. Try again in " + formatDuration(cooldownRemaining) + ".",
                    cooldownRemaining
            );
        }

        String storedHash = prefs(context).getString(PREF_PIN_HASH, null);
        String encodedSalt = prefs(context).getString(PREF_PIN_SALT, null);
        if (TextUtils.isEmpty(storedHash) || TextUtils.isEmpty(encodedSalt)) {
            return PinResult.failure("No passcode has been configured.", 0L);
        }

        boolean matches = MessageDigest.isEqual(
                decode(storedHash),
                hash(pin == null ? "" : pin, decode(encodedSalt))
        );
        if (matches) {
            prefs(context).edit()
                    .remove(PREF_FAILED_ATTEMPTS)
                    .remove(PREF_COOLDOWN_UNTIL)
                    .remove(PREF_COOLDOWN_LEVEL)
                    .apply();
            return PinResult.success();
        }

        int attempts = prefs(context).getInt(PREF_FAILED_ATTEMPTS, 0) + 1;
        android.content.SharedPreferences.Editor editor =
                prefs(context).edit().putInt(PREF_FAILED_ATTEMPTS, attempts);
        if (attempts >= 5) {
            int level = prefs(context).getInt(PREF_COOLDOWN_LEVEL, 0) + 1;
            long cooldown = Math.min(60L * 60L * 1000L, (2L * level) * 60L * 1000L);
            editor.putInt(PREF_COOLDOWN_LEVEL, level)
                    .putLong(PREF_COOLDOWN_UNTIL, System.currentTimeMillis() + cooldown);
            editor.apply();
            return PinResult.failure(
                    "Too many attempts. Try again in " + formatDuration(cooldown) + ".",
                    cooldown
            );
        }
        editor.apply();
        return PinResult.failure(
                "Incorrect passcode. Attempt " + attempts + " of 5.",
                0L
        );
    }

    public static boolean verifyRecoveryAnswer(Context context, String answer) {
        String storedHash = prefs(context).getString(PREF_RECOVERY_HASH, null);
        String encodedSalt = prefs(context).getString(PREF_RECOVERY_SALT, null);
        if (TextUtils.isEmpty(storedHash) || TextUtils.isEmpty(encodedSalt)) {
            return false;
        }
        return MessageDigest.isEqual(
                decode(storedHash),
                hash(answer == null ? "" : answer.trim(), decode(encodedSalt))
        );
    }

    public static long getCooldownRemainingMs(Context context) {
        long remaining = prefs(context).getLong(PREF_COOLDOWN_UNTIL, 0L)
                - System.currentTimeMillis();
        if (remaining <= 0L) {
            prefs(context).edit()
                    .remove(PREF_COOLDOWN_UNTIL)
                    .remove(PREF_FAILED_ATTEMPTS)
                    .apply();
            return 0L;
        }
        return remaining;
    }

    public static Intent accessibilitySettingsIntent() {
        return new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
    }

    public static Intent overlayPermissionIntent(Context context) {
        return new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + context.getPackageName())
        );
    }

    public static Intent deviceAdminIntent(Context context) {
        return new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent(context))
                .putExtra(
                        DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                        "SafeNet uses App Lock Device Administrator only to protect SafeNet from unauthorized removal."
                );
    }

    public static ComponentName adminComponent(Context context) {
        return new ComponentName(context, LockLockDeviceAdminReceiver.class);
    }

    public static String deviceOwnerProvisioningCommand(Context context) {
        return "adb shell dpm set-device-owner "
                + adminComponent(context).flattenToShortString();
    }

    public static boolean isUserRestrictionEnabled(Context context, String restriction) {
        if (!isDeviceOwnerEnabled(context) || !isSupportedUserRestriction(restriction)) {
            return false;
        }
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return manager != null
                && manager.getUserRestrictions(adminComponent(context)).getBoolean(restriction);
    }

    public static boolean isUserRestrictionManagedBySafeNet(
            Context context,
            String restriction
    ) {
        return getManagedValues(context, PREF_MANAGED_RESTRICTIONS).contains(restriction);
    }

    public static void setManagedUserRestriction(
            Context context,
            String restriction,
            boolean enabled
    ) {
        requireDeviceOwner(context);
        if (!isSupportedUserRestriction(restriction)) {
            throw new IllegalArgumentException("This Android restriction is not supported.");
        }
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (manager == null) {
            throw new IllegalStateException("Android Device Policy is unavailable.");
        }

        ComponentName admin = adminComponent(context);
        Set<String> managed = getManagedValues(context, PREF_MANAGED_RESTRICTIONS);
        boolean current = manager.getUserRestrictions(admin).getBoolean(restriction);
        if (enabled) {
            if (!current) {
                manager.addUserRestriction(admin, restriction);
                if (!manager.getUserRestrictions(admin).getBoolean(restriction)) {
                    throw new IllegalStateException("Android did not apply this restriction.");
                }
                managed.add(restriction);
                saveManagedValues(context, PREF_MANAGED_RESTRICTIONS, managed);
            }
            return;
        }

        if (managed.remove(restriction)) {
            if (current) {
                manager.clearUserRestriction(admin, restriction);
                if (manager.getUserRestrictions(admin).getBoolean(restriction)) {
                    managed.add(restriction);
                    throw new IllegalStateException(
                            "Android did not clear the SafeNet-managed restriction."
                    );
                }
            }
            saveManagedValues(context, PREF_MANAGED_RESTRICTIONS, managed);
        }
    }

    public static boolean canManagePackagePolicy(Context context, String packageName) {
        if (TextUtils.isEmpty(packageName)
                || context.getPackageName().equals(packageName)
                || !isDeviceOwnerEnabled(context)) {
            return false;
        }
        try {
            ApplicationInfo info = context.getPackageManager().getApplicationInfo(packageName, 0);
            int systemFlags = ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP;
            return (info.flags & systemFlags) == 0;
        } catch (PackageManager.NameNotFoundException error) {
            return false;
        }
    }

    public static boolean isPackageSuspended(Context context, String packageName) {
        if (!isDeviceOwnerEnabled(context) || Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return false;
        }
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return manager != null && manager.isPackageSuspended(adminComponent(context), packageName);
    }

    public static boolean isPackageHidden(Context context, String packageName) {
        if (!isDeviceOwnerEnabled(context)) {
            return false;
        }
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return manager != null && manager.isApplicationHidden(adminComponent(context), packageName);
    }

    public static boolean isPackageSuspendedManagedBySafeNet(Context context, String packageName) {
        return getManagedValues(context, PREF_MANAGED_SUSPENDED_PACKAGES).contains(packageName);
    }

    public static boolean isPackageHiddenManagedBySafeNet(Context context, String packageName) {
        return getManagedValues(context, PREF_MANAGED_HIDDEN_PACKAGES).contains(packageName);
    }

    public static void setPackageSuspendedBySafeNet(
            Context context,
            String packageName,
            boolean suspended
    ) {
        requireDeviceOwner(context);
        requireManageablePackage(context, packageName);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            throw new IllegalStateException("App suspension requires Android 7.0 or newer.");
        }
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (manager == null) {
            throw new IllegalStateException("Android Device Policy is unavailable.");
        }
        Set<String> managed = getManagedValues(context, PREF_MANAGED_SUSPENDED_PACKAGES);
        boolean current = manager.isPackageSuspended(adminComponent(context), packageName);
        if (suspended && !current) {
            String[] failed = manager.setPackagesSuspended(
                    adminComponent(context),
                    new String[]{packageName},
                    true
            );
            if (containsPackage(failed, packageName)
                    || !manager.isPackageSuspended(adminComponent(context), packageName)) {
                throw new IllegalStateException("Android could not suspend this app.");
            }
            managed.add(packageName);
            saveManagedValues(context, PREF_MANAGED_SUSPENDED_PACKAGES, managed);
        } else if (!suspended && managed.remove(packageName)) {
            if (current) {
                String[] failed = manager.setPackagesSuspended(
                        adminComponent(context),
                        new String[]{packageName},
                        false
                );
                if (containsPackage(failed, packageName)) {
                    managed.add(packageName);
                    throw new IllegalStateException("Android could not restore this app.");
                }
            }
            saveManagedValues(context, PREF_MANAGED_SUSPENDED_PACKAGES, managed);
        }
    }

    public static void setPackageHiddenBySafeNet(
            Context context,
            String packageName,
            boolean hidden
    ) {
        requireDeviceOwner(context);
        requireManageablePackage(context, packageName);
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (manager == null) {
            throw new IllegalStateException("Android Device Policy is unavailable.");
        }
        Set<String> managed = getManagedValues(context, PREF_MANAGED_HIDDEN_PACKAGES);
        boolean current = manager.isApplicationHidden(adminComponent(context), packageName);
        if (hidden && !current) {
            if (!manager.setApplicationHidden(adminComponent(context), packageName, true)) {
                throw new IllegalStateException("Android could not hide this app.");
            }
            managed.add(packageName);
            saveManagedValues(context, PREF_MANAGED_HIDDEN_PACKAGES, managed);
        } else if (!hidden && managed.remove(packageName)) {
            if (current && !manager.setApplicationHidden(adminComponent(context), packageName, false)) {
                managed.add(packageName);
                throw new IllegalStateException("Android could not restore this app.");
            }
            saveManagedValues(context, PREF_MANAGED_HIDDEN_PACKAGES, managed);
        }
    }

    public static void restoreManagedPackagePolicies(Context context) {
        requireDeviceOwner(context);
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (manager == null) {
            throw new IllegalStateException("Android Device Policy is unavailable.");
        }
        ComponentName admin = adminComponent(context);
        restoreManagedPackageSet(
                context,
                manager,
                admin,
                PREF_MANAGED_SUSPENDED_PACKAGES,
                true
        );
        restoreManagedPackageSet(
                context,
                manager,
                admin,
                PREF_MANAGED_HIDDEN_PACKAGES,
                false
        );
    }

    public static void removeDeviceOwner(Context context) {
        requireDeviceOwner(context);
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (manager == null) {
            throw new IllegalStateException("Android Device Policy is unavailable.");
        }

        restoreManagedPackagePolicies(context);
        restoreManagedUserRestrictions(context);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            manager.setUninstallBlocked(adminComponent(context), context.getPackageName(), false);
        }
        manager.clearDeviceOwnerApp(context.getPackageName());
        if (manager.isDeviceOwnerApp(context.getPackageName())) {
            throw new IllegalStateException("Android did not remove SafeNet as Device Owner.");
        }
        prefs(context).edit()
                .putBoolean(PREF_ANTI_UNINSTALL, false)
                .remove(PREF_MANAGED_SUSPENDED_PACKAGES)
                .remove(PREF_MANAGED_HIDDEN_PACKAGES)
                .remove(PREF_MANAGED_RESTRICTIONS)
                .apply();
    }

    public static boolean shouldLockPackage(Context context, String packageName) {
        return isEnabled(context)
                && getLockedPackages(context).contains(packageName)
                && !(context.getPackageName().equals(packageName) && sessionAuthenticated)
                && !OpenLockMonitorService.isUnlockTemporarilyAllowed(packageName);
    }

    public static void allowTemporaryUnlock(Context context, String packageName) {
        OpenLockMonitorService.allowTemporaryUnlock(packageName);
    }

    public static void startMonitorServiceIfReady(Context context) {
        // Accessibility services are owned and started by Android after the
        // user enables them in Settings. There is no foreground-service start
        // here, which avoids creating a second monitor instance.
    }

    public static void stopMonitorService(Context context) {
        // Android owns the Accessibility Service lifecycle. Its event handler
        // checks the persisted enabled flag before locking any package.
    }

    private static android.content.SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static boolean removeActiveDeviceAdmin(Context context) {
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (manager == null) {
            return false;
        }
        ComponentName component = adminComponent(context);
        if (!manager.isAdminActive(component)) {
            return true;
        }
        try {
            manager.removeActiveAdmin(component);
        } catch (SecurityException error) {
            return false;
        }
        return !manager.isAdminActive(component);
    }

    private static void restoreManagedUserRestrictions(Context context) {
        DevicePolicyManager manager =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (manager == null) {
            throw new IllegalStateException("Android Device Policy is unavailable.");
        }
        ComponentName admin = adminComponent(context);
        Set<String> managed = getManagedValues(context, PREF_MANAGED_RESTRICTIONS);
        for (String restriction : new HashSet<>(managed)) {
            if (manager.getUserRestrictions(admin).getBoolean(restriction)) {
                manager.clearUserRestriction(admin, restriction);
                if (manager.getUserRestrictions(admin).getBoolean(restriction)) {
                    throw new IllegalStateException(
                            "SafeNet could not restore the Android restriction " + restriction + "."
                    );
                }
            }
            managed.remove(restriction);
            saveManagedValues(context, PREF_MANAGED_RESTRICTIONS, managed);
        }
    }

    private static void restoreManagedPackageSet(
            Context context,
            DevicePolicyManager manager,
            ComponentName admin,
            String preferenceKey,
            boolean suspended
    ) {
        Set<String> managed = getManagedValues(context, preferenceKey);
        for (String packageName : new HashSet<>(managed)) {
            if (!isInstalledPackage(context, packageName)) {
                managed.remove(packageName);
                saveManagedValues(context, preferenceKey, managed);
                continue;
            }
            if (suspended) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
                        && manager.isPackageSuspended(admin, packageName)) {
                    String[] failed = manager.setPackagesSuspended(
                            admin,
                            new String[]{packageName},
                            false
                    );
                    if (containsPackage(failed, packageName)) {
                        throw new IllegalStateException(
                                "SafeNet could not restore suspended app " + packageName + "."
                        );
                    }
                    if (manager.isPackageSuspended(admin, packageName)) {
                        throw new IllegalStateException(
                                "SafeNet could not restore suspended app " + packageName + "."
                        );
                    }
                }
            } else if (manager.isApplicationHidden(admin, packageName)
                    && !manager.setApplicationHidden(admin, packageName, false)) {
                throw new IllegalStateException(
                        "SafeNet could not restore hidden app " + packageName + "."
                );
            }
            managed.remove(packageName);
            saveManagedValues(context, preferenceKey, managed);
        }
    }

    private static void requireDeviceOwner(Context context) {
        if (!isDeviceOwnerEnabled(context)) {
            throw new IllegalStateException(
                    "Provision SafeNet as Android Device Owner before changing system policies."
            );
        }
    }

    private static void requireManageablePackage(Context context, String packageName) {
        if (!canManagePackagePolicy(context, packageName)) {
            throw new IllegalArgumentException(
                    "SafeNet cannot suspend or hide itself, a system app, or an unavailable app."
            );
        }
    }

    private static boolean isSupportedUserRestriction(String restriction) {
        return UserManager.DISALLOW_SAFE_BOOT.equals(restriction)
                || UserManager.DISALLOW_DEBUGGING_FEATURES.equals(restriction)
                || UserManager.DISALLOW_FACTORY_RESET.equals(restriction)
                || UserManager.DISALLOW_OUTGOING_CALLS.equals(restriction)
                || UserManager.DISALLOW_SMS.equals(restriction)
                || UserManager.DISALLOW_ADD_USER.equals(restriction)
                || UserManager.DISALLOW_REMOVE_USER.equals(restriction)
                || UserManager.DISALLOW_MODIFY_ACCOUNTS.equals(restriction)
                || UserManager.DISALLOW_INSTALL_APPS.equals(restriction)
                || UserManager.DISALLOW_UNINSTALL_APPS.equals(restriction)
                || UserManager.DISALLOW_SET_WALLPAPER.equals(restriction)
                || UserManager.DISALLOW_USB_FILE_TRANSFER.equals(restriction)
                || UserManager.DISALLOW_CONFIG_PRIVATE_DNS.equals(restriction)
                || UserManager.DISALLOW_CONFIG_VPN.equals(restriction)
                || UserManager.DISALLOW_CONFIG_CREDENTIALS.equals(restriction);
    }

    private static Set<String> getManagedValues(Context context, String preferenceKey) {
        Set<String> values = prefs(context).getStringSet(preferenceKey, null);
        return values == null ? new HashSet<>() : new HashSet<>(values);
    }

    private static void saveManagedValues(
            Context context,
            String preferenceKey,
            Set<String> values
    ) {
        prefs(context).edit().putStringSet(preferenceKey, new HashSet<>(values)).apply();
    }

    private static boolean containsPackage(String[] packages, String packageName) {
        if (packages == null) {
            return false;
        }
        for (String failedPackage : packages) {
            if (packageName.equals(failedPackage)) {
                return true;
            }
        }
        return false;
    }

    private static boolean isInstalledPackage(Context context, String packageName) {
        try {
            context.getPackageManager().getApplicationInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException error) {
            return false;
        }
    }

    private static boolean isValidPin(String pin) {
        return pin != null && pin.matches("\\d{4,12}");
    }

    private static byte[] randomBytes() {
        byte[] value = new byte[16];
        RANDOM.nextBytes(value);
        return value;
    }

    private static byte[] hash(String value, byte[] salt) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] output = (value == null ? "" : value).getBytes(StandardCharsets.UTF_8);
            for (int round = 0; round < HASH_ROUNDS; round++) {
                digest.reset();
                digest.update(salt);
                output = digest.digest(output);
            }
            return output;
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable.", error);
        }
    }

    private static String encode(byte[] value) {
        return android.util.Base64.encodeToString(value, android.util.Base64.NO_WRAP);
    }

    private static byte[] decode(String value) {
        return android.util.Base64.decode(value, android.util.Base64.NO_WRAP);
    }

    private static String formatDuration(long milliseconds) {
        long totalSeconds = Math.max(1L, milliseconds / 1000L);
        long minutes = totalSeconds / 60L;
        long seconds = totalSeconds % 60L;
        return minutes > 0
                ? String.format("%dm %02ds", minutes, seconds)
                : String.format("%ds", seconds);
    }
}