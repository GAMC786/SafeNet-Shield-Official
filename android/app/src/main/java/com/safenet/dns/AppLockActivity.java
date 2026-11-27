package com.safenet.dns;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

import androidx.compose.ui.platform.ComposeView;

/**
 * SafeNet-owned AppLock dashboard entry point.
 *
 * Lock events and local credential state remain owned by SafeNet. The screen
 * deliberately opens Android's permission panels only after an explicit tap.
 */
public final class AppLockActivity extends LockLockActivity {
    private String mode;
    private boolean setupCompletedThisSession;
    private boolean dashboardResumed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        mode = getIntent().getStringExtra(AppLockManager.EXTRA_MODE);
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
        ComposeView composeView = new ComposeView(this);
        AppLockRevivedSetupUi.render(this, composeView, this::markComposeSetupSaved);
        setContentView(composeView);
    }

    public void markComposeSetupSaved() {
        setupCompletedThisSession = true;
        finishSetupIfReady();
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
        showAppLockDashboard();
        return true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!AppLockManager.MODE_SETUP.equals(mode)) {
            return;
        }
        if (dashboardResumed) {
            showAppLockDashboard();
            finishSetupIfReady();
        } else {
            dashboardResumed = true;
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
    public void onBackPressed() {
        super.onBackPressed();
    }
}
