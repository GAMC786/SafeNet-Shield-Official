package com.safenet.dns;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * Quick Settings entry point for SafeNet's Android Private DNS protection.
 *
 * Android does not allow ordinary applications to change the protected Private
 * DNS setting directly. The tile therefore reflects the verified state and
 * opens the system settings screen when tapped.
 */
public class SafeNetPrivateDnsTileService extends TileService {
    private static final String PREFS_NAME = "safenet_private_dns_tile";
    private static final String EXPECTED_HOSTNAME_KEY = "expected_hostname";

    public static void rememberExpectedHostname(Context context, String hostname) {
        String normalized = normalizeHostname(hostname);
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(EXPECTED_HOSTNAME_KEY, normalized == null ? "" : normalized)
            .apply();
        requestTileRefresh(context);
    }

    @Override
    public void onStartListening() {
        super.onStartListening();
        updateTileState();
    }

    @Override
    public void onClick() {
        super.onClick();
        Intent settingsIntent = new Intent("android.settings.PRIVATE_DNS_SETTINGS")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivityAndCollapse(settingsIntent);
        } catch (RuntimeException error) {
            Intent appSettingsIntent = new Intent(
                android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            )
                .setData(android.net.Uri.parse("package:" + getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivityAndCollapse(appSettingsIntent);
        }
    }

    private void updateTileState() {
        Tile tile = getQsTile();
        if (tile == null) {
            return;
        }
        String expectedHostname = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getString(EXPECTED_HOSTNAME_KEY, "");
        boolean active = SafeNetProtectionStatus.isPrivateDnsActive(this, expectedHostname);
        tile.setLabel(getString(com.safenet.dns.R.string.private_dns_tile_label));
        tile.setState(active ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(getString(
                active
                    ? com.safenet.dns.R.string.private_dns_tile_active
                    : com.safenet.dns.R.string.private_dns_tile_inactive
            ));
        }
        tile.updateTile();
    }

    private static void requestTileRefresh(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return;
        }
        TileService.requestListeningState(
            context,
            new ComponentName(context, SafeNetPrivateDnsTileService.class)
        );
    }

    private static String normalizeHostname(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim().toLowerCase(java.util.Locale.US);
        while (normalized.endsWith(".")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (normalized.isEmpty() || normalized.contains("/") || normalized.contains(" ")) {
            return null;
        }
        if (normalized.matches("[^:]+:\\d{1,5}")) {
            normalized = normalized.substring(0, normalized.lastIndexOf(':'));
        }
        if (normalized.contains(":") || !normalized.matches("[a-z0-9.-]+")) {
            return null;
        }
        return normalized;
    }
}