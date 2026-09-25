package com.safenet.dns;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * Quick Settings entry point for SafeNet's Tailscale device VPN.
 *
 * The tile routes the action through the app so the existing EULA, App Lock,
 * and Android VPN-consent flows remain in force.
 */
public final class SafeNetTailscaleTileService extends TileService {
    static final String ACTION_TOGGLE = "com.safenet.dns.action.TOGGLE_TAILSCALE";

    @Override
    public void onStartListening() {
        super.onStartListening();
        updateTileState();
    }

    @Override
    public void onClick() {
        super.onClick();
        Intent toggleIntent = new Intent(this, MainActivity.class)
            .setAction(ACTION_TOGGLE)
            .addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP
            );
        startActivityAndCollapse(toggleIntent);
    }

    static void requestTileRefresh(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return;
        }
        TileService.requestListeningState(
            context,
            new ComponentName(context, SafeNetTailscaleTileService.class)
        );
    }

    private void updateTileState() {
        Tile tile = getQsTile();
        if (tile == null) {
            return;
        }
        boolean connected = SafeNetTailscalePlugin.isConnected();
        tile.setLabel(getString(R.string.tailscale_vpn_tile_label));
        tile.setState(connected ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(getString(
                connected
                    ? R.string.tailscale_vpn_tile_connected
                    : R.string.tailscale_vpn_tile_disconnected
            ));
        }
        tile.updateTile();
    }
}