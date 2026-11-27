package com.safenet.dns

import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.compose.ui.platform.ComposeView

/**
 * SafeNet-hosted adaptation of AppLock-Revived's Compose lock surface.
 *
 * Passcode storage, throttling, recovery, and post-unlock policy remain owned
 * by SafeNet; this activity replaces only the protected-app credential UI.
 */
class AppLockRevivedLockActivity : LockLockActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val mode = intent.getStringExtra(AppLockManager.EXTRA_MODE)
        val lockedPackage = intent.getStringExtra(AppLockManager.EXTRA_LOCKED_PACKAGE)
        if ((mode != null && mode != AppLockManager.MODE_UNLOCK)
            || lockedPackage.isNullOrEmpty()
        ) {
            return
        }

        if (!AppLockManager.isProtectionActive(this)
            || !AppLockManager.shouldLockPackage(this, lockedPackage)
        ) {
            finish()
            return
        }

        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val appName = protectedAppLabel(lockedPackage)
        setContentView(ComposeView(this).apply {
            setContent {
                AppLockRevivedLockScreen(
                    appName = appName,
                    onVerify = { passcode ->
                        val result = AppLockRevivedStateBridge.verifyPasscode(
                            this@AppLockRevivedLockActivity,
                            passcode
                        )
                        if (!result.success) {
                            result.message
                        } else {
                            this@AppLockRevivedLockActivity.completeAuthentication()
                            null
                        }
                    },
                    onRecover = { this@AppLockRevivedLockActivity.showRecovery() },
                )
            }
        })
    }

    private fun protectedAppLabel(packageName: String): String = try {
        val appInfo: ApplicationInfo = packageManager.getApplicationInfo(packageName, 0)
        packageManager.getApplicationLabel(appInfo).toString()
    } catch (_: RuntimeException) {
        "Protected app"
    }
}
