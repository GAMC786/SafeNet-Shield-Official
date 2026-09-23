package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.app.UiAutomation;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import com.getcapacitor.JSObject;

import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TestWatcher;
import org.junit.runner.Description;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

@RunWith(AndroidJUnit4.class)
public class AppLockInstrumentationTest {
    private static final String TAG = "SafeNetOpenLockTest";
    private static final String SETTINGS_PACKAGE = "com.android.settings";
    private static final String TEST_PACKAGE_NAME = "com.safenet.dns.test";
    private static final String PIN = "2468";
    private static final String RESET_PIN = "1357";
    private static final long WAIT_TIMEOUT_MS = 15_000L;
    private static final long UI_TIMEOUT_MS = 10_000L;
    private static final String UI_FAILURE_SCREENSHOT =
            "/data/local/tmp/safenet-locklock-ui-failure.png";
    private static final String UI_FAILURE_HIERARCHY =
            "/data/local/tmp/safenet-locklock-ui-failure.xml";

    private final Context context =
            InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiAutomation automation =
            InstrumentationRegistry.getInstrumentation().getUiAutomation();
    private final UiDevice device =
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private String originalAccessibilityServices;
    private String originalAccessibilityEnabled;
    private String originalOverlayMode;

    @Rule
    public final TestWatcher uiDiagnostics = new TestWatcher() {
        @Override
        protected void failed(Throwable error, Description description) {
            captureUiDiagnostics(description.getMethodName());
        }
    };

    @Before
    public void resetOpenLockState() throws Exception {
        originalAccessibilityServices = secureSetting("enabled_accessibility_services");
        originalAccessibilityEnabled = secureSetting("accessibility_enabled");
        originalOverlayMode = appOpMode("SYSTEM_ALERT_WINDOW");
        if (!isPhysicalDeviceRun()) {
            disableOpenLockPermissions();
            disableDeviceAdminIfPresent();
        }
        context.getSharedPreferences("safenet_openlock", Context.MODE_PRIVATE)
                .edit()
                .clear()
                .commit();
        AppLockManager.clearSession();
    }

    @After
    public void restoreOpenLockState() throws Exception {
        AppLockManager.setEnabled(context, false);
        AppLockManager.setAntiUninstallEnabled(context, false);
        AppLockManager.clearSession();
        context.getSharedPreferences("safenet_openlock", Context.MODE_PRIVATE)
                .edit()
                .clear()
                .commit();
        if (!isPhysicalDeviceRun()) {
            restoreSecureSetting("enabled_accessibility_services", originalAccessibilityServices);
            restoreSecureSetting("accessibility_enabled", originalAccessibilityEnabled);
            restoreAppOp("SYSTEM_ALERT_WINDOW", originalOverlayMode);
        }
        shell("am force-stop " + context.getPackageName());
        shell("am force-stop " + SETTINGS_PACKAGE);
    }

