package com.safenet.dns;

import android.content.Context;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Compatibility boundary between AppLock-Revived UI/lock components and
 * SafeNet's existing local App Lock state.
 *
 * The bridge deliberately leaves the existing preference keys and credential
 * hashes in place so a staged port cannot silently reset a user's passcode or
 * protected-app selection.
 */
public final class AppLockRevivedStateBridge {
    private AppLockRevivedStateBridge() {}

    public static Snapshot read(Context context) {
        return new Snapshot(
                AppLockManager.isEnabled(context),
                AppLockManager.hasPin(context),
                AppLockManager.isProtectionActive(context),
                AppLockManager.getLockedPackages(context)
        );
    }

    public static AppLockManager.PinResult verifyPasscode(Context context, String passcode) {
        return AppLockManager.verifyPin(context, passcode);
    }

    public static void configurePasscode(
            Context context,
            String passcode,
            String recoveryQuestion,
            String recoveryAnswer
    ) {
        AppLockManager.configure(context, passcode, recoveryQuestion, recoveryAnswer);
    }

    public static void resetPasscode(Context context, String passcode) {
        AppLockManager.resetPin(context, passcode);
    }

    public static void saveProtectedPackages(Context context, Set<String> packageNames) {
        AppLockManager.setLockedPackages(context, packageNames);
    }

    public static final class Snapshot {
        public final boolean enabled;
        public final boolean hasPasscode;
        public final boolean protectionReady;
        public final Set<String> protectedPackages;

        private Snapshot(
                boolean enabled,
                boolean hasPasscode,
                boolean protectionReady,
                Set<String> protectedPackages
        ) {
            this.enabled = enabled;
            this.hasPasscode = hasPasscode;
            this.protectionReady = protectionReady;
            this.protectedPackages = Collections.unmodifiableSet(
                    new HashSet<>(protectedPackages)
            );
        }
    }
}
