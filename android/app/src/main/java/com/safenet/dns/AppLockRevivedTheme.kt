package com.safenet.dns

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import android.app.Activity
import android.graphics.Color as AndroidColor
import android.os.Build
import android.view.View

internal object AppLockRevivedTheme {
    private const val PREFERENCES = "safenet_ui_preferences"
    private const val THEME_KEY = "theme"

    @JvmStatic
    fun isLight(context: android.content.Context): Boolean =
        context.getSharedPreferences(PREFERENCES, android.content.Context.MODE_PRIVATE)
            .getString(THEME_KEY, "dark") == "light"

    @JvmStatic
    fun applySystemBars(activity: Activity, light: Boolean) {
        val window = activity.window
        val barColor = if (light) AndroidColor.rgb(241, 242, 244) else AndroidColor.rgb(15, 23, 42)
        window.statusBarColor = barColor
        window.navigationBarColor = barColor
        var visibility = window.decorView.systemUiVisibility
        val lightBars = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            } else {
                0
            }
        visibility = if (light) visibility or lightBars else visibility and lightBars.inv()
        window.decorView.systemUiVisibility = visibility
    }

    @Composable
    fun Content(
        light: Boolean,
        content: @Composable () -> Unit,
    ) {
        val scheme = if (light) {
            lightColorScheme(
                primary = Color(0xFF2563EB),
                onPrimary = Color.White,
                background = Color(0xFFF1F2F4),
                onBackground = Color(0xFF0F172A),
                surface = Color.White,
                onSurface = Color(0xFF0F172A),
                surfaceVariant = Color(0xFFE2E8F0),
                onSurfaceVariant = Color(0xFF475569),
                error = Color(0xFFB91C1C),
            )
        } else {
            darkColorScheme(
                primary = Color(0xFF38BDF8),
                onPrimary = Color(0xFF0F172A),
                background = Color(0xFF0F172A),
                onBackground = Color(0xFFF8FAFC),
                surface = Color(0xFF172235),
                onSurface = Color(0xFFF8FAFC),
                surfaceVariant = Color(0xFF243247),
                onSurfaceVariant = Color(0xFFCBD5E1),
                error = Color(0xFFF87171),
            )
        }
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