    @Test
    public void openLockActivityDrivesSetupRecoveryAndDisableUi() throws Exception {
        Activity setupActivity = launchLockLock(AppLockManager.MODE_SETUP);
        List<UiObject2> setupFields = waitForFields(4);
        fill(setupFields.get(0), PIN);
        fill(setupFields.get(1), "0000");
        scrollToText("Save passcode and enable App Lock").click();
        assertVisibleText("The passcodes do not match.");

        scrollToTop();
        fill(setupFields.get(1), PIN);
        scrollToText("Save passcode and enable App Lock").click();
        assertVisibleText("A recovery question and answer are required.");

        scrollToTop();
        fill(setupFields.get(2), "What is the recovery answer?");
        fill(setupFields.get(3), "offline answer");
        scrollToText("Save passcode and enable App Lock").click();
        assertVisibleText(
                "Passcode saved. Enable the SafeNet Accessibility Service to monitor protected app launches."
        );
        assertTrue("Setup must enable OpenLock protection.", AppLockManager.isEnabled(context));

        scrollToText("Open Accessibility Settings").click();
        waitForPackage(SETTINGS_PACKAGE);
        device.pressBack();
        assertVisibleText("Open Accessibility Settings");
        scrollToText("Open Device Administrator Settings").click();
        waitForPackage(SETTINGS_PACKAGE);
        device.pressBack();
        assertVisibleText("Open Device Administrator Settings");
        finishActivity(setupActivity);

        Activity unlockActivity = launchLockLock(AppLockManager.MODE_UNLOCK);
        scrollToText("Forgot passcode").click();
        assertVisibleText("Recover your passcode");
        assertVisibleText("What is the recovery answer?");

        List<UiObject2> recoveryFields = waitForFields(3);
        fill(recoveryFields.get(0), "wrong answer");
        fill(recoveryFields.get(1), RESET_PIN);
        fill(recoveryFields.get(2), RESET_PIN);
        scrollToText("Reset passcode").click();
        assertVisibleText("Recovery answer is incorrect.");

        scrollToTop();
        fill(recoveryFields.get(0), "offline answer");
        scrollToText("Reset passcode").click();
        assertVisibleText("Passcode reset successfully.");
        assertTrue("The reset PIN must be accepted after the visible success state.",
                AppLockManager.verifyPin(context, RESET_PIN).success);
        finishActivity(unlockActivity);

        Activity disableActivity = launchLockLock(AppLockManager.MODE_DISABLE);
        List<UiObject2> disableFields = waitForFields(1);
        fill(disableFields.get(0), RESET_PIN);
        scrollToText("Disable protection").click();
        assertVisibleText("App Lock protection disabled.");
        waitForActivityToFinish(disableActivity);
        assertFalse("Disable flow must turn off OpenLock protection.",
                AppLockManager.isEnabled(context));
        Log.i(
                TAG,
                "LOCKLOCK_UI result=PASS setup=PASS recovery_incorrect=PASS " +
                        "recovery_reset=PASS disable=PASS"
        );
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
    public void accessibilityServiceLocksSafeNetAndSecondPackageWithoutDuplicateActivities()
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

        enableOpenLockPermissions();
        waitFor(
                "App Lock Accessibility Service and overlay permissions to become enabled",
                () -> AppLockManager.isAccessibilityServiceEnabled(context)
                        && AppLockManager.isOverlayPermissionEnabled(context)
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
        Log.i(TAG, "OPENLOCK_ACCESSIBILITY result=PASS activity_records=1");
    }

    @Test
    public void physicalDeviceLocksSelectedThirdPartyAppWithoutDuplicateActivities()
            throws Exception {
        assertTrue(
                "The physical-device test must be invoked with physical_device=true.",
                isPhysicalDeviceRun()
        );

        String targetPackage = resolvePhysicalTargetPackage();
        ApplicationInfo targetInfo = context.getPackageManager()
                .getApplicationInfo(targetPackage, PackageManager.GET_META_DATA);
        assertFalse(
                "The selected LockLock target must be a third-party app: " + targetPackage,
                (targetInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0
        );
        Intent launchIntent = context.getPackageManager()
                .getLaunchIntentForPackage(targetPackage);
        assertNotNull(
                "The selected third-party app must have a launcher activity: " + targetPackage,
                launchIntent
        );
        ComponentName launchComponent = launchIntent.getComponent();
        assertNotNull("The selected app launcher component must be resolvable.", launchComponent);

        AppLockManager.configure(
                context,
                PIN,
                "What is the recovery answer?",
                "offline answer"
        );
        AppLockManager.setAntiUninstallEnabled(context, true);
        Set<String> lockedPackages = new HashSet<>();
        lockedPackages.add(context.getPackageName());
        lockedPackages.add(targetPackage);
        AppLockManager.setLockedPackages(context, lockedPackages);
        AppLockManager.setEnabled(context, true);
        AppLockManager.clearSession();

        boolean accessibilityEnabled = AppLockManager.isAccessibilityServiceEnabled(context);
        boolean overlayEnabled = AppLockManager.isOverlayPermissionEnabled(context);
        boolean deviceAdminEnabled = AppLockManager.isDeviceAdminEnabled(context);
        assertTrue(
                "Enable the SafeNet Accessibility Service before this physical check.",
                accessibilityEnabled
        );
        assertTrue(
                "Enable LockLock Device Administrator in Android Settings before this physical check.",
                deviceAdminEnabled
        );
        Log.i(
                TAG,
                "OPENLOCK_PHYSICAL_PERMISSIONS result=PASS accessibility=" +
                        accessibilityEnabled + " overlay=" + overlayEnabled +
                        " device_admin=" + deviceAdminEnabled +
                        " device_model=" + deviceModel() + " target_package=" + targetPackage
        );

        for (int cycle = 0; cycle < 3; cycle++) {
            AppLockManager.clearSession();
            shell("am force-stop " + targetPackage);
            shell("am start -W -n " + launchComponent.flattenToShortString());
            waitForLockActivity();
            waitForButton("Use passcode fallback");
            Log.i(
                    TAG,
                    "LOCKLOCK_PHYSICAL_APP cycle=" + (cycle + 1) +
                            " target_package=" + targetPackage + " result=PASS"
            );
        }

        String activities = shell("dumpsys activity activities");
        assertEquals(
                "Repeated physical-app foreground events must keep one LockLockActivity record.\n"
                        + activities,
                1,
                countActivityRecords(activities, "com.safenet.dns/.LockLockActivity")
        );

        AppLockManager.clearSession();
        unlockCurrentLockScreen(PIN);
        waitFor(
                "the selected app to resume after entering the App Lock passcode fallback",
                () -> isForegroundPackage(targetPackage)
        );
        assertFalse(
                "The LockLock screen must finish after the selected app is unlocked.",
                isLockActivityForeground()
        );
        Log.i(
                TAG,
                "LOCKLOCK_PHYSICAL_RETURN result=PASS target_package=" + targetPackage +
                        " resumed_package=" + targetPackage +
                        " temporary_unlock_target=true"
        );

        launchSafeNet();
        waitForLockActivity();
        waitForButton("Use passcode fallback");
        assertTrue(
                "Launching unrelated protected SafeNet must show LockLock after the selected "
                        + "app was temporarily unlocked.",
                isLockActivityForeground()
        );
        Log.i(
                TAG,
                "LOCKLOCK_PHYSICAL_OTHER_APP result=PASS protected_package=" +
                        context.getPackageName() + " temporary_unlock_isolated=true"
        );

        Log.i(
                TAG,
                "LOCKLOCK_PHYSICAL result=PASS device_model=" + deviceModel() +
                        " target_package=" + targetPackage +
                        " accessibility=true overlay=true device_admin=true activity_records=1" +
                        " selected_app_resumed=true temporary_unlock_isolated=true"
        );
    }

    private Activity launchLockLock(String mode) throws Exception {
        Intent intent = new Intent(context, LockLockActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK)
                .putExtra(AppLockManager.EXTRA_MODE, mode)
                .putExtra(AppLockManager.EXTRA_LOCKED_PACKAGE, context.getPackageName());
        Activity activity = InstrumentationRegistry.getInstrumentation().startActivitySync(intent);
        waitForButton(AppLockManager.MODE_SETUP.equals(mode)
                ? "Save passcode and enable App Lock"
                : AppLockManager.MODE_DISABLE.equals(mode)
                    ? "Disable with passcode"
                    : "Use passcode fallback");
        assertVisibleText(
                AppLockManager.MODE_DISABLE.equals(mode)
                        ? "Disable SafeNet App Lock"
                        : "SafeNet App Lock"
        );
        return activity;
    }

    private List<UiObject2> waitForFields(int minimum) throws Exception {
        long deadline = SystemClock.uptimeMillis() + UI_TIMEOUT_MS;
        List<UiObject2> fields;
        do {
            fields = device.findObjects(By.clazz("android.widget.EditText"));
            if (fields.size() >= minimum) {
                return fields;
            }
            SystemClock.sleep(100L);
        } while (SystemClock.uptimeMillis() < deadline);
        throw new AssertionError(
                "Expected at least " + minimum + " LockLock fields, found " + fields.size()
        );
    }

    private void fill(UiObject2 field, String value) {
        field.setText(value);
    }

    private UiObject2 waitForButton(String text) throws Exception {
        Pattern pattern = Pattern.compile("^" + Pattern.quote(text) + "$", Pattern.CASE_INSENSITIVE);
        UiObject2 button = device.wait(
                Until.findObject(By.text(pattern)),
                UI_TIMEOUT_MS
        );
        if (button == null) {
            throw new AssertionError("LockLock button did not appear: " + text);
        }
        return button;
    }

    private boolean isPhysicalDeviceRun() {
        return "true".equalsIgnoreCase(instrumentationArgument("physical_device"));
    }

    private String resolvePhysicalTargetPackage() throws Exception {
        String configured = instrumentationArgument("target_package");
        if (configured != null && !configured.isEmpty()) {
            assertFalse(
                    "The selected physical app cannot be SafeNet or the instrumentation package.",
                    context.getPackageName().equals(configured)
                            || TEST_PACKAGE_NAME.equals(configured)
                            || SETTINGS_PACKAGE.equals(configured)
            );
            return configured;
        }

        List<String> candidates = new ArrayList<>();
        PackageManager packageManager = context.getPackageManager();
        for (ApplicationInfo applicationInfo :
                packageManager.getInstalledApplications(PackageManager.GET_META_DATA)) {
            if (context.getPackageName().equals(applicationInfo.packageName)
                    || TEST_PACKAGE_NAME.equals(applicationInfo.packageName)
                    || SETTINGS_PACKAGE.equals(applicationInfo.packageName)
                    || (applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0
                    || packageManager.getLaunchIntentForPackage(applicationInfo.packageName) == null) {
                continue;
            }
            candidates.add(applicationInfo.packageName);
        }
        Collections.sort(candidates);
        assertFalse(
                "The physical phone must have an installed third-party launcher app, or pass "
                        + "-e target_package PACKAGE.",
                candidates.isEmpty()
        );
        return candidates.get(0);
    }

    private String instrumentationArgument(String key) {
        Bundle arguments = InstrumentationRegistry.getArguments();
        return arguments == null ? null : arguments.getString(key);
    }

    private String deviceModel() {
        return (Build.MANUFACTURER + "_" + Build.MODEL + "_android_" + Build.VERSION.RELEASE)
                .replaceAll("[^A-Za-z0-9_.-]", "_");
    }

    private UiObject2 assertVisibleText(String text) throws Exception {
        UiObject2 object = scrollToText(text);
        assertNotNull("Expected visible LockLock text: " + text, object);
        return object;
    }

    private UiObject2 scrollToText(String text) throws Exception {
        Pattern pattern = Pattern.compile("^" + Pattern.quote(text) + "$", Pattern.CASE_INSENSITIVE);
        long deadline = SystemClock.uptimeMillis() + UI_TIMEOUT_MS;
        while (SystemClock.uptimeMillis() < deadline) {
            UiObject2 object = device.findObject(By.text(pattern));
            if (object != null && !object.getVisibleBounds().isEmpty()) {
                return object;
            }
            device.swipe(
                    device.getDisplayWidth() / 2,
                    (int) (device.getDisplayHeight() * 0.78),
                    device.getDisplayWidth() / 2,
                    (int) (device.getDisplayHeight() * 0.28),
                    12
            );
            SystemClock.sleep(100L);
        }
        throw new AssertionError("LockLock text did not become visible: " + text);
    }

    private void scrollToTop() {
        for (int attempt = 0; attempt < 8; attempt++) {
            device.swipe(
                    device.getDisplayWidth() / 2,
                    (int) (device.getDisplayHeight() * 0.25),
                    device.getDisplayWidth() / 2,
                    (int) (device.getDisplayHeight() * 0.82),
                    12
            );
            SystemClock.sleep(75L);
        }
    }

    private void waitForPackage(String packageName) throws Exception {
        waitFor(
                packageName + " to become foreground",
                () -> packageName.equals(device.getCurrentPackageName())
        );
    }

    private void finishActivity(Activity activity) throws Exception {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
        waitForActivityToFinish(activity);
    }

    private void waitForActivityToFinish(Activity activity) throws Exception {
        waitFor("LockLock activity to finish", activity::isFinishing);
    }

    private void disableOpenLockPermissions() throws Exception {
        shell("appops set " + context.getPackageName() + " SYSTEM_ALERT_WINDOW deny");
        disableAccessibilityService();
    }

    private void captureUiDiagnostics(String methodName) {
        try {
            shell("rm -f " + UI_FAILURE_SCREENSHOT + " " + UI_FAILURE_HIERARCHY);
            shell("screencap -p " + UI_FAILURE_SCREENSHOT);
            shell("uiautomator dump --compressed " + UI_FAILURE_HIERARCHY);
            Log.e(
                    TAG,
                    "LOCKLOCK_UI_DIAGNOSTICS method=" + methodName +
                            " screenshot=" + UI_FAILURE_SCREENSHOT +
                            " hierarchy=" + UI_FAILURE_HIERARCHY
            );
        } catch (Exception diagnosticError) {
            Log.e(TAG, "LOCKLOCK_UI_DIAGNOSTICS capture_failed", diagnosticError);
        }
    }

    private void enableOpenLockPermissions() throws Exception {
        shell("appops set " + context.getPackageName() + " SYSTEM_ALERT_WINDOW allow");
        enableAccessibilityService();
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

    private void unlockCurrentLockScreen(String pin) throws Exception {
        List<UiObject2> fields = waitForFields(1);
        fill(fields.get(0), pin);
        waitForButton("Use passcode fallback").click();
        waitFor(
                "LockLockActivity to finish after a valid passcode",
                () -> !shell("dumpsys activity activities")
                        .contains("com.safenet.dns/.LockLockActivity")
        );
    }

    private boolean isForegroundPackage(String packageName) throws Exception {
        String activities = shell("dumpsys activity activities");
        for (String line : activities.split("\\R")) {
            if ((line.contains("mResumedActivity")
                    || line.contains("mCurrentFocus")
                    || line.contains("mFocusedApp"))
                    && line.contains(packageName)) {
                return true;
            }
        }
        return false;
    }

    private boolean isLockActivityForeground() throws Exception {
        String activities = shell("dumpsys activity activities");
        for (String line : activities.split("\\R")) {
            if ((line.contains("mResumedActivity")
                    || line.contains("mCurrentFocus")
                    || line.contains("mFocusedApp"))
                    && line.contains("com.safenet.dns/.LockLockActivity")) {
                return true;
            }
        }
        return false;
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

    private String appOpMode(String operation) throws Exception {
        return shell("appops get " + context.getPackageName() + " " + operation).trim();
    }

    private String secureSetting(String key) throws Exception {
        return shell("settings get secure " + key).trim();
    }

    private void enableAccessibilityService() throws Exception {
        String component = context.getPackageName() + "/" + OpenLockMonitorService.class.getName();
        shell("settings put secure enabled_accessibility_services " + component);
        shell("settings put secure accessibility_enabled 1");
    }

    private void disableAccessibilityService() throws Exception {
        shell("settings put secure enabled_accessibility_services null");
        shell("settings put secure accessibility_enabled 0");
    }

    private void restoreSecureSetting(String key, String value) throws Exception {
        if (value == null || value.isEmpty() || "null".equals(value)) {
            shell("settings delete secure " + key);
        } else {
            shell("settings put secure " + key + " " + value);
        }
    }

    private void restoreAppOp(String operation, String value) throws Exception {
        String mode = value != null && value.contains("allow") ? "allow" : "deny";
        shell("appops set " + context.getPackageName() + " " + operation + " " + mode);
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