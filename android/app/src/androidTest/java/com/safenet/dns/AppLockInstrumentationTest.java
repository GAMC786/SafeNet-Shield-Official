package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.UiAutomation;
import android.content.ComponentName;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.getcapacitor.JSObject;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

@RunWith(AndroidJUnit4.class)
public class AppLockInstrumentationTest {
    private static final String TAG = "SafeNetLockLockTest";
    private static final String SETTINGS_PACKAGE = "com.android.settings";
    private static final String PIN = "2468";
    private static final String RESET_PIN = "1357";
    private static final long WAIT_TIMEOUT_MS = 15_000L;

    private final Context context =
            InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiAutomation automation =
            InstrumentationRegistry.getInstrumentation().getUiAutomation();
    private String originalAccessibilityServices;
    private String originalAccessibilityEnabled;

    @Before
    public void resetLockLockState() throws Exception {
        originalAccessibilityServices = secureSetting("enabled_accessibility_services");
        originalAccessibilityEnabled = secureSetting("accessibility_enabled");
        disableDeviceAdminIfPresent();
        context.getSharedPreferences("safenet_locklock", Context.MODE_PRIVATE)
                .edit()
                .clear()
                .commit();
        AppLockManager.clearSession();
    }

    @After
    public void restoreLockLockState() throws Exception {
        AppLockManager.setEnabled(context, false);
        AppLockManager.setAntiUninstallEnabled(context, false);
        AppLockManager.clearSession();
        context.getSharedPreferences("safenet_locklock", Context.MODE_PRIVATE)
                .edit()
                .clear()
                .commit();
        restoreSecureSetting(
                "enabled_accessibility_services",
                originalAccessibilityServices
        );
        restoreSecureSetting(
                "accessibility_enabled",
                originalAccessibilityEnabled
        );
        shell("am force-stop " + context.getPackageName());
        shell("am force-stop " + SETTINGS_PACKAGE);
    }

    @Test
    public void setupRecoveryCooldownResetAndDisabledAdminStatus() throws Exception {
        AppLockManager.configure(
                context,
                PIN,
                "What is the recovery answer?",
                "offline answer"
        );
        assertTrue(AppLockManager.hasPin(context));
        assertTrue(AppLockManager.verifyRecoveryAnswer(context, " offline answer "));
        assertFalse(AppLockManager.verifyRecoveryAnswer(context, "wrong answer"));
        AppLockManager.setEnabled(context, true);
        assertTrue(AppLockManager.isEnabled(context));

        for (int attempt = 0; attempt < 5; attempt++) {
            assertFalse(AppLockManager.verifyPin(context, "0000").success);
        }
        assertTrue(AppLockManager.getCooldownRemainingMs(context) > 0L);
        assertFalse(AppLockManager.verifyPin(context, PIN).success);

        AppLockManager.configure(
                context,
                RESET_PIN,
                "What is the new recovery answer?",
                "new offline answer"
        );
        assertEquals(0L, AppLockManager.getCooldownRemainingMs(context));
        assertFalse(AppLockManager.verifyRecoveryAnswer(context, "offline answer"));
        assertTrue(AppLockManager.verifyRecoveryAnswer(context, "new offline answer"));
        assertTrue(AppLockManager.verifyPin(context, RESET_PIN).success);

        AppLockManager.setAntiUninstallEnabled(context, true);
        assertFalse(AppLockManager.isDeviceAdminEnabled(context));
        JSObject status = AppLockManager.status(context);
        assertFalse(status.getBoolean("deviceAdminEnabled"));
        assertTrue(status.getString("message").contains("Device Administrator"));
        Log.i(TAG, "LOCKLOCK_LIFECYCLE result=PASS");
    }

    @Test
    public void accessibilityLocksSafeNetAndSecondPackageWithoutDuplicateActivities()
            throws Exception {
        assertNotNull(
                "The dedicated Android runner must include the Settings package.",
                context.getPackageManager().getPackageInfo(SETTINGS_PACKAGE, 0)
        );
        AppLockManager.configure(
                context,
                PIN,
                "What is the recovery answer?",
                "offline answer"
        );
        AppLockManager.setEnabled(context, true);
        Set<String> lockedPackages = new HashSet<>();
        lockedPackages.add(context.getPackageName());
        lockedPackages.add(SETTINGS_PACKAGE);
        AppLockManager.setLockedPackages(context, lockedPackages);
        AppLockManager.markAuthenticated();

        enableAccessibilityService();
        waitFor(
                "LockLock Accessibility service to become enabled",
                () -> AppLockManager.isAccessibilityEnabled(context)
        );

        launchSafeNet();
        waitForLockActivity();
        launchSettings();
        waitForLockActivity();

        for (int cycle = 0; cycle < 3; cycle++) {
            AppLockManager.markAuthenticated();
            launchSafeNet();
            waitForLockActivity();
            launchSettings();
            waitForLockActivity();
        }

        String activities = shell("dumpsys activity activities");
        assertEquals(
                "Repeated protected foreground events must keep one LockLockActivity record.\n"
                        + activities,
                1,
                countActivityRecords(activities, "com.safenet.dns/.LockLockActivity")
        );
        Log.i(TAG, "LOCKLOCK_ACCESSIBILITY result=PASS activity_records=1");
    }

    private void enableAccessibilityService() throws Exception {
        String service = new ComponentName(
                context,
                LockLockAccessibilityService.class
        ).flattenToString();
        String configured = originalAccessibilityServices;
        if (configured == null || configured.isEmpty() || "null".equals(configured)) {
            configured = service;
        } else if (!configured.contains(service)) {
            configured = configured + ":" + service;
        }
        shell("settings put secure enabled_accessibility_services " + configured);
        shell("settings put secure accessibility_enabled 1");
    }

    private void launchSafeNet() throws Exception {
        shell("am start -W -n " + context.getPackageName() + "/.MainActivity");
        SystemClock.sleep(500L);
    }

    private void launchSettings() throws Exception {
        shell("am start -W -a android.settings.SETTINGS");
        SystemClock.sleep(500L);
    }

    private void waitForLockActivity() throws Exception {
        waitFor(
                "LockLockActivity to be foreground",
                () -> shell("dumpsys activity activities")
                        .contains("com.safenet.dns/.LockLockActivity")
        );
    }

    private void waitFor(String description, Condition condition) throws Exception {
        long deadline = SystemClock.uptimeMillis() + WAIT_TIMEOUT_MS;
        while (SystemClock.uptimeMillis() < deadline) {
            if (condition.matches()) {
                return;
            }
            SystemClock.sleep(250L);
        }
        throw new AssertionError(description + " did not become true.");
    }

    private String secureSetting(String key) throws Exception {
        return shell("settings get secure " + key).trim();
    }

    private void restoreSecureSetting(String key, String value) throws Exception {
        if (value == null || value.isEmpty() || "null".equals(value)) {
            shell("settings delete secure " + key);
        } else {
            shell("settings put secure " + key + " " + value);
        }
    }

    private void disableDeviceAdminIfPresent() throws Exception {
        shell(
                "dpm remove-active-admin --user 0 "
                        + new ComponentName(
                                context,
                                LockLockDeviceAdminReceiver.class
                        ).flattenToString()
        );
    }

    private String shell(String command) throws Exception {
        ParcelFileDescriptor descriptor = automation.executeShellCommand(command);
        try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static int countActivityRecords(String text, String value) {
        int count = 0;
        for (String line : text.split("\\R")) {
            if (line.contains("ActivityRecord") && line.contains(value)) {
                count++;
            }
        }
        return count;
    }

    private interface Condition {
        boolean matches() throws Exception;
    }
}