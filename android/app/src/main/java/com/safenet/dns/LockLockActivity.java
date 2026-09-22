package com.safenet.dns;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import android.content.pm.ApplicationInfo;
import android.content.pm.ResolveInfo;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executor;

/**
 * Native App Lock authentication surface.
 *
 * The screen is intentionally native and opaque while the WebView or another
 * protected launch is blocked. BiometricPrompt is primary; passcodes and
 * recovery answers stay local as a fallback.
 */
public final class LockLockActivity extends FragmentActivity {
    private static final int RESULT_LOCKLOCK_SUCCESS = Activity.RESULT_OK;
    private static final int PADDING_DP = 24;
    private String mode;
    private String lockedPackage;
    private LinearLayout content;
    private TextView statusView;
    private boolean setupSaved;
    private CheckBox antiUninstallCheck;
    private LinearLayout appList;
    private BiometricPrompt biometricPrompt;
    private boolean biometricPromptActive;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(SafeNetLockBrand.BACKGROUND);
        window.setNavigationBarColor(SafeNetLockBrand.BACKGROUND);
        mode = getIntent().getStringExtra(AppLockManager.EXTRA_MODE);
        lockedPackage = getIntent().getStringExtra(AppLockManager.EXTRA_LOCKED_PACKAGE);
        if (mode == null) {
            mode = AppLockManager.MODE_UNLOCK;
        }

        if (AppLockManager.MODE_SETUP.equals(mode)) {
            showSetup();
        } else {
            showUnlock();
            content.post(this::launchBiometricPrompt);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (setupSaved) {
            updateSetupStatus();
        }
    }

