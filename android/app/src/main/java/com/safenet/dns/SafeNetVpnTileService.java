package com.safenet.dns;

import android.content.Intent;
import android.net.VpnService;
import android.os.Handler;
import android.os.Looper;
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
        if (SafeNetWireGuardConfig.isConfigured()
                && SafeNetWireGuardManager.get(this).isRunning()) {
            SafeNetWireGuardManager.get(this).stopAsync(
                this::postUpdateTile,
                error -> postUpdateTile()
            );
            return;
        }
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
        if (SafeNetWireGuardConfig.isConfigured()
                && SafeNetVpnPlugin.TUNNEL_WIREGUARD.equals(
                    preferences.getString(SafeNetVpnPlugin.PREF_ACTIVE_TUNNEL, "")
                )) {
            String selectedDnsServers = preferences.getString(
                SafeNetVpnPlugin.PREF_WIREGUARD_DNS_SERVERS,
                SafeNetWireGuardConfig.defaultDnsServers()
            );
            SafeNetWireGuardManager.get(this).startAsync(
                selectedDnsServers,
                this::postUpdateTile,
                error -> postUpdateTile()
            );
            return;
        }
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
        boolean dnsReady = SafeNetVpnPlugin.EULA_VERSION.equals(
                preferences.getString("accepted_eula_version", null))
            && VpnService.prepare(this) == null
            && !preferences.getString(SafeNetVpnPlugin.PREF_RESOLVER_PRIMARY, "").trim().isEmpty();
        boolean wireGuardReady = SafeNetWireGuardConfig.isConfigured()
            && VpnService.prepare(this) == null;
        return dnsReady || wireGuardReady;
    }

    private void openApp() {
        Intent intent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivityAndCollapse(intent);
    }

    private void updateTile() {
        Tile tile = getQsTile();
        if (tile == null) return;
        boolean wireGuardRunning = SafeNetWireGuardConfig.isConfigured()
            && SafeNetWireGuardManager.get(this).isRunning();
        boolean running = SafeNetVpnService.isRunning();
        tile.setState(running || wireGuardRunning ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        tile.setLabel(wireGuardRunning
            ? "SafeNet WireGuard On"
            : running ? "SafeNet DNS On" : "SafeNet VPN Off");
        tile.setSubtitle(wireGuardRunning
            ? "SafeNet gateway protected"
            : running ? "DNS protected" : "Tap to protect");
        tile.updateTile();
    }

    private void postUpdateTile() {
        new Handler(Looper.getMainLooper()).post(this::updateTile);
    }
}