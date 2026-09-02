package com.safenet.dns;

import android.Manifest;
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
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import org.json.JSONObject;
import java.util.List;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "SafeNetVpn",
    permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
    }
)
public class SafeNetVpnPlugin extends Plugin {
    public static final String EULA_VERSION = "1.0";
    private static final String PREFS_NAME = "safenet_vpn";
    private static final String PREF_EULA_VERSION = "accepted_eula_version";
    private ExecutorService apkScannerExecutor;
    private ApkScanner apkScanner;
    private AiShieldManager aiShieldManager;

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
        JSObject result = status();
        result.put("protection", toJsObject(SafeNetProtectionStatus.get(getContext())));
        call.resolve(result);
    }

    @PluginMethod
    public void getProtectionStatus(PluginCall call) {
        call.resolve(toJsObject(SafeNetProtectionStatus.get(getContext())));
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
        call.resolve(apkScanStatus());
    }

    @PluginMethod
    public void updateApkSignatures(PluginCall call) {
        String signedUpdate = call.getString("signedUpdate", "");
        if (signedUpdate == null || signedUpdate.trim().isEmpty()) {
            call.reject("A signed APK signature update is required.", "SIGNATURE_UPDATE_REQUIRED");
            return;
        }
        scanExecutor().execute(() -> {
            ApkScanner scanner = apkScanner();
            if (!scanner.installSignedUpdate(signedUpdate)) {
                call.reject(scanner.getUpdateFailureMessage(), "SIGNATURE_UPDATE_REJECTED");
                return;
            }
            call.resolve(apkScanStatus());
        });
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
    public void deleteQuarantinedApk(PluginCall call) {
        String sha256 = call.getString("sha256", "");
        if (sha256 == null || !sha256.matches("^[0-9a-fA-F]{64}$")) {
            call.reject("The quarantine item could not be identified.", "INVALID_QUARANTINE_ITEM");
            return;
        }
        scanExecutor().execute(() -> {
            if (!apkScanner().deleteQuarantinedFile(sha256)) {
                call.reject("The quarantine item was not found or could not be deleted.", "QUARANTINE_DELETE_FAILED");
                return;
            }
            call.resolve(apkScanStatus());
        });
    }

    @PluginMethod
    public void clearApkScanHistory(PluginCall call) {
        scanExecutor().execute(() -> {
            apkScanner().clearScanHistory();
            call.resolve(apkScanStatus());
        });
    }

    @PluginMethod
    public void getAiShieldStatus(PluginCall call) {
        call.resolve(toJsObject(aiShield().getStatus()));
    }

    @PluginMethod
    public void startAiShieldCamera(PluginCall call) {
        if (!aiShield().isModelAvailable()) {
            call.resolve(toJsObject(aiShield().getStatus()));
            return;
        }
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "aiShieldCameraPermissionResult");
            return;
        }
        aiShield().startCamera();
        call.resolve(toJsObject(aiShield().getStatus()));
    }

    @PermissionCallback
    private void aiShieldCameraPermissionResult(PluginCall call) {
        if (call == null) {
            return;
        }
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            AiShieldClassifier.Analysis denied = aiShield().permissionDenied(
                "camera",
                "Camera permission was denied. AI Shield did not access the camera."
            );
            call.resolve(toJsObject(denied.toJson()));
            return;
        }
        aiShield().startCamera();
        call.resolve(toJsObject(aiShield().getStatus()));
    }

    @PluginMethod
    public void startAiShieldScreen(PluginCall call) {
        if (!aiShield().isModelAvailable()) {
            call.resolve(toJsObject(aiShield().getStatus()));
            return;
        }
        android.media.projection.MediaProjectionManager projectionManager =
            (android.media.projection.MediaProjectionManager) getContext()
                .getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE);
        if (projectionManager == null) {
            AiShieldClassifier.Analysis unavailable = AiShieldClassifier.captureUnavailable(
                "screen",
                "Android MediaProjection is not available on this device."
            );
            call.resolve(toJsObject(unavailable.toJson()));
            return;
        }
        startActivityForResult(
            call,
            projectionManager.createScreenCaptureIntent(),
            "aiShieldProjectionResult"
        );
    }

    @ActivityCallback
    private void aiShieldProjectionResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        int resultCode = result == null ? Activity.RESULT_CANCELED : result.getResultCode();
        Intent data = result == null ? null : result.getData();
        aiShield().startScreen(resultCode, data);
        call.resolve(toJsObject(aiShield().getStatus()));
    }

    @PluginMethod
    public void stopAiShield(PluginCall call) {
        aiShield().stop();
        call.resolve(toJsObject(aiShield().getStatus()));
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
                apkScanner().remember(result);
            }
            JSObject payload = new JSObject();
            payload.put("results", response);
            call.resolve(payload);
        });
    }

    private JSObject apkScanStatus() {
        ApkScanner scanner = apkScanner();
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("scannerAvailable", scanner.isAvailable());
        result.put("signatureVersion", scanner.getDatabaseVersion());
        result.put("signatureSource", scanner.getDatabaseSource());
        result.put("signatureGeneratedAt", scanner.getDatabaseGeneratedAt());
        result.put("signatureExpiresAt", scanner.getDatabaseExpiresAt());
        result.put("signatureUpdateStatus", scanner.getUpdateStatus());
        result.put("signatureUpdateMessage", scanner.getUpdateMessage());
        result.put("signatureLastUpdateAt", scanner.getLastUpdateAt());
        result.put(
            "scannerMessage",
            scanner.isAvailable() ? "Offline APK scanner ready." : scanner.getDatabaseError()
        );
        result.put("scanHistory", toJsArray(scanner.getScanHistory()));
        result.put("quarantine", toJsArray(scanner.getQuarantineMetadata()));
        result.put("quarantineBytes", scanner.getQuarantineBytes());

        JSONObject lastScan = scanner.getLastScan();
        if (lastScan != null) {
            result.put("lastScan", toJsObject(lastScan));
        }
        return result;
    }

    private JSArray toJsArray(org.json.JSONArray json) {
        JSArray result = new JSArray();
        for (int index = 0; index < json.length(); index++) {
            JSONObject entry = json.optJSONObject(index);
            if (entry != null) {
                result.put(toJsObject(entry));
            }
        }
        return result;
    }

    private synchronized ApkScanner apkScanner() {
        if (apkScanner == null) {
            apkScanner = new ApkScanner(getContext());
        }
        return apkScanner;
    }

    private synchronized AiShieldManager aiShield() {
        if (aiShieldManager == null) {
            aiShieldManager = new AiShieldManager(
                getContext(),
                analysis -> notifyListeners("aiShieldResult", toJsObject(analysis.toJson()))
            );
        }
        return aiShieldManager;
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

    @Override
    protected void handleOnPause() {
        if (aiShieldManager != null) {
            aiShieldManager.handlePause();
        }
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        if (aiShieldManager != null) {
            aiShieldManager.handleDestroy();
        }
        if (apkScannerExecutor != null) {
            apkScannerExecutor.shutdownNow();
            apkScannerExecutor = null;
        }
        super.handleOnDestroy();
    }
}