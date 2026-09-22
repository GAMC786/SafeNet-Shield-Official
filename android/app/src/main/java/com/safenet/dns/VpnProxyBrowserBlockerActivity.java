package com.safenet.dns;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.ResolveInfo;
import android.graphics.Typeface;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Native configuration and blocked-launch surface for the proxy browser policy.
 */
public final class VpnProxyBrowserBlockerActivity extends Activity {
    private static final int PADDING_DP = 24;
    private LinearLayout content;
    private LinearLayout appList;
    private TextView statusView;
    private boolean saved;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(SafeNetLockBrand.BACKGROUND);
        window.setNavigationBarColor(SafeNetLockBrand.BACKGROUND);
        String mode = getIntent().getStringExtra(VpnProxyBrowserBlockerManager.EXTRA_MODE);
        if (VpnProxyBrowserBlockerManager.MODE_BLOCKED.equals(mode)) {
            showBlocked(getIntent().getStringExtra(VpnProxyBrowserBlockerManager.EXTRA_BLOCKED_PACKAGE));
        } else {
            showConfigure();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (saved) {
            updateStatus();
        }
    }

    private void showConfigure() {
        content = baseContent(
                "VPN & Proxy Browser Blocker",
                "Choose installed apps that SafeNet must stop before they open. SafeNet blocks the selected app at launch; it does not inspect HTTPS traffic inside a proxy tunnel."
        );

        TextView recommended = bodyText(
                "Recommended matches are preselected when detected. Review the list and include any VPN or proxy browser you want blocked."
        );
        content.addView(recommended, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 12));

        TextView appsLabel = SafeNetLockBrand.eyebrow(this, "BLOCKED APPS");
        content.addView(appsLabel, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 16));
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
        loadApps();

        Button save = primaryButton("Save and enable blocker");
        content.addView(save, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 52, 16));
        statusView = statusText();
        content.addView(statusView, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 8));

        Button accessibility = secondaryButton("Open Accessibility Settings");
        accessibility.setOnClickListener(view -> startActivity(AppLockManager.accessibilitySettingsIntent()));
        content.addView(accessibility, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 48, 8));

        Button disable = secondaryButton("Disable blocker");
        disable.setOnClickListener(view -> {
            VpnProxyBrowserBlockerManager.setEnabled(this, false);
            Toast.makeText(this, "VPN and proxy browser blocker disabled.", Toast.LENGTH_SHORT).show();
            setResult(RESULT_OK);
            finish();
        });
        content.addView(disable, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 48, 8));

        save.setOnClickListener(view -> {
            Set<String> selected = selectedPackages();
            if (selected.isEmpty()) {
                showStatus("Select at least one VPN or proxy browser.");
                return;
            }
            VpnProxyBrowserBlockerManager.setBlockedPackages(this, selected);
            VpnProxyBrowserBlockerManager.setEnabled(this, true);
            saved = true;
            updateStatus();
            setResult(RESULT_OK);
            finish();
        });
        setContentView(scrollRoot(content));
    }

    private void loadApps() {
        Set<String> selected = VpnProxyBrowserBlockerManager.getBlockedPackages(this);
        List<ResolveInfo> launchableApps = new ArrayList<>();
        Intent launcherIntent = new Intent(Intent.ACTION_MAIN);
        launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);
        try {
            launchableApps.addAll(getPackageManager().queryIntentActivities(launcherIntent, 0));
        } catch (RuntimeException error) {
            showStatus("Installed app list is unavailable.");
            return;
        }
        Set<String> addedPackages = new HashSet<>();
        for (ResolveInfo resolveInfo : launchableApps) {
            ApplicationInfo applicationInfo = resolveInfo.activityInfo == null
                    ? null
                    : resolveInfo.activityInfo.applicationInfo;
            if (applicationInfo == null
                    || getPackageName().equals(applicationInfo.packageName)
                    || !addedPackages.add(applicationInfo.packageName)) {
                continue;
            }
            CheckBox appCheck = new CheckBox(this);
            appCheck.setText(applicationInfo.loadLabel(getPackageManager()));
            SafeNetLockBrand.styleCheckBox(appCheck);
            appCheck.setTag(applicationInfo.packageName);
            appCheck.setChecked(
                    selected.contains(applicationInfo.packageName)
                            || (selected.isEmpty()
                            && VpnProxyBrowserBlockerManager.isLikelyVpnProxyBrowser(
                                    applicationInfo,
                                    getPackageManager()
                            ))
            );
            appList.addView(appCheck, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 44, 0));
        }
    }

    private Set<String> selectedPackages() {
        HashSet<String> selected = new HashSet<>();
        if (appList == null) {
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
        return selected;
    }

    private void updateStatus() {
        if (statusView == null) {
            return;
        }
        statusView.setText(VpnProxyBrowserBlockerManager.status(this).optString("message", ""));
    }

    private void showBlocked(String packageName) {
        String appName = packageName == null ? "This app" : packageName;
        try {
            ApplicationInfo info = getPackageManager().getApplicationInfo(packageName, 0);
            appName = getPackageManager().getApplicationLabel(info).toString();
        } catch (RuntimeException ignored) {
            // Keep the package name when the app was removed during the handoff.
        }
        content = baseContent(
                "Browser blocked",
                appName + " is blocked by SafeNet because it can use a VPN or private proxy path."
        );
        TextView explanation = bodyText(
                "To change this policy, return to SafeNet and open VPN & Proxy Browser Blocker settings."
        );
        content.addView(explanation, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 16));
        Button home = primaryButton("Return to home screen");
        home.setOnClickListener(view -> {
            Intent intent = new Intent(Intent.ACTION_MAIN)
                    .addCategory(Intent.CATEGORY_HOME)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            finish();
        });
        content.addView(home, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, 52, 20));
        setContentView(scrollRoot(content));
    }

    @Override
    public void onBackPressed() {
        if (VpnProxyBrowserBlockerManager.MODE_BLOCKED.equals(
                getIntent().getStringExtra(VpnProxyBrowserBlockerManager.EXTRA_MODE)
        )) {
            Intent intent = new Intent(Intent.ACTION_MAIN)
                    .addCategory(Intent.CATEGORY_HOME)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            finish();
            return;
        }
        super.onBackPressed();
    }

    private LinearLayout baseContent(String title, String description) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(PADDING_DP), dp(24), dp(PADDING_DP), dp(28));
        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.VERTICAL);
        heading.setPadding(dp(14), dp(14), dp(14), dp(14));
        heading.setBackground(SafeNetLockBrand.roundedBackground(
                SafeNetLockBrand.SURFACE,
                SafeNetLockBrand.PRIMARY,
                14,
                this
        ));
        heading.addView(SafeNetLockBrand.eyebrow(this, "SAFENET  /  APP NETWORK POLICY"));
        TextView titleView = bodyText(title);
        titleView.setTextSize(23);
        titleView.setTypeface(SafeNetLockBrand.displayTypeface(), Typeface.BOLD);
        titleView.setTextColor(SafeNetLockBrand.TEXT);
        heading.addView(titleView, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 5));
        TextView descriptionView = bodyText(description);
        heading.addView(descriptionView, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 6));
        root.addView(heading, marginParams(LinearLayout.LayoutParams.MATCH_PARENT, -2, 0));
        return root;
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
}