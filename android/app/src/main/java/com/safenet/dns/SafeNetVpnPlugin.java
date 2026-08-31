package com.safenet.dns;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.VpnService;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "SafeNetVpn")
public class SafeNetVpnPlugin extends Plugin {
    public static final String EULA_VERSION = "1.0";
    private static final String PREFS_NAME = "safenet_vpn";
    private static final String PREF_EULA_VERSION = "accepted_eula_version";

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
    }

    private boolean hasAcceptedEula() {
        return EULA_VERSION.equals(preferences().getString(PREF_EULA_VERSION, null));
    }

    private JSObject status() {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("running", SafeNetVpnService.isRunning());
        result.put("permissionGranted", VpnService.prepare(getContext()) == null);
        result.put("eulaVersion", EULA_VERSION);
        result.put("eulaAccepted", hasAcceptedEula());
        String error = SafeNetVpnService.getLastError();
        if (error != null) {
            result.put("error", error);
        }
        return result;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void acceptEula(PluginCall call) {
        String version = call.getString("version", "");
        if (!EULA_VERSION.equals(version)) {
            call.reject("Unsupported EULA version.");
            return;
        }

        preferences().edit().putString(PREF_EULA_VERSION, version).apply();
        call.resolve(status());
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasAcceptedEula()) {
            call.reject("EULA acceptance is required before starting DNS protection.", "EULA_REQUIRED");
            return;
        }

        String type = call.getString("type", "plain");
        String primaryAddress = call.getString("primaryAddress", "");
        String secondaryAddress = call.getString("secondaryAddress", "");
        if (primaryAddress == null || primaryAddress.trim().isEmpty()) {
            call.reject("Select an active DNS server before starting protection.", "DNS_REQUIRED");
            return;
        }

        Intent serviceIntent = createServiceIntent(type, primaryAddress, secondaryAddress);
        Intent permissionIntent = VpnService.prepare(getContext());
        if (permissionIntent != null) {
            startActivityForResult(call, permissionIntent, "vpnPermissionResult");
            return;
        }

        startService(serviceIntent);
        call.resolve(status());
    }

    @ActivityCallback
    private void vpnPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result == null || result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Android VPN permission was not granted.", "PERMISSION_DENIED");
            return;
        }

        String type = call.getString("type", "plain");
        String primaryAddress = call.getString("primaryAddress", "");
        String secondaryAddress = call.getString("secondaryAddress", "");
        startService(createServiceIntent(type, primaryAddress, secondaryAddress));
        call.resolve(status());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), SafeNetVpnService.class));
        call.resolve(status());
    }

    private Intent createServiceIntent(String type, String primaryAddress, String secondaryAddress) {
        return new Intent(getContext(), SafeNetVpnService.class)
            .putExtra(SafeNetVpnService.EXTRA_TYPE, type)
            .putExtra(SafeNetVpnService.EXTRA_PRIMARY, primaryAddress)
            .putExtra(SafeNetVpnService.EXTRA_SECONDARY, secondaryAddress == null ? "" : secondaryAddress);
    }

    private void startService(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
    }
}