    private void showSetup() {
        content = baseContent(
                "SafeNet App Lock",
                "Create an offline passcode fallback for SafeNet. Android BiometricPrompt will be used first when available."
        );

        EditText pin = field("New passcode", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        EditText confirm = field("Confirm passcode", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        EditText question = field("Recovery question", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        EditText answer = field("Recovery answer", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        antiUninstallCheck = new CheckBox(this);
        antiUninstallCheck.setText("Enable anti-uninstall protection");
        SafeNetLockBrand.styleCheckBox(antiUninstallCheck);
        antiUninstallCheck.setChecked(true);
        content.addView(antiUninstallCheck, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 52, 8));

        TextView protectedAppsLabel = SafeNetLockBrand.eyebrow(this, "PROTECTED APPS");
        content.addView(protectedAppsLabel, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 14));
        TextView protectedAppsHelp = bodyText(
                "SafeNet is always protected. Select other launchable apps that should use the same Android authentication and local fallback."
        );
        content.addView(protectedAppsHelp, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 4));
        appList = new LinearLayout(this);
        appList.setOrientation(LinearLayout.VERTICAL);
        appList.setPadding(dp(10), dp(4), dp(10), dp(4));
        appList.setBackground(SafeNetLockBrand.roundedBackground(
                SafeNetLockBrand.SURFACE,
                SafeNetLockBrand.BORDER,
                10,
                this
        ));
        content.addView(appList, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 6));
        loadProtectedApps();

        Button save = primaryButton("Save passcode and enable App Lock");
        content.addView(save, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 52, 16));
        statusView = bodyText("");
        content.addView(statusView, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 8));

        Button usageAccess = secondaryButton("Open Usage Access Settings");
        usageAccess.setOnClickListener(view -> startActivity(AppLockManager.usageAccessSettingsIntent()));
        content.addView(usageAccess, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 48, 8));

        Button overlay = secondaryButton("Allow App Lock Overlay");
        overlay.setOnClickListener(view -> startActivity(AppLockManager.overlayPermissionIntent(this)));
        content.addView(overlay, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 48, 8));

        Button deviceAdmin = secondaryButton("Open Device Administrator Settings");
        deviceAdmin.setOnClickListener(view -> startActivity(AppLockManager.deviceAdminIntent(this)));
        content.addView(deviceAdmin, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 48, 8));

        save.setOnClickListener(view -> {
            String pinValue = pin.getText().toString();
            String confirmValue = confirm.getText().toString();
            if (!pinValue.equals(confirmValue)) {
                showStatus("The passcodes do not match.");
                return;
            }
            try {
                AppLockManager.configure(
                        this,
                        pinValue,
                        question.getText().toString(),
                        answer.getText().toString()
                );
                AppLockManager.setAntiUninstallEnabled(
                        this,
                        antiUninstallCheck.isChecked()
                );
                AppLockManager.setLockedPackages(this, selectedPackages());
                AppLockManager.setEnabled(this, true);
                AppLockManager.clearSession();
                setupSaved = true;
                updateSetupStatus();
            } catch (IllegalArgumentException error) {
                showStatus(error.getMessage());
            }
        });
        setContentView(scrollRoot(content));
    }

    private void loadProtectedApps() {
        if (appList == null) {
            return;
        }
        Set<String> selected = AppLockManager.getLockedPackages(this);
        List<ResolveInfo> launchableApps = new ArrayList<>();
        Intent launcherIntent = new Intent(Intent.ACTION_MAIN);
        launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        try {
            launchableApps.addAll(getPackageManager().queryIntentActivities(launcherIntent, 0));
        } catch (RuntimeException error) {
            showStatus("Installed app list is unavailable. SafeNet remains protected.");
            return;
        }
        Set<String> addedPackages = new HashSet<>();
        for (ResolveInfo resolveInfo : launchableApps) {
            ApplicationInfo applicationInfo = resolveInfo.activityInfo == null
                    ? null
                    : resolveInfo.activityInfo.applicationInfo;
            if (applicationInfo == null || !addedPackages.add(applicationInfo.packageName)) {
                continue;
            }
            CheckBox appCheck = new CheckBox(this);
            appCheck.setText(applicationInfo.loadLabel(getPackageManager()));
            SafeNetLockBrand.styleCheckBox(appCheck);
            appCheck.setTag(applicationInfo.packageName);
            appCheck.setChecked(selected.contains(applicationInfo.packageName));
            appList.addView(appCheck, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 44, 0));
        }
    }

    private Set<String> selectedPackages() {
        HashSet<String> selected = new HashSet<>();
        if (appList == null) {
            selected.add(getPackageName());
            return selected;
        }
        for (int index = 0; index < appList.getChildCount(); index++) {
            View child = appList.getChildAt(index);
            if (child instanceof CheckBox && ((CheckBox) child).isChecked()) {
                Object tag = child.getTag();
                if (tag instanceof String) {
                    selected.add((String) tag);
                }
            }
        }
        selected.add(getPackageName());
        return selected;
    }

    private void updateSetupStatus() {
        boolean usageAccessEnabled = AppLockManager.isUsageAccessEnabled(this);
        boolean overlayEnabled = AppLockManager.isOverlayPermissionEnabled(this);
        boolean adminNeeded = AppLockManager.isAntiUninstallEnabled(this);
        boolean adminEnabled = AppLockManager.isDeviceAdminEnabled(this);
        if (!usageAccessEnabled) {
            showStatus("Passcode saved. Enable App Lock Usage Access to monitor SafeNet launches.");
            return;
        }
        if (!overlayEnabled) {
            showStatus("Usage Access is enabled. Allow App Lock to display the lock screen over protected apps.");
            return;
        }
        if (adminNeeded && !adminEnabled) {
            showStatus("App Lock permissions are enabled. Activate Device Administrator to protect SafeNet from removal.");
            return;
        }
        AppLockManager.startMonitorServiceIfReady(this);
        finishSuccess();
    }

    private void showUnlock() {
        String title = AppLockManager.MODE_DISABLE.equals(mode)
                ? "Disable SafeNet App Lock"
                : "SafeNet App Lock";
        String description = AppLockManager.MODE_DISABLE.equals(mode)
                ? "Authenticate with Android BiometricPrompt or the offline passcode fallback to disable SafeNet protection."
                : "Android BiometricPrompt will authenticate you first. Use the offline passcode fallback if needed.";
        content = baseContent(title, description);
        Button biometric = primaryButton("Use Android biometric");
        content.addView(biometric, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 52, 16));
        EditText pin = field("Fallback passcode", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        Button unlock = secondaryButton(
                AppLockManager.MODE_DISABLE.equals(mode) ? "Disable with passcode" : "Use passcode fallback"
        );
        content.addView(unlock, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 48, 8));
        statusView = statusText();
        content.addView(statusView, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 8));
        Button forgot = secondaryButton("Forgot passcode");
        forgot.setOnClickListener(view -> showRecovery());
        content.addView(forgot, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 48, 8));

        biometric.setOnClickListener(view -> launchBiometricPrompt());
        unlock.setOnClickListener(view -> {
            AppLockManager.PinResult result =
                    AppLockManager.verifyPin(this, pin.getText().toString());
            if (!result.success) {
                showStatus(result.message);
                pin.setText("");
                return;
            }
            completeAuthentication();
        });
        setContentView(scrollRoot(content));
    }

    private void launchBiometricPrompt() {
        if (biometricPromptActive) {
            return;
        }
        if (!AppLockManager.isBiometricAvailable(this)) {
            showStatus(AppLockManager.biometricAvailabilityMessage(this)
                    + " Use the passcode fallback below.");
            return;
        }

        Executor executor = ContextCompat.getMainExecutor(this);
        biometricPromptActive = true;
        biometricPrompt = new BiometricPrompt(
                this,
                executor,
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(
                            BiometricPrompt.AuthenticationResult result
                    ) {
                        biometricPromptActive = false;
                        completeAuthentication();
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        showStatus("Android biometric not recognized. Try again or use the passcode fallback.");
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        biometricPromptActive = false;
                        showStatus("Android authentication ended. "
                                + "Use the passcode fallback if you cannot authenticate.");
                    }
                }
        );
        biometricPrompt.authenticate(
                new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(
                                AppLockManager.MODE_DISABLE.equals(mode)
                                        ? "Disable SafeNet App Lock"
                                        : "Unlock SafeNet App Lock"
                        )
                        .setSubtitle("Android BiometricPrompt")
                        .setDescription("Use your enrolled biometric or Android device credential.")
                        .setAllowedAuthenticators(AppLockManager.biometricAuthenticators())
                        .build()
        );
    }

    private void completeAuthentication() {
        if (AppLockManager.MODE_DISABLE.equals(mode)) {
            AppLockManager.setEnabled(this, false);
            boolean adminRemoved = AppLockManager.disableAntiUninstall(this);
            Toast.makeText(
                    this,
                    adminRemoved
                            ? "App Lock protection disabled."
                            : "App Lock disabled. Deactivate SafeNet Device Administrator in Android Settings.",
                    Toast.LENGTH_LONG
            ).show();
        } else if ("enable".equals(mode)) {
            AppLockManager.setEnabled(this, true);
            AppLockManager.markAuthenticated();
        } else {
            AppLockManager.markAuthenticated();
            AppLockManager.allowTemporaryUnlock(this, lockedPackage);
        }
        if (getIntent().getBooleanExtra(AppLockManager.EXTRA_AFTER_UNLOCK_PRIVATE_DNS, false)) {
            try {
                startActivity(new Intent("android.settings.PRIVATE_DNS_SETTINGS"));
            } catch (RuntimeException ignored) {
                // The tile's settings fallback is handled by the system.
            }
        }
        finishSuccess();
    }

    private void showRecovery() {
        content.removeAllViews();
        addHeading(content, "Recover your passcode", "Answer your offline recovery question and choose a new passcode.");
        TextView question = bodyText(AppLockManager.recoveryQuestion(this));
        question.setTypeface(SafeNetLockBrand.displayTypeface(), Typeface.BOLD);
        content.addView(question, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 16));
        EditText answer = field("Recovery answer", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        EditText pin = field("New passcode", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        EditText confirm = field("Confirm new passcode", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        Button reset = primaryButton("Reset passcode");
        content.addView(reset, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 52, 16));
        statusView = statusText();
        content.addView(statusView, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 8));
        Button back = secondaryButton("Back to passcode");
        back.setOnClickListener(view -> showUnlock());
        content.addView(back, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 48, 8));
        reset.setOnClickListener(view -> {
            if (!AppLockManager.verifyRecoveryAnswer(this, answer.getText().toString())) {
                showStatus("Recovery answer is incorrect.");
                answer.setText("");
                return;
            }
            if (!pin.getText().toString().equals(confirm.getText().toString())) {
                showStatus("The new passcodes do not match.");
                return;
            }
            try {
                AppLockManager.configure(
                        this,
                        pin.getText().toString(),
                        AppLockManager.recoveryQuestion(this),
                        answer.getText().toString()
                );
                AppLockManager.setEnabled(this, true);
                AppLockManager.markAuthenticated();
                AppLockManager.allowTemporaryUnlock(this, lockedPackage);
                Toast.makeText(this, "Passcode reset successfully.", Toast.LENGTH_SHORT).show();
                finishSuccess();
            } catch (IllegalArgumentException error) {
                showStatus(error.getMessage());
            }
        });
    }

    private LinearLayout baseContent(String title, String description) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(
                dp(PADDING_DP),
                dp(24),
                dp(PADDING_DP),
                dp(28)
        );
        addHeading(root, title, description);
        return root;
    }

    private void addHeading(LinearLayout root, String title, String description) {
        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.setPadding(dp(14), dp(14), dp(14), dp(14));
        heading.setBackground(SafeNetLockBrand.roundedBackground(
                SafeNetLockBrand.SURFACE,
                Color.rgb(37, 99, 235),
                14,
                this
        ));

        heading.addView(
                SafeNetLockBrand.shieldBadge(this, 56),
                new LinearLayout.LayoutParams(dp(56), dp(56))
        );

        LinearLayout headingText = new LinearLayout(this);
        headingText.setOrientation(LinearLayout.VERTICAL);
        headingText.setPadding(dp(14), 0, 0, 0);
        headingText.addView(
                SafeNetLockBrand.eyebrow(this, "SAFENET  /  APP LOCK"),
                new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                )
        );

        TextView titleView = bodyText(title);
        titleView.setTextSize(23);
        titleView.setTypeface(SafeNetLockBrand.displayTypeface(), Typeface.BOLD);
        titleView.setTextColor(SafeNetLockBrand.TEXT);
        titleView.setLetterSpacing(0.02f);
        headingText.addView(titleView, marginParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                -2,
                4
        ));

        TextView descriptionView = bodyText(description);
        descriptionView.setTextColor(SafeNetLockBrand.BODY);
        headingText.addView(descriptionView, marginParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                -2,
                6
        ));
        heading.addView(headingText, new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f
        ));
        root.addView(heading, marginParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                -2,
                0
        ));
    }

    private EditText field(String hint, int inputType) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setInputType(inputType);
        input.setPadding(dp(14), 0, dp(14), 0);
        SafeNetLockBrand.styleInput(input, this);
        content.addView(input, marginParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                54,
                8
        ));
        return input;
    }

    private Button primaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        SafeNetLockBrand.stylePrimaryButton(button, this);
        return button;
    }

    private Button secondaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        SafeNetLockBrand.styleSecondaryButton(button, this);
        return button;
    }

    private TextView bodyText(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(SafeNetLockBrand.BODY);
        view.setTextSize(14);
        view.setTypeface(SafeNetLockBrand.bodyTypeface());
        view.setLineSpacing(0, 1.08f);
        return view;
    }

    private TextView statusText() {
        TextView view = bodyText("");
        view.setTextColor(SafeNetLockBrand.ACCENT);
        view.setTextSize(12);
        view.setTypeface(SafeNetLockBrand.monoTypeface());
        view.setPadding(dp(12), dp(10), dp(12), dp(10));
        view.setBackground(SafeNetLockBrand.roundedBackground(
                SafeNetLockBrand.SURFACE,
                SafeNetLockBrand.BORDER,
                8,
                this
        ));
        return view;
    }

    private ScrollView scrollRoot(View child) {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setBackgroundColor(SafeNetLockBrand.BACKGROUND);
        scrollView.setClipToPadding(false);
        scrollView.addView(child);
        return scrollView;
    }

    private LinearLayout.LayoutParams marginParams(int width, int height, int topMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.topMargin = dp(topMargin);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void showStatus(String message) {
        if (statusView != null) {
            statusView.setText(message == null ? "" : message);
        }
    }

    private void sendUnlockedBroadcast() {
        Intent intent = new Intent(AppLockManager.ACTION_APP_UNLOCKED)
                .setPackage(getPackageName())
                .putExtra(AppLockManager.EXTRA_PACKAGE_NAME, lockedPackage);
        sendBroadcast(intent);
    }

    private void finishSuccess() {
        setResult(RESULT_LOCKLOCK_SUCCESS);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (AppLockManager.MODE_SETUP.equals(mode)) {
            super.onBackPressed();
            return;
        }
        Toast.makeText(this, "Use Android biometric or the passcode fallback to continue.", Toast.LENGTH_SHORT).show();
    }
}