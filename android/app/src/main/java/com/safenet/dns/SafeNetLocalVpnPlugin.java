package com.safenet.dns;

import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import android.app.Activity;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SafeNetLocalVpn")
public final class SafeNetLocalVpnPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("connected", SafeNetLocalVpnService.isRunningNow());
        result.put("mode", "local");
        result.put("error", SafeNetLocalVpnService.getLastErrorMessage());
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String resolverType = call.getString("type");
        String primaryAddress = call.getString("primaryAddress");
        if (resolverType == null || primaryAddress == null || primaryAddress.trim().isEmpty()) {
            call.reject("Select an active DNS server before starting SafeNet Local VPN.");
            return;
        }
        Intent permission = VpnService.prepare(getContext());
        if (permission == null) {
            startService(call);
            resolveStatus(call);
            return;
        }
        startActivityForResult(call, permission, "vpnPermissionResult");
    }

    @ActivityCallback
    private void vpnPermissionResult(PluginCall call, ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Android VPN permission was not granted.", "VPN_PERMISSION_DENIED");
            return;
        }
        startService(call);
        resolveStatus(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), SafeNetLocalVpnService.class);
        intent.setAction(SafeNetLocalVpnService.ACTION_STOP);
        getContext().startService(intent);
        JSObject result = new JSObject();
        result.put("connected", false);
        result.put("mode", "local");
        call.resolve(result);
    }

    private void startService(PluginCall call) {
        Intent intent = new Intent(getContext(), SafeNetLocalVpnService.class);
        intent.setAction(SafeNetLocalVpnService.ACTION_START);
        intent.putExtra("resolverType", call.getString("type"));
        intent.putExtra("primaryAddress", call.getString("primaryAddress"));
        intent.putExtra("secondaryAddress", call.getString("secondaryAddress"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(getContext(), intent);
        } else {
            getContext().startService(intent);
        }
    }

    private void resolveStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("connected", true);
        result.put("mode", "local");
        call.resolve(result);
    }
}
