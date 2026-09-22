package com.safenet.dns;

import android.app.AppOpsManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Process;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;

import com.getcapacitor.JSObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.HashSet;
import java.util.Set;

/**
 * Offline OpenLock-style app protection.
 *
 * OpenLock uses Usage Access plus an overlay instead of Accessibility to
 * observe protected foreground apps. SafeNet stores only salted passcode and
 * recovery hashes and never sends them anywhere.
 */
public final class AppLockManager {
    public static final String ACTION_APP_UNLOCKED = "com.safenet.dns.APP_UNLOCKED";
    public static final String EXTRA_PACKAGE_NAME = "packageName";
    public static final String EXTRA_LOCKED_PACKAGE = "locked_package";
    public static final String EXTRA_AFTER_UNLOCK_PRIVATE_DNS = "after_unlock_private_dns";
    public static final String EXTRA_MODE = "mode";
    public static final String MODE_SETUP = "setup";
    public static final String MODE_UNLOCK = "unlock";
    public static final String MODE_DISABLE = "disable";

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
    private static final int HASH_ROUNDS = 100_000;
    private static final int MAX_PIN_LENGTH = 12;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static volatile boolean sessionAuthenticated;

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
            stopMonitorService(context);
        } else {
            startMonitorServiceIfReady(context);
        }
    }

    public static void setAntiUninstallEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(PREF_ANTI_UNINSTALL, enabled).apply();
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

    public static boolean isUsageAccessEnabled(Context context) {
        AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        if (appOps == null) {
            return false;
        }
        int mode = appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.getPackageName()
        );
        return mode == AppOpsManager.MODE_ALLOWED;
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
        if (!isUsageAccessEnabled(context)) {
            return "Enable OpenLock Usage Access to monitor protected app launches.";
        }
        if (!isOverlayPermissionEnabled(context)) {
            return "Allow OpenLock to display the lock screen over protected apps.";
        }
        if (isAntiUninstallEnabled(context) && !isDeviceAdminEnabled(context)) {
            return "Enable OpenLock Device Administrator in Android Settings for anti-uninstall protection.";
        }
        return "SafeNet App Lock is ready.";
    }

    public static JSObject status(Context context) {
        JSObject result = new JSObject();
        boolean supported = isSupported(context);
        boolean enabled = isEnabled(context);
        boolean configured = hasPin(context);
        boolean usageAccessEnabled = isUsageAccessEnabled(context);
        boolean overlayEnabled = isOverlayPermissionEnabled(context);
        boolean deviceAdminEnabled = isDeviceAdminEnabled(context);
        boolean antiUninstall = isAntiUninstallEnabled(context);
        boolean bruteForceProtected = getCooldownRemainingMs(context) > 0;

        result.put("supported", supported);
        result.put("enabled", enabled);
        result.put("available", supported && configured);
        result.put("configured", configured);
        result.put("locked", enabled && !sessionAuthenticated);
        result.put("usageAccessEnabled", usageAccessEnabled);
        result.put("overlayEnabled", overlayEnabled);
        result.put("deviceAdminEnabled", deviceAdminEnabled);
        result.put("antiUninstall", antiUninstall);
        result.put("bruteForceProtected", bruteForceProtected);
        result.put("message", enabled
                ? (usageAccessEnabled && overlayEnabled
                    ? (antiUninstall && !deviceAdminEnabled
                        ? "Secure App Lock is active. Enable Device Administrator to finish anti-uninstall protection."
                        : "SafeNet App Lock is active. Passcode required when SafeNet returns.")
                    : !usageAccessEnabled
                        ? "SafeNet App Lock is enabled. Enable OpenLock Usage Access to monitor protected app launches."
                        : "SafeNet App Lock is enabled. Allow OpenLock to display the lock screen over protected apps.")
                : availabilityMessage(context));
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

    public static Intent usageAccessSettingsIntent() {
        return new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
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
                        "SafeNet uses OpenLock Device Administrator only to protect SafeNet from unauthorized removal."
                );
    }

    public static ComponentName adminComponent(Context context) {
        return new ComponentName(context, LockLockDeviceAdminReceiver.class);
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
        if (!isEnabled(context) || !hasPin(context)
                || !isUsageAccessEnabled(context) || !isOverlayPermissionEnabled(context)) {
            return;
        }
        Intent intent = new Intent(context, OpenLockMonitorService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stopMonitorService(Context context) {
        context.stopService(new Intent(context, OpenLockMonitorService.class));
    }

    private static android.content.SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
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