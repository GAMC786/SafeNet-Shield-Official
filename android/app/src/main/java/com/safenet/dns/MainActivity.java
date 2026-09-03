package com.safenet.dns;

import android.os.Bundle;
import android.view.Window;

import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafeNetVpnPlugin.class);
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        // Keep the web content below system bars where the platform allows it.
        // Android 15+ may enforce edge-to-edge for newer target SDKs, so the
        // web layer also declares safe-area padding in index.css.
        WindowCompat.setDecorFitsSystemWindows(window, true);
        window.setStatusBarColor(ContextCompat.getColor(this, R.color.status_bar));
        window.setNavigationBarColor(ContextCompat.getColor(this, R.color.navigation_bar));

        WindowInsetsControllerCompat insetsController =
                WindowCompat.getInsetsController(window, window.getDecorView());
        insetsController.show(WindowInsetsCompat.Type.statusBars());
        insetsController.show(WindowInsetsCompat.Type.navigationBars());
        insetsController.setAppearanceLightStatusBars(false);
        insetsController.setAppearanceLightNavigationBars(false);
    }
}
