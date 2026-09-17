package com.safenet.dns;

import android.app.KeyguardManager;
import android.content.Context;
import android.os.Build;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;

import java.util.concurrent.Executor;

/**
 * Native app-lock state and authentication boundary.
 *
 * This intentionally protects SafeNet itself rather than using an
 * AccessibilityService or overlay to police other applications.
 */
public final class AppLockManager {
    private static final String PREFS_NAME = "safenet_app_lock";
    private static final String PREF_ENABLED = "enabled";
    private static volatile boolean promptActive;
    private static volatile boolean sessionAuthenticated;

    public interface AuthenticationCallback {
        void onSuccess();
        void onFailure(String message);
    }

    private AppLockManager() {}

    public static boolean isEnabled(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getBoolean(PREF_ENABLED, false);
    }

    public static void setEnabled(Context context, boolean enabled) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_ENABLED, enabled)
                .apply();
        if (!enabled) {
            sessionAuthenticated = false;
        }
    }

    public static boolean isPromptActive() {
        return promptActive;
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

    public static boolean isAuthenticationAvailable(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return false;
        }

        KeyguardManager keyguardManager =
                (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        boolean deviceSecure = keyguardManager != null && keyguardManager.isDeviceSecure();
        BiometricManager biometricManager = BiometricManager.from(context);
        int result = biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        return result == BiometricManager.BIOMETRIC_SUCCESS || deviceSecure;
    }

    public static String availabilityMessage(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return "AndroidX Secure App Lock requires Android 6.0 or newer.";
        }
        if (isAuthenticationAvailable(context)) {
            return "Biometric or device-credential protection is ready.";
        }
        return "Set a device PIN, pattern, password, or biometric before enabling AndroidX Secure App Lock.";
    }

    public static JSObject status(Context context) {
        JSObject result = new JSObject();
        boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M;
        boolean available = supported && isAuthenticationAvailable(context);
        boolean enabled = isEnabled(context);

        result.put("supported", supported);
        result.put("enabled", enabled);
        result.put("available", available);
        result.put("locked", enabled && !sessionAuthenticated);
        result.put("message", supported
                ? (enabled
                    ? (available
                        ? "AndroidX Secure App Lock is active. Authentication is required when SafeNet returns."
                        : "AndroidX Secure App Lock is enabled, but no device credential is currently available.")
                    : availabilityMessage(context))
                : "AndroidX Secure App Lock is available in the SafeNet Android app.");
        return result;
    }

    public static void authenticate(
            FragmentActivity activity,
            String title,
            AuthenticationCallback callback
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            callback.onFailure("AndroidX Secure App Lock requires Android 6.0 or newer.");
            return;
        }

        if (promptActive) {
            callback.onFailure("An Android authentication prompt is already open.");
            return;
        }

        if (!isAuthenticationAvailable(activity)) {
            callback.onFailure(availabilityMessage(activity));
            return;
        }

        Executor executor = ContextCompat.getMainExecutor(activity);
        promptActive = true;
        BiometricPrompt prompt = new BiometricPrompt(
                activity,
                executor,
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(
                            BiometricPrompt.AuthenticationResult result
                    ) {
                        promptActive = false;
                        callback.onSuccess();
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        promptActive = false;
                        callback.onFailure(errString == null
                                ? "SafeNet authentication was not completed."
                                : errString.toString());
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        // Keep the prompt open so Android can handle retry and lockout.
                    }
                }
        );

        BiometricPrompt.PromptInfo.Builder promptBuilder =
                new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle("SafeNet only • AndroidX Secure App Lock");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            promptBuilder.setAllowedAuthenticators(
                    BiometricManager.Authenticators.BIOMETRIC_STRONG
                            | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            );
        } else {
            promptBuilder.setDeviceCredentialAllowed(true);
        }

        prompt.authenticate(promptBuilder.build());
    }
}