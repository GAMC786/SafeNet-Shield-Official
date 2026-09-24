package com.safenet.dns;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;

import java.util.Locale;

/**
 * SafeNet's small, optional one-tap controller for Android Private DNS.
 *
 * Android protects these Global settings from ordinary applications. A user
 * may explicitly grant WRITE_SECURE_SETTINGS through ADB or Shizuku; without
 * that grant callers must keep using Android's Private DNS settings screen.
 */
public final class SafeNetPrivateDnsController {
    private static final String PRIVATE_DNS_MODE = "private_dns_mode";
    private static final String PRIVATE_DNS_SPECIFIER = "private_dns_specifier";

    public enum ApplyResult {
        APPLIED,
        UNSUPPORTED,
        INVALID_HOSTNAME,
        PERMISSION_REQUIRED,
        WRITE_FAILED,
        VERIFICATION_FAILED
    }

    private SafeNetPrivateDnsController() {}

    public static boolean canWrite(Context context) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            && context.checkSelfPermission(android.Manifest.permission.WRITE_SECURE_SETTINGS)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    public static ApplyResult apply(Context context, String hostname) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return ApplyResult.UNSUPPORTED;
        }
        String normalized = normalizeHostname(hostname);
        if (normalized == null) {
            return ApplyResult.INVALID_HOSTNAME;
        }
        if (!canWrite(context)) {
            return ApplyResult.PERMISSION_REQUIRED;
        }

        try {
            boolean specifierWritten = Settings.Global.putString(
                context.getContentResolver(),
                PRIVATE_DNS_SPECIFIER,
                normalized
            );
            boolean modeWritten = Settings.Global.putString(
                context.getContentResolver(),
                PRIVATE_DNS_MODE,
                "hostname"
            );
            if (!specifierWritten || !modeWritten) {
                return ApplyResult.WRITE_FAILED;
            }
        } catch (SecurityException error) {
            return ApplyResult.PERMISSION_REQUIRED;
        } catch (RuntimeException error) {
            return ApplyResult.WRITE_FAILED;
        }

        try {
            String activeMode = Settings.Global.getString(
                context.getContentResolver(),
                PRIVATE_DNS_MODE
            );
            String activeHostname = Settings.Global.getString(
                context.getContentResolver(),
                PRIVATE_DNS_SPECIFIER
            );
            return "hostname".equals(activeMode)
                && normalized.equals(normalizeHostname(activeHostname))
                ? ApplyResult.APPLIED
                : ApplyResult.VERIFICATION_FAILED;
        } catch (SecurityException error) {
            return ApplyResult.VERIFICATION_FAILED;
        }
    }

    public static String normalizeHostname(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim().toLowerCase(Locale.US);
        while (normalized.endsWith(".")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (normalized.isEmpty() || normalized.contains("/") || normalized.contains(" ")) {
            return null;
        }
        if (normalized.matches("[^:]+:\\d{1,5}")) {
            normalized = normalized.substring(0, normalized.lastIndexOf(':'));
        }
        if (normalized.contains(":") || !normalized.matches("[a-z0-9.-]+")) {
            return null;
        }
        return normalized;
    }
}