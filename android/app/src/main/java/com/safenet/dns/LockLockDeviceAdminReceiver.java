package com.safenet.dns;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

/**
 * OpenLock anti-uninstall administration boundary.
 *
 * The user must explicitly activate this receiver from Android Settings.
 * Device Admin does not grant SafeNet access to credentials or other apps.
 */
public final class LockLockDeviceAdminReceiver extends DeviceAdminReceiver {
    @Override
    public CharSequence onDisableRequested(Context context, Intent intent) {
        return "Disabling OpenLock Device Administrator removes SafeNet anti-uninstall protection.";
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        AppLockManager.setAntiUninstallEnabled(context, false);
        Toast.makeText(
                context,
                "SafeNet anti-uninstall protection is disabled.",
                Toast.LENGTH_SHORT
        ).show();
    }
}