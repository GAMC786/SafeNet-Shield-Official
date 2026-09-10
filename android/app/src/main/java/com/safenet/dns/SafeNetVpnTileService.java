package com.safenet.dns;

import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * Quick Settings access for the existing DNS-only VPN.
 *
 * Android may require the app UI for first-run EULA acceptance or VPN consent.
 * The tile opens that flow instead of pretending it can grant either permission.
 */
public final class SafeNetVpnTileService extends TileService {
    @Override
    public void onStartListening() {
        super.onStartListening();
        updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        if (SafeNetVpnService.isRunning()) {
            SafeNetVpnService.requestStop();
            stopService(new Intent(this, SafeNetVpnService.class));
            updateTile();
            return;
        }

        if (!isReadyToStart()) {
            openApp();
            return;
        }

        android.content.SharedPreferences preferences =
            getSharedPreferences("safenet_vpn", MODE_PRIVATE);
        Intent serviceIntent = new Intent(this, SafeNetVpnService.class)
            .putExtra(SafeNetVpnService.EXTRA_TYPE, preferences.getString(
                SafeNetVpnPlugin.PREF_RESOLVER_TYPE, "doh"))
            .putExtra(SafeNetVpnService.EXTRA_IP_VERSION, preferences.getString(
                SafeNetVpnPlugin.PREF_RESOLVER_IP_VERSION, "ipv4"))
            .putExtra(SafeNetVpnService.EXTRA_PRIMARY, preferences.getString(
                SafeNetVpnPlugin.PREF_RESOLVER_PRIMARY, "https://dns.google/dns-query"))
            .putExtra(SafeNetVpnService.EXTRA_SECONDARY, preferences.getString(
                SafeNetVpnPlugin.PREF_RESOLVER_SECONDARY, "https://cloudflare-dns.com/dns-query"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
        updateTile();
    }

    private boolean isReadyToStart() {
        android.content.SharedPreferences preferences =
            getSharedPreferences("safenet_vpn", MODE_PRIVATE);
        return SafeNetVpnPlugin.EULA_VERSION.equals(
                preferences.getString("accepted_eula_version", null))
            && VpnService.prepare(this) == null
            && !preferences.getString(SafeNetVpnPlugin.PREF_RESOLVER_PRIMARY, "").trim().isEmpty();
    }

    private void openApp() {
        Intent intent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivityAndCollapse(intent);
    }

    private void updateTile() {
        Tile tile = getQsTile();
        if (tile == null) return;
        boolean running = SafeNetVpnService.isRunning();
        tile.setState(running ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        tile.setLabel(running ? "SafeNet VPN On" : "SafeNet VPN Off");
        tile.setSubtitle(running ? "DNS protected" : "Tap to protect DNS");
        tile.updateTile();
    }
}