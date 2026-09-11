package com.safenet.dns;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.net.VpnService;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.webkit.CookieManager;
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
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
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
    static final String PREF_RESOLVER_TYPE = "resolver_type";
    static final String PREF_RESOLVER_IP_VERSION = "resolver_ip_version";
    static final String PREF_RESOLVER_PRIMARY = "resolver_primary";
    static final String PREF_RESOLVER_SECONDARY = "resolver_secondary";
    static final String PREF_WIREGUARD_DNS_SERVERS = "wireguard_dns_servers";
    static final String PREF_ACTIVE_TUNNEL = "active_tunnel";
    static final String TUNNEL_DNS = "dns";
    static final String TUNNEL_WIREGUARD = "wireguard";
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
        result.put("firewallEnabled", SafeNetVpnService.isFirewallEnabled());
        result.put("permissionGranted", VpnService.prepare(getContext()) == null);
        result.put("eulaVersion", EULA_VERSION);
        result.put("eulaAccepted", hasAcceptedEula());
        boolean wireGuardConfigured = SafeNetWireGuardConfig.isCoreConfigured();
        boolean wireGuardRunning = false;
        if (wireGuardConfigured) {
            wireGuardRunning = SafeNetWireGuardManager.get(getContext()).isRunning();
        }
        result.put("wireguardConfigured", wireGuardConfigured);
        result.put("wireguardRunning", wireGuardRunning);
        result.put("activeTunnel", wireGuardRunning
            ? TUNNEL_WIREGUARD
            : SafeNetVpnService.isRunning() ? TUNNEL_DNS : "none");
        result.put("vpnPermissionOwner", wireGuardRunning
            ? "SafeNet WireGuard"
            : SafeNetVpnService.isRunning() ? "SafeNet DNS" : "none");
        if (wireGuardConfigured) {
            result.put("wireguardGateway", SafeNetWireGuardConfig.gatewayEndpoint());
            result.put("wireguardGatewayOwner", SafeNetWireGuardConfig.gatewayOwner());
            result.put("wireguardPeerPublicKey", SafeNetWireGuardConfig.peerPublicKey());
            result.put("wireguardAllowedIps", SafeNetWireGuardConfig.allowedIps());
            result.put(
                "wireguardDnsServers",
                preferences().getString(
                    PREF_WIREGUARD_DNS_SERVERS,
                    SafeNetWireGuardConfig.defaultDnsServers()
                )
            );
            String wireGuardError = SafeNetWireGuardManager.get(getContext()).getLastError();
            if (wireGuardError != null && !wireGuardError.trim().isEmpty()) {
                result.put("wireguardError", wireGuardError);
            }
        } else {
            result.put("wireguardError", SafeNetWireGuardConfig.validationError());
        }
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
    public void syncFirewallConfig(PluginCall call) {
        JSObject config = call.getObject("config");
        if (config == null) {
            call.reject("A firewall configuration is required.", "FIREWALL_CONFIG_REQUIRED");
            return;
        }
        try {
            String serialized = config.toString();
            FirewallConfigStore.save(getContext(), serialized);
            SafeNetVpnService.updateFirewallConfig(serialized);
            JSObject result = new JSObject();
            result.put("synced", true);
            result.put("firewallEnabled", SafeNetVpnService.isFirewallEnabled());
            call.resolve(result);
        } catch (org.json.JSONException error) {
            call.reject("The firewall configuration is invalid.", "FIREWALL_CONFIG_INVALID");
        } catch (IllegalStateException error) {
            call.reject(error.getMessage(), "FIREWALL_CONFIG_NOT_SAVED");
        }
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
        String ipVersion = call.getString("ipVersion", "ipv4");
        String primaryAddress = call.getString("primaryAddress", "");
        String secondaryAddress = call.getString("secondaryAddress", "");
        if (primaryAddress == null || primaryAddress.trim().isEmpty()) {
            call.reject("Select an active DNS server before starting protection.", "DNS_REQUIRED");
            return;
        }
        if (SafeNetWireGuardConfig.isCoreConfigured()
                && SafeNetWireGuardManager.get(getContext()).isRunning()) {
            call.reject(
                "SafeNet WireGuard already owns Android's VPN permission. Stop it before starting DNS protection.",
                "VPN_CONFLICT"
            );
            return;
        }

        rememberResolver(type, ipVersion, primaryAddress, secondaryAddress);
        Intent serviceIntent = createServiceIntent(type, ipVersion, primaryAddress, secondaryAddress);
        Intent permissionIntent = VpnService.prepare(getContext());
        if (permissionIntent != null) {
            startActivityForResult(call, permissionIntent, "vpnPermissionResult");
            return;
        }

        startVpnService(serviceIntent);
        resolveWhenStarted(call);
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
        String ipVersion = call.getString("ipVersion", "ipv4");
        String primaryAddress = call.getString("primaryAddress", "");
        String secondaryAddress = call.getString("secondaryAddress", "");
        rememberResolver(type, ipVersion, primaryAddress, secondaryAddress);
        startVpnService(createServiceIntent(type, ipVersion, primaryAddress, secondaryAddress));
        resolveWhenStarted(call);
    }

    @PluginMethod
    public void startWireGuard(PluginCall call) {
        if (!SafeNetWireGuardConfig.isCoreConfigured()) {
            call.reject(
                SafeNetWireGuardConfig.validationError(),
                "WIREGUARD_NOT_CONFIGURED"
            );
            return;
        }
        String selectedDnsServers = call.getString("dnsServers", "");
        if (selectedDnsServers == null || selectedDnsServers.trim().isEmpty()) {
            selectedDnsServers = preferences().getString(
                PREF_WIREGUARD_DNS_SERVERS,
                SafeNetWireGuardConfig.defaultDnsServers()
            );
        }
        try {
            selectedDnsServers = SafeNetWireGuardConfig.normalizeDnsServers(selectedDnsServers);
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), "WIREGUARD_DNS_REQUIRED");
            return;
        }
        if (SafeNetVpnService.isRunning()) {
            call.reject(
                "SafeNet DNS protection already owns Android's VPN permission. Stop it before starting WireGuard.",
                "VPN_CONFLICT"
            );
            return;
        }

        Intent permissionIntent = VpnService.prepare(getContext());
        if (permissionIntent != null) {
            startActivityForResult(call, permissionIntent, "wireGuardPermissionResult");
            return;
        }
        startWireGuardAsync(call);
    }

    @ActivityCallback
    private void wireGuardPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result == null || result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Android VPN permission was not granted to SafeNet.", "PERMISSION_DENIED");
            return;
        }
        startWireGuardAsync(call);
    }

    private void startWireGuardAsync(PluginCall call) {
        String selectedDnsServers;
        try {
            selectedDnsServers = resolveWireGuardDnsServers(call);
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), "WIREGUARD_DNS_REQUIRED");
            return;
        }
        SafeNetWireGuardManager.get(getContext()).startAsync(
            selectedDnsServers,
            () -> {
                preferences().edit()
                    .putString(PREF_ACTIVE_TUNNEL, TUNNEL_WIREGUARD)
                    .putString(PREF_WIREGUARD_DNS_SERVERS, selectedDnsServers)
                    .apply();
                call.resolve(status());
            },
            error -> call.reject(
                safeError(error, "SafeNet WireGuard could not start."),
                "WIREGUARD_START_FAILED"
            )
        );
    }

    private String resolveWireGuardDnsServers(PluginCall call) {
        String selectedDnsServers = call.getString("dnsServers", "");
        if (selectedDnsServers == null || selectedDnsServers.trim().isEmpty()) {
            selectedDnsServers = preferences().getString(
                PREF_WIREGUARD_DNS_SERVERS,
                SafeNetWireGuardConfig.defaultDnsServers()
            );
        }
        return SafeNetWireGuardConfig.normalizeDnsServers(selectedDnsServers);
    }

    @PluginMethod
    public void stopWireGuard(PluginCall call) {
        if (!SafeNetWireGuardConfig.isCoreConfigured()) {
            call.resolve(status());
            return;
        }
        SafeNetWireGuardManager.get(getContext()).stopAsync(
            () -> call.resolve(status()),
            error -> call.reject(
                safeError(error, "SafeNet WireGuard could not stop."),
                "WIREGUARD_STOP_FAILED"
            )
        );
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (SafeNetWireGuardConfig.isCoreConfigured()
                && SafeNetWireGuardManager.get(getContext()).isRunning()) {
            stopWireGuard(call);
            return;
        }
        SafeNetVpnService.requestStop();
        getContext().stopService(new Intent(getContext(), SafeNetVpnService.class));
        call.resolve(status());
    }

    private void startVpnService(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
    }

    private void rememberResolver(
        String type,
        String ipVersion,
        String primaryAddress,
        String secondaryAddress
    ) {
        preferences().edit()
            .putString(PREF_RESOLVER_TYPE, type)
            .putString(PREF_RESOLVER_IP_VERSION, ipVersion)
            .putString(PREF_RESOLVER_PRIMARY, primaryAddress)
            .putString(PREF_RESOLVER_SECONDARY, secondaryAddress == null ? "" : secondaryAddress)
            .putString(PREF_ACTIVE_TUNNEL, TUNNEL_DNS)
            .apply();
    }

    private String safeError(Exception error, String fallback) {
        String message = error == null ? null : error.getMessage();
        return message == null || message.trim().isEmpty() ? fallback : message;
    }

    private void resolveWhenStarted(PluginCall call) {
        Handler handler = new Handler(Looper.getMainLooper());
        long deadline = System.currentTimeMillis() + 10_000L;
        Runnable[] poll = new Runnable[1];
        poll[0] = () -> {
            JSObject current = status();
            if (SafeNetVpnService.isRunning()) {
                call.resolve(current);
                return;
            }

            String error = SafeNetVpnService.getLastError();
            if (error != null && !error.trim().isEmpty()) {
                call.reject(error, "VPN_START_FAILED");
                return;
            }

            if (System.currentTimeMillis() >= deadline) {
                call.reject(
                    "Android did not report the DNS VPN as running.",
                    "VPN_START_TIMEOUT"
                );
                return;
            }
            handler.postDelayed(poll[0], 100L);
        };
        handler.post(poll[0]);
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
        if (!aiShield().isModelAvailable()) {
            call.resolve(toJsObject(aiShield().getStatus()));
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

    private Intent createServiceIntent(String type, String ipVersion, String primaryAddress, String secondaryAddress) {
        String apiOrigin = getConfigApiOrigin();
        return new Intent(getContext(), SafeNetVpnService.class)
            .putExtra(SafeNetVpnService.EXTRA_TYPE, type)
            .putExtra(SafeNetVpnService.EXTRA_IP_VERSION, ipVersion)
            .putExtra(SafeNetVpnService.EXTRA_PRIMARY, primaryAddress)
            .putExtra(SafeNetVpnService.EXTRA_SECONDARY, secondaryAddress == null ? "" : secondaryAddress)
            .putExtra(SafeNetVpnService.EXTRA_API_ORIGIN, apiOrigin)
            .putExtra(SafeNetVpnService.EXTRA_AUTH_COOKIE, apiOrigin.isEmpty()
                ? "" : CookieManager.getInstance().getCookie(apiOrigin));
    }

    private String getConfigApiOrigin() {
        try (InputStream input = getContext().getAssets().open("public/mobile-build.json");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int length;
            while ((length = input.read(buffer)) != -1) {
                output.write(buffer, 0, length);
            }
            return new JSONObject(output.toString(java.nio.charset.StandardCharsets.UTF_8.name()))
                .optString("apiOrigin", "")
                .trim();
        } catch (Exception ignored) {
            return "";
        }
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
            aiShieldManager = null;
        }
        if (apkScannerExecutor != null) {
            apkScannerExecutor.shutdownNow();
            apkScannerExecutor = null;
        }
        super.handleOnDestroy();
    }
}