package com.safenet.dns;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.net.VpnService;
import android.os.Build;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import org.json.JSONObject;
import java.util.List;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "SafeNetVpn")
public class SafeNetVpnPlugin extends Plugin {
    public static final String EULA_VERSION = "1.0";
    private static final String PREFS_NAME = "safenet_vpn";
    private static final String PREF_EULA_VERSION = "accepted_eula_version";
    private ExecutorService apkScannerExecutor;
    private ApkScanner apkScanner;

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
        SafeNetVpnService.requestStop();
        getContext().stopService(new Intent(getContext(), SafeNetVpnService.class));
        call.resolve(status());
    }

    @PluginMethod
    public void getApkScanStatus(PluginCall call) {
        ApkScanner scanner = apkScanner();
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("scannerAvailable", scanner.isAvailable());
        result.put("signatureVersion", scanner.getDatabaseVersion());
        result.put(
            "scannerMessage",
            scanner.isAvailable() ? "Offline APK scanner ready." : scanner.getDatabaseError()
        );

        JSONObject lastScan = scanner.getLastScan();
        if (lastScan != null) {
            result.put("lastScan", toJsObject(lastScan));
        }
        call.resolve(result);
    }

    @PluginMethod
    public void scanApk(PluginCall call) {
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .setType("application/vnd.android.package-archive")
            .addCategory(Intent.CATEGORY_OPENABLE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, picker, "apkPickerResult");
    }

    @ActivityCallback
    private void apkPickerResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result == null || result.getResultCode() != Activity.RESULT_OK ||
            result.getData() == null || result.getData().getData() == null) {
            call.reject("No APK was selected.", "APK_NOT_SELECTED");
            return;
        }

        Uri uri = result.getData().getData();
        String name = displayName(uri);
        scanExecutor().execute(() -> {
            ApkScanner.ScanResult scanResult = apkScanner().scanUri(uri, name);
            apkScanner().remember(scanResult);
            call.resolve(toJsObject(scanResult.toJson()));
        });
    }

    @PluginMethod
    public void scanInstalledApks(PluginCall call) {
        scanExecutor().execute(() -> {
            List<ApkScanner.ScanResult> results = apkScanner().scanInstalledApplications();
            JSArray response = new JSArray();
            for (ApkScanner.ScanResult result : results) {
                response.put(toJsObject(result.toJson()));
            }
            for (ApkScanner.ScanResult result : results) {
                if (!ApkScanner.VERDICT_SAFE.equals(result.verdict)) {
                    apkScanner().remember(result);
                    break;
                }
            }
            call.resolve(response);
        });
    }

    private synchronized ApkScanner apkScanner() {
        if (apkScanner == null) {
            apkScanner = new ApkScanner(getContext());
        }
        return apkScanner;
    }

    private ExecutorService scanExecutor() {
        if (apkScannerExecutor == null) {
            apkScannerExecutor = Executors.newSingleThreadExecutor();
        }
        return apkScannerExecutor;
    }

    private String displayName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                uri,
                new String[] { OpenableColumns.DISPLAY_NAME },
                null,
                null,
                null
            );
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.trim().isEmpty()) {
                        return name;
                    }
                }
            }
        } catch (Exception ignored) {
            // A display name is optional; the scanner can use the package label.
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return "Selected APK";
    }

    private JSObject toJsObject(JSONObject json) {
        JSObject result = new JSObject();
        if (json == null) {
            return result;
        }
        Iterator<String> keys = json.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            result.put(key, json.opt(key));
        }
        return result;
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