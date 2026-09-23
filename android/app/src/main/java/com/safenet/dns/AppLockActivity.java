package com.safenet.dns;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.ResolveInfo;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * SafeNet's embedded AppLock experience, adapted from the MIT-licensed
 * aload0/AppLock flow.
 *
 * This is deliberately implemented with the Android view toolkit already used
 * by SafeNet. It keeps the application identity, Capacitor bridge, local
 * passcode storage, and SafeNet permission boundaries while providing the
 * upstream experience: a protected-app dashboard, add-apps picker, status
 * control, and actionable permission warning.
 */
public final class AppLockActivity extends LockLockActivity {
    private static final int PADDING_DP = 20;
    private static final int REQUEST_AUTHENTICATION = 6202;

    private String mode;
    private String lockedPackage;
    private LinearLayout content;
    private TextView statusView;
    private LinearLayout protectedAppsList;
    private LinearLayout appPicker;
    private EditText appSearch;
    private Set<String> selectedPackages = new HashSet<>();
    private boolean pickerVisible;
    private boolean rendering;
    private boolean setupCompletedThisSession;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        mode = getIntent().getStringExtra(AppLockManager.EXTRA_MODE);
        lockedPackage = getIntent().getStringExtra(AppLockManager.EXTRA_LOCKED_PACKAGE);
        if (!AppLockManager.MODE_SETUP.equals(mode)) {
            super.onCreate(savedInstanceState);
            return;
        }

