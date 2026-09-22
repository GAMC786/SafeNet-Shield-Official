package com.safenet.dns;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.app.role.RoleManager;
import android.provider.Settings;
import android.provider.OpenableColumns;
import android.webkit.CookieManager;
import android.util.Base64;
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
import java.util.HashSet;
import java.util.Set;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "SafeNetVpn",
    permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        @Permission(alias = "nearbyWifi", strings = { Manifest.permission.NEARBY_WIFI_DEVICES }),
        @Permission(alias = "wifiLocation", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class SafeNetVpnPlugin extends Plugin {
    // These Android Private DNS identifiers are runtime-stable, but are not
    // exposed as compile-time constants by every pinned SDK platform.
    private static final String PRIVATE_DNS_MODE = "private_dns_mode";
    private static final String PRIVATE_DNS_SPECIFIER = "private_dns_specifier";
    private static final String ACTION_PRIVATE_DNS_SETTINGS =
        "android.settings.PRIVATE_DNS_SETTINGS";
    private ExecutorService apkScannerExecutor;
    private ApkScanner apkScanner;
    private AiShieldManager aiShieldManager;
    private static final String STATE_PROJECTION_PENDING = "safenet_projection_pending";
    private static final String STATE_PROJECTION_RESULT_DELIVERED =
        "safenet_projection_result_delivered";
    private static final String ROLE_CALLBACK = "callScreeningRoleResult";
    private boolean projectionRequestPending;
    private boolean projectionResultDelivered;

    @PluginMethod
    public void getCallScreeningStatus(PluginCall call) {
        call.resolve(callScreeningStatus());
    }

    @PluginMethod
    public void getAppLockStatus(PluginCall call) {
        call.resolve(AppLockManager.status(getContext()));
    }

    @PluginMethod
    public void setAppLockEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (!enabled && !AppLockManager.isEnabled(getContext())) {
            call.resolve(AppLockManager.status(getContext()));
            return;
        }
        String mode;
        if (!enabled) {
            mode = AppLockManager.MODE_DISABLE;
        } else if (!AppLockManager.hasPin(getContext())) {
            mode = AppLockManager.MODE_SETUP;
        } else {
            mode = "enable";
        }
        startAppLockActivity(call, mode);
    }

    @PluginMethod
    public void unlockAppLock(PluginCall call) {
        if (!AppLockManager.isEnabled(getContext())) {
            call.resolve(AppLockManager.status(getContext()));
            return;
        }
        startAppLockActivity(call, AppLockManager.MODE_UNLOCK);
    }

    @PluginMethod
    public void lockAppNow(PluginCall call) {
        if (!AppLockManager.isEnabled(getContext())) {
            call.resolve(AppLockManager.status(getContext()));
            return;
        }
        AppLockManager.clearSession();
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).lockAppNow();
        }
        call.resolve(AppLockManager.status(getContext()));
    }

    private void startAppLockActivity(PluginCall call, String mode) {
        if (getActivity() == null) {
            call.reject("Secure App Lock is unavailable.", "APP_LOCK_UNAVAILABLE");
            return;
        }
        Intent intent = new Intent(getContext(), LockLockActivity.class)
            .putExtra(AppLockManager.EXTRA_MODE, mode)
            .putExtra(AppLockManager.EXTRA_LOCKED_PACKAGE, getContext().getPackageName());
        startActivityForResult(call, intent, "appLockActivityResult");
    }

    @ActivityCallback
    private void appLockActivityResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() == Activity.RESULT_OK) {
            call.resolve(AppLockManager.status(getContext()));
        } else {
            call.reject(
                "Secure App Lock was not changed.",
                "APP_LOCK_AUTHENTICATION_FAILED"
            );
        }
    }

    @PluginMethod
    public void requestCallScreeningRole(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(callScreeningStatus());
            return;
        }
        RoleManager roleManager = getContext().getSystemService(RoleManager.class);
        if (roleManager == null || !roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
            call.resolve(callScreeningStatus());
            return;
        }
        if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
            call.resolve(callScreeningStatus());
            return;
        }
        startActivityForResult(call, roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING), ROLE_CALLBACK);
    }

    @PluginMethod
    public void openCallScreeningSettings(PluginCall call) {
        Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
        try {
            startActivityForResult(call, settingsIntent, "callScreeningSettingsResult");
        } catch (RuntimeException error) {
            call.reject(
                "Android call-screening settings could not be opened.",
                "CALL_SCREENING_SETTINGS_UNAVAILABLE",
                error
            );
        }
    }

    @PluginMethod
    public void setCallScreeningEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        getContext().getSharedPreferences(
            SafeNetCallScreeningService.PREFS_NAME,
            android.content.Context.MODE_PRIVATE
        ).edit()
            .putBoolean(SafeNetCallScreeningService.PREF_ENABLED, enabled)
            .apply();
        call.resolve(callScreeningStatus());
    }

    @ActivityCallback
    private void callScreeningRoleResult(PluginCall call, ActivityResult result) {
        if (call != null) {
            call.resolve(callScreeningStatus());
        }
    }

    @ActivityCallback
    private void callScreeningSettingsResult(PluginCall call, ActivityResult result) {
        if (call != null) {
            call.resolve(callScreeningStatus());
        }
    }

    @PluginMethod
    public void syncCallScreeningConfig(PluginCall call) {
        JSArray numbers = call.getArray("blockedNumbers", new JSArray());
        Set<String> normalized = new HashSet<>();
        for (int index = 0; index < numbers.length(); index++) {
            String value = numbers.optString(index, "");
            String number = SafeNetCallScreeningService.normalizeNumber(value);
            if (number != null) normalized.add(number);
        }
        String apiOrigin = getConfigApiOrigin();
        String authCookie = apiOrigin.isEmpty() ? "" : CookieManager.getInstance().getCookie(apiOrigin);
        getContext().getSharedPreferences(
            SafeNetCallScreeningService.PREFS_NAME,
            android.content.Context.MODE_PRIVATE
        ).edit()
            .putString(SafeNetCallScreeningService.PREF_API_ORIGIN, apiOrigin)
            .putString(SafeNetCallScreeningService.PREF_AUTH_COOKIE, authCookie == null ? "" : authCookie)
            .putStringSet(SafeNetCallScreeningService.PREF_BLOCKED_NUMBERS, normalized)
            .apply();
        call.resolve(callScreeningStatus());
    }

    private JSObject callScreeningStatus() {
        JSObject result = new JSObject();
        boolean roleAvailable = false;
        boolean roleHeld = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roleManager = getContext().getSystemService(RoleManager.class);
            if (roleManager != null) {
                roleAvailable = roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING);
                roleHeld = roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING);
            }
        }
        result.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M);
        result.put("roleAvailable", roleAvailable);
        result.put("roleHeld", roleHeld);
        boolean locallyEnabled = getContext().getSharedPreferences(
            SafeNetCallScreeningService.PREFS_NAME,
            android.content.Context.MODE_PRIVATE
        ).getBoolean(SafeNetCallScreeningService.PREF_ENABLED, true);
        result.put("enabled", roleHeld && locallyEnabled);
        result.put("serviceRegistered", true);
        result.put("apiConfigured", !getConfigApiOrigin().isEmpty());
        result.put(
            "offlineReputationAvailable",
            SafeNetCallScreeningService.hasBundledCallShieldFeed(getContext())
        );
        result.put(
            "blockedNumberCount",
            SafeNetCallScreeningService.readBlockedNumbers(
                getContext().getSharedPreferences(
                    SafeNetCallScreeningService.PREFS_NAME,
                    android.content.Context.MODE_PRIVATE
                )
            ).size()
        );
        result.put("message", roleHeld
            ? "SafeNet is the Android call-screening provider."
            : roleAvailable
                ? "Android can grant SafeNet call-screening access."
                : "This Android version does not expose the call-screening role.");
        return result;
    }

    @PluginMethod
    public void getTetherStatus(PluginCall call) {
        call.resolve(tetherStatus());
    }

    @PluginMethod
    public void startTetherShare(PluginCall call) {
        String mode = call.getString(
            "mode",
            TetherShareManager.MODE_WIFI_DIRECT
        );
        boolean requiresNearbyPermission =
            TetherShareManager.MODE_WIFI_DIRECT.equals(mode) && !tetherPermissionGranted();
        if (requiresNearbyPermission) {
            if (Build.VERSION.SDK_INT >= 33 && getPermissionState("nearbyWifi") != PermissionState.GRANTED) {
                requestPermissionForAlias("nearbyWifi", call, "tetherPermissionResult");
            } else {
                requestPermissionForAlias("wifiLocation", call, "tetherPermissionResult");
            }
            return;
        }
        try {
            startTetherService(mode);
            call.resolve(tetherStatus());
        } catch (RuntimeException error) {
            call.reject(
                "Android could not start Internet Share.",
                "TETHER_START_FAILED",
                error
            );
        }
    }

    @PermissionCallback
    private void tetherPermissionResult(PluginCall call) {
        if (call == null) return;
        if (!tetherPermissionGranted()) {
            TetherShareManager.get(getContext()).fail(
                "Nearby Wi-Fi permission is required. Allow Nearby devices in Android app settings, then return to SafeNet."
            );
            call.reject("Nearby Wi-Fi permission was denied.", "TETHER_PERMISSION_DENIED");
            return;
        }
        try {
            startTetherService(call.getString("mode", TetherShareManager.MODE_WIFI_DIRECT));
            call.resolve(tetherStatus());
        } catch (RuntimeException error) {
            call.reject(
                "Android could not start Internet Share.",
                "TETHER_START_FAILED",
                error
            );
        }
    }

    @PluginMethod
    public void stopTetherShare(PluginCall call) {
        TetherShareManager.get(getContext()).stop();
        getContext().stopService(new Intent(getContext(), TetherShareService.class).setAction(TetherShareService.ACTION_STOP));
        call.resolve(tetherStatus());
    }

    @PluginMethod
    public void openTetherWifiSettings(PluginCall call) {
        Intent settingsIntent = new Intent(android.provider.Settings.ACTION_WIFI_SETTINGS);
        getActivity().startActivity(settingsIntent);
        call.resolve();
    }

    @PluginMethod
    public void openTetherAppSettings(PluginCall call) {
        Intent settingsIntent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.parse("package:" + getContext().getPackageName()));
        try {
            getActivity().startActivity(settingsIntent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Android app permission settings could not be opened.", "TETHER_SETTINGS_FAILED", error);
        }
    }

    private boolean tetherPermissionGranted() {
        if (Build.VERSION.SDK_INT >= 33
                && getPermissionState("nearbyWifi") != PermissionState.GRANTED) {
            return false;
        }
        return Build.VERSION.SDK_INT >= 33
            || getPermissionState("wifiLocation") == PermissionState.GRANTED;
    }

    private void startTetherService() {
        startTetherService(TetherShareManager.MODE_WIFI_DIRECT);
    }

    private void startTetherService(String mode) {
        Intent serviceIntent = new Intent(getContext(), TetherShareService.class)
            .setAction(TetherShareService.ACTION_START)
            .putExtra(TetherShareManager.EXTRA_MODE, mode);
        if (Build.VERSION.SDK_INT >= 26) {
            getContext().startForegroundService(serviceIntent);
        } else {
            getContext().startService(serviceIntent);
        }
    }

    private JSObject tetherStatus() {
        TetherShareManager.Snapshot snapshot = TetherShareManager.get(getContext()).snapshot();
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("running", snapshot.running);
        result.put("starting", snapshot.starting);
        result.put("networkName", snapshot.networkName);
        result.put("passphrase", snapshot.passphrase);
        result.put("credentialSource", snapshot.credentialSource);
        result.put("proxyHost", snapshot.proxyHost);
        result.put("proxyPort", snapshot.proxyPort);
        result.put("httpProxyPort", snapshot.httpProxyPort);
        result.put("socksProxyPort", snapshot.socksProxyPort);
        result.put("httpProxySupported", snapshot.httpProxyPort > 0);
        result.put("socksProxySupported", snapshot.socksProxyPort > 0);
        result.put("groupOwner", snapshot.groupOwner);
        result.put("mode", snapshot.mode);
        result.put("permissionGranted", tetherPermissionGranted());
        result.put("lastError", snapshot.lastError);
        result.put("requiresManualProxy", true);
        JSArray connectedDevices = new JSArray();
        for (TetherShareManager.DeviceSnapshot device : snapshot.devices) {
            JSObject connectedDevice = new JSObject();
            connectedDevice.put("name", device.name);
            connectedDevice.put("address", device.address);
            connectedDevices.put(connectedDevice);
        }
        result.put("connectedDevices", connectedDevices);
        return result;
    }

    @PluginMethod
    public void getProtectionStatus(PluginCall call) {
        call.resolve(
            toJsObject(
                SafeNetProtectionStatus.get(
                    getContext(),
                    call.getString("expectedHostname", null)
                )
            )
        );
    }

    @PluginMethod
    public void getPrivateDnsStatus(PluginCall call) {
        call.resolve(privateDnsStatus(call.getString("expectedHostname", "")));
    }

    @PluginMethod
    public void openPrivateDnsSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            call.resolve(privateDnsStatus(call.getString("expectedHostname", "")));
            return;
        }
        Intent settingsIntent = new Intent(ACTION_PRIVATE_DNS_SETTINGS);
        try {
            startActivityForResult(call, settingsIntent, "privateDnsSettingsResult");
        } catch (RuntimeException error) {
            call.reject(
                "Android Private DNS settings could not be opened.",
                "PRIVATE_DNS_SETTINGS_UNAVAILABLE",
                error
            );
        }
    }

    @ActivityCallback
    private void privateDnsSettingsResult(PluginCall call, ActivityResult result) {
        if (call != null) {
            call.resolve(privateDnsStatus(call.getString("expectedHostname", "")));
        }
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
            JSObject result = new JSObject();
            result.put("synced", true);
            result.put("firewallEnabled", config.optBoolean("firewallEnabled", false));
            call.resolve(result);
        } catch (org.json.JSONException error) {
            call.reject("The firewall configuration is invalid.", "FIREWALL_CONFIG_INVALID");
        } catch (IllegalStateException error) {
            call.reject(error.getMessage(), "FIREWALL_CONFIG_NOT_SAVED");
        }
    }

    private JSObject privateDnsStatus(String expectedHostname) {
        SafeNetPrivateDnsTileService.rememberExpectedHostname(getContext(), expectedHostname);
        JSObject result = new JSObject();
        String expected = normalizePrivateDnsHostname(expectedHostname);
        result.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P);
        result.put("expectedHostname", expected == null ? JSONObject.NULL : expected);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            result.put("running", false);
            result.put("mode", "unknown");
            result.put("hostname", JSONObject.NULL);
            result.put("message", "Android Private DNS requires Android 9 or newer.");
            result.put("error", "Android Private DNS is unavailable on this Android version.");
            return result;
        }

        try {
            String modeValue = Settings.Global.getString(
                getContext().getContentResolver(),
                PRIVATE_DNS_MODE
            );
            String hostname = Settings.Global.getString(
                getContext().getContentResolver(),
                PRIVATE_DNS_SPECIFIER
            );
            String mode = "hostname".equals(modeValue)
                ? "hostname"
                : "opportunistic".equals(modeValue)
                    ? "automatic"
                    : "off".equals(modeValue)
                        ? "off"
                        : "unknown";
            String normalizedHostname = normalizePrivateDnsHostname(hostname);
            boolean running = "hostname".equals(mode)
                && expected != null
                && expected.equals(normalizedHostname);
            result.put("running", running);
            result.put("mode", mode);
            result.put("hostname", normalizedHostname == null ? JSONObject.NULL : normalizedHostname);
            result.put("message", privateDnsMessage(mode, normalizedHostname, expected, running));
            return result;
        } catch (SecurityException error) {
            result.put("running", false);
            result.put("mode", "unknown");
            result.put("hostname", JSONObject.NULL);
            result.put("message", "Android did not expose the current Private DNS setting.");
            result.put("error", "Android Private DNS status is unavailable.");
            return result;
        }
    }

    private static String privateDnsMessage(
        String mode,
        String hostname,
        String expected,
        boolean running
    ) {
        if (running) {
            return "SafeNet Private DNS is active for " + expected + ".";
        }
        if ("hostname".equals(mode) && hostname != null) {
            return "Another Private DNS hostname is active: " + hostname + ".";
        }
        if ("automatic".equals(mode)) {
            return "Android is using automatic Private DNS. Select the SafeNet hostname to enable protection.";
        }
        if ("off".equals(mode)) {
            return "Private DNS is off. Open Android settings to select the SafeNet hostname.";
        }
        return "Open Android Private DNS settings to select the SafeNet hostname.";
    }

    private static String normalizePrivateDnsHostname(String value) {
        if (value == null) return null;
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
        synchronized (this) {
            if (projectionRequestPending) {
                call.reject(
                    "A screen-capture consent request is already pending.",
                    "SCREEN_CONSENT_PENDING"
                );
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
            if (!aiShield().isModelAvailable()) {
                call.resolve(toJsObject(aiShield().getStatus()));
                return;
            }
            // Keep the cleanup and state transition together so concurrent
            // bridge calls cannot both replace the active capture.
            aiShield().prepareForScreenConsent();
            projectionRequestPending = true;
            projectionResultDelivered = false;
            startActivityForResult(
                call,
                projectionManager.createScreenCaptureIntent(),
                "aiShieldProjectionResult"
            );
        }
    }

    @ActivityCallback
    private void aiShieldProjectionResult(PluginCall call, ActivityResult result) {
        synchronized (this) {
            if (call == null || !projectionRequestPending || projectionResultDelivered) {
                return;
            }
            projectionResultDelivered = true;
            projectionRequestPending = false;
        }
        try {
            int resultCode = result == null ? Activity.RESULT_CANCELED : result.getResultCode();
            Intent data = result == null ? null : result.getData();
            aiShield().startScreen(resultCode, data);
            call.resolve(toJsObject(aiShield().getStatus()));
        } finally {
            getBridge().releaseCall(call);
        }
    }

    @PluginMethod
    public void stopAiShield(PluginCall call) {
        aiShield().stop();
        call.resolve(toJsObject(aiShield().getStatus()));
    }

    @PluginMethod
    public void setAiShieldCloudUploadEnabled(PluginCall call) {
        aiShield().setCloudUploadEnabled(call.getBoolean("enabled", false));
        call.resolve();
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
                analysis -> notifyListeners("aiShieldResult", toJsObject(analysis.toJson())),
                (source, jpegBytes) -> {
                    JSObject frame = new JSObject();
                    frame.put("source", source);
                    frame.put("imageBase64", Base64.encodeToString(jpegBytes, Base64.NO_WRAP));
                    notifyListeners("aiShieldFrame", frame);
                }
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

    @Override
    protected Bundle saveInstanceState() {
        Bundle state = super.saveInstanceState();
        synchronized (this) {
            if (state == null && !projectionRequestPending) {
                return null;
            }
            if (state == null) {
                state = new Bundle();
            }
            state.putBoolean(STATE_PROJECTION_PENDING, projectionRequestPending);
            state.putBoolean(STATE_PROJECTION_RESULT_DELIVERED, projectionResultDelivered);
        }
        return state;
    }

    @Override
    protected void restoreState(Bundle state) {
        super.restoreState(state);
        if (state == null) {
            return;
        }
        synchronized (this) {
            projectionRequestPending = state.getBoolean(STATE_PROJECTION_PENDING, false);
            projectionResultDelivered = state.getBoolean(STATE_PROJECTION_RESULT_DELIVERED, false);
        }
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