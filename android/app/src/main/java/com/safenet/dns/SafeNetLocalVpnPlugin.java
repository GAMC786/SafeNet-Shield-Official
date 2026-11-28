package com.safenet.dns;

import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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
    private static final int STOP_CONFIRMATION_ATTEMPTS = 20;
    private static final int START_CONFIRMATION_ATTEMPTS = 80;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("connected", SafeNetLocalVpnService.isRunningNow());
        result.put("shouldRecover", SafeNetLocalVpnService.shouldRecover(getContext()));
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
        if (!resolverType.equals("plain") && !resolverType.equals("dot") &&
            !resolverType.equals("doh") && !resolverType.equals("sdns")) {
            call.reject("The selected DNS server uses an unsupported protocol.");
            return;
        }
        Intent permission;
        try {
            permission = VpnService.prepare(getContext());
        } catch (RuntimeException error) {
            call.reject(
                "Android could not check SafeNet VPN permission.",
                "LOCAL_VPN_PERMISSION_CHECK_FAILED",
                error
            );
            return;
        }
        if (permission == null) {
            if (startService(call)) resolveStartAccepted(call);
            return;
        }
        try {
            startActivityForResult(call, permission, "vpnPermissionResult");
        } catch (RuntimeException error) {
            call.reject(
                "Android could not open the SafeNet VPN permission prompt.",
                "LOCAL_VPN_PERMISSION_PROMPT_FAILED",
                error
            );
        }
    }

    @ActivityCallback
    private void vpnPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK) {
            call.reject(
                "Android VPN permission was canceled. DNS protection remains off; try again to enable it.",
                "VPN_PERMISSION_DENIED"
            );
            return;
        }
        if (startService(call)) resolveStartAccepted(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), SafeNetLocalVpnService.class);
        intent.setAction(SafeNetLocalVpnService.ACTION_STOP);
        try {
            getContext().startService(intent);
            confirmStopped(call, STOP_CONFIRMATION_ATTEMPTS);
        } catch (RuntimeException error) {
            call.reject("Android could not stop SafeNet Local VPN.", "LOCAL_VPN_STOP_FAILED", error);
        }
    }

    private void confirmStopped(PluginCall call, int attemptsRemaining) {
        if (!SafeNetLocalVpnService.isRunningNow()) {
            resolveStatus(call);
            return;
        }
        if (attemptsRemaining <= 0) {
            call.reject(
                "SafeNet Local VPN is still active. Private DNS was not opened.",
                "LOCAL_VPN_STOP_TIMEOUT"
            );
            return;
        }
        mainHandler.postDelayed(
            () -> confirmStopped(call, attemptsRemaining - 1),
            100
        );
    }

    private boolean startService(PluginCall call) {
        try {
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
            return true;
        } catch (RuntimeException error) {
            call.reject(
                "Android could not start SafeNet DNS protection.",
                "LOCAL_VPN_START_FAILED",
                error
            );
            return false;
        }
    }

    private void resolveStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("connected", SafeNetLocalVpnService.isRunningNow());
        result.put("shouldRecover", SafeNetLocalVpnService.shouldRecover(getContext()));
        result.put("mode", "local");
        result.put("error", SafeNetLocalVpnService.getLastErrorMessage());
        call.resolve(result);
    }

    private void resolveStartAccepted(PluginCall call) {
        confirmStarted(call, START_CONFIRMATION_ATTEMPTS);
    }

    private void confirmStarted(PluginCall call, int attemptsRemaining) {
        if (SafeNetLocalVpnService.isRunningNow()) {
            resolveStatus(call);
            return;
        }
        String error = SafeNetLocalVpnService.getLastErrorMessage();
        if (error != null && !error.trim().isEmpty()) {
            call.reject(error, "LOCAL_VPN_START_FAILED");
            return;
        }
        if (attemptsRemaining <= 0) {
            call.reject(
                "Android did not confirm that SafeNet DNS protection started.",
                "LOCAL_VPN_START_TIMEOUT"
            );
            return;
        }
        mainHandler.postDelayed(
            () -> confirmStarted(call, attemptsRemaining - 1),
            100
        );
    }
}