        super.onCreate(savedInstanceState);
        showAppLockDashboard();
    }

    @Override
    protected boolean useEmbeddedAppLockDashboard() {
        return true;
    }

    private void showAppLockDashboard() {
        if (rendering) {
            return;
        }
        rendering = true;
        selectedPackages = new HashSet<>(AppLockManager.getLockedPackages(this));
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(PADDING_DP), dp(16), dp(PADDING_DP), dp(28));
        addHeader();
        if (pickerVisible) {
            addAppPicker();
        } else {
            addPermissionBanner();
            addProtectedAppsSection();
            addSecuritySection();
        }
        setContentView(scrollRoot(content));
        rendering = false;
    }

    @Override
    protected boolean onAuthenticationSucceeded() {
        if (!getIntent().getBooleanExtra(
                AppLockManager.EXTRA_OPEN_DASHBOARD_AFTER_AUTH,
                false
        )) {
            return false;
        }
        mode = AppLockManager.MODE_SETUP;
        pickerVisible = false;
        showAppLockDashboard();
        return true;
    }

    private void addHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        LinearLayout titleGroup = new LinearLayout(this);
        titleGroup.setOrientation(LinearLayout.VERTICAL);
        TextView eyebrow = SafeNetLockBrand.eyebrow(this, "SAFENET  /  APPLOCK");
        titleGroup.addView(eyebrow);
        TextView title = bodyText("AppLock");
        title.setTextSize(28);
        title.setTypeface(SafeNetLockBrand.displayTypeface(), Typeface.BOLD);
        title.setTextColor(SafeNetLockBrand.TEXT);
        titleGroup.addView(title, marginParams(-1, -2, 2));
        header.addView(titleGroup, new LinearLayout.LayoutParams(0, -2, 1f));

        Switch protection = new Switch(this);
        protection.setText(AppLockManager.isEnabled(this) ? "ON" : "OFF");
        protection.setTextColor(
                AppLockManager.isEnabled(this)
                        ? SafeNetLockBrand.SUCCESS
                        : SafeNetLockBrand.MUTED
        );
        protection.setContentDescription(
                AppLockManager.isEnabled(this)
                        ? "AppLock protection on"
                        : "AppLock protection off"
        );
        protection.setChecked(AppLockManager.isEnabled(this));
        protection.setOnCheckedChangeListener((button, checked) -> {
            if (button.isPressed() && !checked && AppLockManager.isEnabled(this)) {
                button.setChecked(true);
                startActivityForResult(
                        new Intent(this, AppLockActivity.class)
                                .putExtra(AppLockManager.EXTRA_MODE, AppLockManager.MODE_DISABLE)
                                .putExtra(AppLockManager.EXTRA_LOCKED_PACKAGE, getPackageName()),
                        REQUEST_AUTHENTICATION
                );
                return;
            }
            if (checked && AppLockManager.hasPin(this)) {
                AppLockManager.setEnabled(this, true);
                button.setText("ON");
            }
        });
        header.addView(protection, new LinearLayout.LayoutParams(-2, -2));
        content.addView(header, marginParams(-1, -2, 0));

        TextView description = SafeNetLockBrand.eyebrow(
                this,
                "SELECT APPS TO PROTECT WITH YOUR LOCAL SAFENET PASSCODE"
        );
        description.setTextColor(SafeNetLockBrand.MUTED);
        description.setTextSize(10);
        description.setLineSpacing(0, 1.2f);
        content.addView(description, marginParams(-1, -2, 8));
        View divider = new View(this);
        divider.setBackgroundColor(SafeNetLockBrand.BORDER);
        content.addView(divider, marginParams(-1, dp(1), 0));
    }

    private void addPermissionBanner() {
        boolean accessibility = AppLockManager.isAccessibilityServiceEnabled(this);
        boolean overlay = AppLockManager.isOverlayPermissionEnabled(this);
        boolean admin = !AppLockManager.isAntiUninstallEnabled(this)
                || AppLockManager.isDeviceAdminEnabled(this);
        if (accessibility && overlay && admin) {
            return;
        }

        LinearLayout banner = sectionCard();
        TextView title = bodyText("Permission needed");
        title.setTextSize(16);
        title.setTypeface(SafeNetLockBrand.displayTypeface(), Typeface.BOLD);
        title.setTextColor(SafeNetLockBrand.TEXT);
        banner.addView(title);

        String message = !overlay
                ? "Allow display over other apps so AppLock can show its protected-app surface."
                : !accessibility
                        ? "Enable the SafeNet Accessibility Service to detect protected app launches."
                        : "Activate SafeNet Device Administrator to finish anti-uninstall protection.";
        TextView detail = bodyText(message);
        detail.setTextColor(SafeNetLockBrand.BODY);
        banner.addView(detail, marginParams(-1, -2, 4));

        Button action = primaryButton(
                !overlay
                        ? "Allow overlay"
                        : !accessibility
                                ? "Open Accessibility Settings"
                                : "Open Device Administrator"
        );
        action.setOnClickListener(view -> {
            if (!overlay) {
                startActivity(AppLockManager.overlayPermissionIntent(this));
            } else if (!accessibility) {
                startActivity(AppLockManager.accessibilitySettingsIntent());
            } else {
                startActivity(AppLockManager.deviceAdminIntent(this));
            }
        });
        banner.addView(action, marginParams(-1, 48, 10));
        content.addView(banner, marginParams(-1, -2, 14));
    }

    private void addProtectedAppsSection() {
        TextView section = sectionLabel("PROTECTED APPS");
        content.addView(section, marginParams(-1, -2, 16));
        TextView help = bodyText(
                "Protected apps are monitored before they open. SafeNet is always protected."
        );
        help.setTextColor(SafeNetLockBrand.MUTED);
        content.addView(help, marginParams(-1, -2, 6));

        protectedAppsList = new LinearLayout(this);
        protectedAppsList.setOrientation(LinearLayout.VERTICAL);
        protectedAppsList.setBackground(SafeNetLockBrand.roundedBackground(
                SafeNetLockBrand.SURFACE,
                SafeNetLockBrand.BORDER,
                14,
                this
        ));
        content.addView(protectedAppsList, marginParams(-1, -2, 6));
        renderProtectedApps();

        Button addApps = primaryButton("Add protected apps");
        addApps.setContentDescription("Add protected apps");
        addApps.setOnClickListener(view -> {
            pickerVisible = true;
            showAppLockDashboard();
        });
        content.addView(addApps, marginParams(-1, 50, 12));
    }

    private void renderProtectedApps() {
        if (protectedAppsList == null) {
            return;
        }
        protectedAppsList.removeAllViews();
        List<ResolveInfo> launchers = queryLaunchableApps();
        int count = 0;
        for (ResolveInfo resolveInfo : launchers) {
            ApplicationInfo info = resolveInfo.activityInfo == null
                    ? null
                    : resolveInfo.activityInfo.applicationInfo;
            if (info == null || !selectedPackages.contains(info.packageName)) {
                continue;
            }
            count++;
            protectedAppsList.addView(appRow(info, false), marginParams(-1, 58, 0));
        }
        if (count == 0) {
            TextView empty = bodyText("No Protected Apps\nTap “Add protected apps” to secure an app.");
            empty.setGravity(Gravity.CENTER);
            empty.setTextColor(SafeNetLockBrand.MUTED);
            protectedAppsList.addView(empty, marginParams(-1, 82, 0));
        }
    }

    private void addSecuritySection() {
        content.addView(sectionLabel("SECURITY"), marginParams(-1, -2, 16));
        LinearLayout card = sectionCard();

        if (!AppLockManager.hasPin(this)) {
            addPasscodeFields(card);
        } else {
            TextView configured = bodyText(
                    "Local passcode configured. SafeNet stores only a salted passcode hash on this device."
            );
            configured.setTextColor(SafeNetLockBrand.BODY);
            card.addView(configured);
            Button recover = secondaryButton("Open passcode and recovery settings");
            recover.setOnClickListener(view -> startActivity(
                    new Intent(this, LockLockActivity.class)
                            .putExtra(AppLockManager.EXTRA_MODE, AppLockManager.MODE_SETUP)
                            .putExtra(AppLockManager.EXTRA_LOCKED_PACKAGE, getPackageName())
            ));
            card.addView(recover, marginParams(-1, 48, 10));
        }

        CheckBox antiUninstall = new CheckBox(this);
        antiUninstall.setText("Enable anti-uninstall protection");
        antiUninstall.setChecked(AppLockManager.isAntiUninstallEnabled(this));
        SafeNetLockBrand.styleCheckBox(antiUninstall);
        antiUninstall.setOnCheckedChangeListener((button, checked) -> {
            AppLockManager.setAntiUninstallEnabled(this, checked);
            if (checked && !AppLockManager.isDeviceAdminEnabled(this)) {
                startActivity(AppLockManager.deviceAdminIntent(this));
            }
        });
        card.addView(antiUninstall, marginParams(-1, 52, 8));
        content.addView(card, marginParams(-1, -2, 6));

        statusView = bodyText(AppLockManager.availabilityMessage(this));
        statusView.setTextColor(SafeNetLockBrand.ACCENT);
        statusView.setTextSize(12);
        content.addView(statusView, marginParams(-1, -2, 10));

        if (AppLockManager.hasPin(this) && !AppLockManager.isEnabled(this)) {
            Button enable = primaryButton("Enable AppLock protection");
            enable.setOnClickListener(view -> {
                AppLockManager.setEnabled(this, true);
                showAppLockDashboard();
            });
            content.addView(enable, marginParams(-1, 50, 8));
        }
    }

    private void addPasscodeFields(LinearLayout card) {
        TextView title = bodyText("Create your local passcode");
        title.setTextSize(16);
        title.setTypeface(SafeNetLockBrand.displayTypeface(), Typeface.BOLD);
        title.setTextColor(SafeNetLockBrand.TEXT);
        card.addView(title);
        TextView help = bodyText(
                "This is the password shown by the embedded AppLock experience. It never leaves the device."
        );
        help.setTextColor(SafeNetLockBrand.BODY);
        card.addView(help, marginParams(-1, -2, 4));

        EditText pin = field(card, "New passcode", InputType.TYPE_CLASS_NUMBER
                | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        EditText confirm = field(card, "Confirm passcode", InputType.TYPE_CLASS_NUMBER
                | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        EditText question = field(card, "Recovery question", InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        EditText answer = field(card, "Recovery answer", InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        Button save = primaryButton("Set passcode and enable AppLock");
        save.setOnClickListener(view -> {
            if (!pin.getText().toString().equals(confirm.getText().toString())) {
                showStatus("The passcodes do not match.");
                return;
            }
            try {
                AppLockManager.configure(
                        this,
                        pin.getText().toString(),
                        question.getText().toString(),
                        answer.getText().toString()
                );
                AppLockManager.setLockedPackages(this, selectedPackages);
                AppLockManager.setEnabled(this, true);
                setupCompletedThisSession = true;
                Toast.makeText(this, "AppLock passcode saved.", Toast.LENGTH_SHORT).show();
                showAppLockDashboard();
                finishSetupIfReady();
            } catch (IllegalArgumentException error) {
                showStatus(error.getMessage());
            }
        });
        card.addView(save, marginParams(-1, 50, 8));
    }

    private void addAppPicker() {
        TextView title = bodyText("Select Apps");
        title.setTextSize(24);
        title.setTypeface(SafeNetLockBrand.displayTypeface(), Typeface.BOLD);
        title.setTextColor(SafeNetLockBrand.TEXT);
        content.addView(title, marginParams(-1, -2, 16));
        TextView help = bodyText("Choose launchable apps to protect with SafeNet AppLock.");
        help.setTextColor(SafeNetLockBrand.MUTED);
        content.addView(help, marginParams(-1, -2, 6));

        appSearch = new EditText(this);
        appSearch.setHint("Search apps");
        appSearch.setSingleLine(true);
        appSearch.setInputType(InputType.TYPE_CLASS_TEXT);
        SafeNetLockBrand.styleInput(appSearch, this);
        content.addView(appSearch, marginParams(-1, 52, 8));

        appPicker = new LinearLayout(this);
        appPicker.setOrientation(LinearLayout.VERTICAL);
        content.addView(appPicker, marginParams(-1, -2, 0));
        renderAppPicker("");
        appSearch.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {
                renderAppPicker(s.toString());
            }
            @Override public void afterTextChanged(Editable s) {}
        });

        Button save = primaryButton("Protect selected apps");
        save.setOnClickListener(view -> {
            selectedPackages.add(getPackageName());
            AppLockManager.setLockedPackages(this, selectedPackages);
            pickerVisible = false;
            showAppLockDashboard();
        });
        content.addView(save, marginParams(-1, 50, 14));
        Button cancel = secondaryButton("Cancel");
        cancel.setOnClickListener(view -> {
            pickerVisible = false;
            showAppLockDashboard();
        });
        content.addView(cancel, marginParams(-1, 48, 8));
    }

    private void renderAppPicker(String query) {
        if (appPicker == null) {
            return;
        }
        appPicker.removeAllViews();
        String normalizedQuery = query == null ? "" : query.trim().toLowerCase(Locale.US);
        Set<String> added = new HashSet<>();
        for (ResolveInfo resolveInfo : queryLaunchableApps()) {
            ApplicationInfo info = resolveInfo.activityInfo == null
                    ? null
                    : resolveInfo.activityInfo.applicationInfo;
            if (info == null || !added.add(info.packageName)
                    || info.packageName.equals(getPackageName())) {
                continue;
            }
            String label = info.loadLabel(getPackageManager()).toString();
            if (!normalizedQuery.isEmpty()
                    && !label.toLowerCase(Locale.US).contains(normalizedQuery)
                    && !info.packageName.toLowerCase(Locale.US).contains(normalizedQuery)) {
                continue;
            }
            appPicker.addView(appRow(info, true), marginParams(-1, 58, 0));
        }
    }

    private View appRow(ApplicationInfo info, boolean selectable) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(8), dp(4), dp(8), dp(4));

        ImageView icon = new ImageView(this);
        Drawable drawable = info.loadIcon(getPackageManager());
        icon.setImageDrawable(drawable);
        icon.setContentDescription(info.loadLabel(getPackageManager()).toString());
        icon.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        row.addView(icon, new LinearLayout.LayoutParams(dp(40), -1));

        LinearLayout text = new LinearLayout(this);
        text.setOrientation(LinearLayout.VERTICAL);
        TextView name = bodyText(info.loadLabel(getPackageManager()).toString());
        name.setTextColor(SafeNetLockBrand.TEXT);
        name.setMaxLines(1);
        TextView packageName = bodyText(selectable
                ? info.packageName
                : "Protected");
        packageName.setTextColor(SafeNetLockBrand.MUTED);
        packageName.setTextSize(11);
        text.addView(name);
        text.addView(packageName);
        row.addView(text, new LinearLayout.LayoutParams(0, -2, 1f));

        if (selectable) {
            CheckBox check = new CheckBox(this);
            check.setChecked(selectedPackages.contains(info.packageName));
            SafeNetLockBrand.styleCheckBox(check);
            check.setContentDescription("Protect " + info.loadLabel(getPackageManager()));
            check.setOnCheckedChangeListener((button, checked) -> {
                if (checked) {
                    selectedPackages.add(info.packageName);
                } else {
                    selectedPackages.remove(info.packageName);
                }
            });
            row.addView(check, new LinearLayout.LayoutParams(-2, -1));
            row.setOnClickListener(view -> check.setChecked(!check.isChecked()));
        } else {
            Button unlock = secondaryButton("Unlock");
            unlock.setTextSize(11);
            unlock.setOnClickListener(view -> {
                AppLockManager.allowTemporaryUnlock(this, info.packageName);
                Toast.makeText(this, "Unlocked until the next protected launch.", Toast.LENGTH_SHORT).show();
            });
            row.addView(unlock, new LinearLayout.LayoutParams(dp(92), 44));
        }
        return row;
    }

    private List<ResolveInfo> queryLaunchableApps() {
        Intent launcher = new Intent(Intent.ACTION_MAIN);
        launcher.addCategory(Intent.CATEGORY_LAUNCHER);
        try {
            return getPackageManager().queryIntentActivities(launcher, 0);
        } catch (RuntimeException error) {
            return new ArrayList<>();
        }
    }

    private EditText field(LinearLayout parent, String hint, int inputType) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setInputType(inputType);
        input.setPadding(dp(14), 0, dp(14), 0);
        SafeNetLockBrand.styleInput(input, this);
        parent.addView(input, marginParams(-1, 54, 8));
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

    private TextView sectionLabel(String text) {
        TextView label = SafeNetLockBrand.eyebrow(this, text);
        label.setTextSize(10);
        return label;
    }

    private LinearLayout sectionCard() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(12), dp(12), dp(12), dp(12));
        card.setBackground(SafeNetLockBrand.roundedBackground(
                SafeNetLockBrand.SURFACE,
                SafeNetLockBrand.BORDER,
                14,
                this
        ));
        return card;
    }

    private ScrollView scrollRoot(View child) {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(SafeNetLockBrand.BACKGROUND);
        scroll.setClipToPadding(false);
        scroll.addView(child);
        ViewCompat.setOnApplyWindowInsetsListener(scroll, (view, insets) -> {
            Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(0, bars.top, 0, bars.bottom);
            return insets;
        });
        ViewCompat.requestApplyInsets(scroll);
        return scroll;
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
        } else {
            Toast.makeText(this, message == null ? "" : message, Toast.LENGTH_LONG).show();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (AppLockManager.MODE_SETUP.equals(mode) && content != null && !pickerVisible) {
            showAppLockDashboard();
            finishSetupIfReady();
        }
    }

    private void finishSetupIfReady() {
        if (!setupCompletedThisSession
                || !AppLockManager.isEnabled(this)
                || !AppLockManager.isAccessibilityServiceEnabled(this)
                || !AppLockManager.isOverlayPermissionEnabled(this)
                || (AppLockManager.isAntiUninstallEnabled(this)
                        && !AppLockManager.isDeviceAdminEnabled(this))) {
            return;
        }
        setResult(Activity.RESULT_OK);
        finish();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_AUTHENTICATION
                && resultCode == Activity.RESULT_OK) {
            finish();
        }
    }

    @Override
    public void onBackPressed() {
        if (pickerVisible) {
            pickerVisible = false;
            showAppLockDashboard();
            return;
        }
        if (AppLockManager.MODE_SETUP.equals(mode)) {
            super.onBackPressed();
            return;
        }
        super.onBackPressed();
    }
}