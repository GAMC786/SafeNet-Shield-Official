package com.safenet.dns;

import android.Manifest;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Telephony;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PluginMethod;
import java.util.List;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "SafeNetSmsFilter",
    permissions = {
        @Permission(
            alias = "sms",
            strings = {
                Manifest.permission.READ_SMS,
                Manifest.permission.RECEIVE_SMS,
                Manifest.permission.SEND_SMS
            }
        )
    }
)
public final class SafeNetSmsPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestDefaultSmsApp(PluginCall call) {
        JSObject current = status();
        if (current.optBoolean("roleHeld", false)) {
            call.resolve(current);
            return;
        }
        if (!current.optBoolean("roleAvailable", false)) {
            call.reject("Android does not offer a default SMS app selection on this device.");
            return;
        }

        Intent request;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roleManager = getContext().getSystemService(RoleManager.class);
            if (roleManager == null || !roleManager.isRoleAvailable(RoleManager.ROLE_SMS)) {
                call.reject("The Android SMS role is unavailable.");
                return;
            }
            request = roleManager.createRequestRoleIntent(RoleManager.ROLE_SMS);
        } else {
            request = new Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT)
                .putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, getContext().getPackageName());
        }
        try {
            startActivityForResult(call, request, "smsRoleResult");
        } catch (RuntimeException error) {
            call.reject("Android could not open default SMS app settings.", "SMS_ROLE_UNAVAILABLE", error);
        }
    }

    @ActivityCallback
    private void smsRoleResult(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve(status());
    }

    @PluginMethod
    public void requestSmsPermissions(PluginCall call) {
        if (!status().optBoolean("roleHeld", false)) {
            call.reject("Choose SafeNet as the default SMS app before granting SMS access.");
            return;
        }
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            call.resolve(status());
            return;
        }
        requestPermissionForAlias("sms", call, "smsPermissionResult");
    }

    @PermissionCallback
    private void smsPermissionResult(PluginCall call) {
        if (call != null) call.resolve(status());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (enabled && (!status().optBoolean("roleHeld", false) ||
            !status().optBoolean("permissionsGranted", false))) {
            call.reject("Select SafeNet as the default SMS app and grant the requested SMS permissions first.");
            return;
        }
        getContext().getSharedPreferences(SafeNetSmsFilter.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(SafeNetSmsFilter.PREF_ENABLED, enabled)
            .apply();
        call.resolve(status());
    }

    @PluginMethod
    public void syncRules(PluginCall call) {
        try {
            List<String> keywords = SafeNetSmsFilter.parseConfigArray(
                call.getArray("keywords", new JSArray()),
                "keywords"
            );
            List<String> regexes = SafeNetSmsFilter.parseConfigArray(
                call.getArray("regexes", new JSArray()),
                "patterns"
            );
            List<String> allowedSenders = SafeNetSmsFilter.parseConfigArray(
                call.getArray("allowedSenders", new JSArray()),
                "allowed senders"
            );
            String error = SafeNetSmsFilter.validateConfig(keywords, regexes, allowedSenders);
            if (error != null) {
                call.reject(error, "SMS_RULES_INVALID");
                return;
            }
            SafeNetSmsFilter.saveConfig(getContext(), keywords, regexes, allowedSenders);
            call.resolve(status());
        } catch (JSONException error) {
            call.reject("SMS filter rules must be text values.", "SMS_RULES_INVALID", error);
        }
    }

    @PluginMethod
    public void getQuarantinedMessages(PluginCall call) {
        JSObject result = new JSObject();
        result.put("messages", SafeNetSmsFilter.readQuarantine(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void getRecentMessages(PluginCall call) {
        if (!status().optBoolean("permissionsGranted", false)) {
            call.reject("Grant SMS access before opening recent messages.", "SMS_PERMISSION_REQUIRED");
            return;
        }
        try {
            JSObject result = new JSObject();
            result.put("messages", SafeNetSmsStore.readRecentInbox(getContext(), 25));
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Android did not allow SafeNet to read the SMS inbox.", "SMS_READ_DENIED", error);
        } catch (JSONException error) {
            call.reject("The recent SMS list could not be read.", "SMS_INBOX_UNAVAILABLE", error);
        }
    }

    @PluginMethod
    public void restoreQuarantinedMessage(PluginCall call) {
        if (!status().optBoolean("roleHeld", false) ||
            !status().optBoolean("permissionsGranted", false)) {
            call.reject("Select SafeNet as the default SMS app and grant SMS access before restoring messages.");
            return;
        }
        String id = call.getString("id", "");
        JSONObject message = SafeNetSmsFilter.findQuarantined(getContext(), id);
        if (message == null) {
            call.reject("This quarantined message is no longer available.", "SMS_MESSAGE_NOT_FOUND");
            return;
        }
        try {
            Uri inserted = SafeNetSmsStore.insertInbox(
                getContext(),
                message.optString("sender", "Unknown sender"),
                message.optString("body", ""),
                message.optLong("receivedAt", System.currentTimeMillis())
            );
            if (inserted == null) throw new IllegalStateException("Android did not accept the restored message.");
            SafeNetSmsFilter.removeQuarantined(getContext(), id);
            call.resolve(status());
        } catch (RuntimeException error) {
            call.reject("The message could not be restored to the Android inbox.", "SMS_RESTORE_FAILED", error);
        }
    }

    @PluginMethod
    public void deleteQuarantinedMessage(PluginCall call) {
        String id = call.getString("id", "");
        if (!SafeNetSmsFilter.removeQuarantined(getContext(), id)) {
            call.reject("This quarantined message is no longer available.", "SMS_MESSAGE_NOT_FOUND");
            return;
        }
        call.resolve(status());
    }

    @PluginMethod
    public void sendMessage(PluginCall call) {
        if (!status().optBoolean("roleHeld", false) ||
            !status().optBoolean("permissionsGranted", false)) {
            call.reject("Select SafeNet as the default SMS app and grant SMS access before sending texts.");
            return;
        }
        String recipient = normalizePhoneNumber(call.getString("recipient", ""));
        String body = call.getString("body", "");
        if (recipient == null) {
            call.reject("Enter a valid phone number with 7 to 15 digits.", "SMS_NUMBER_INVALID");
            return;
        }
        if (body == null || body.trim().isEmpty() || body.length() > 2000) {
            call.reject("Enter a text message of 1 to 2,000 characters.", "SMS_BODY_INVALID");
            return;
        }
        try {
            SafeNetSmsStore.sendText(getContext(), recipient, body);
            JSObject result = new JSObject();
            result.put("accepted", true);
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Android did not allow SafeNet to send this SMS.", "SMS_SEND_DENIED", error);
        } catch (RuntimeException error) {
            call.reject("The SMS could not be sent.", "SMS_SEND_FAILED", error);
        }
    }

    private JSObject status() {
        Context context = getContext();
        JSObject result = new JSObject();
        boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT;
        String defaultPackage = supported ? Telephony.Sms.getDefaultSmsPackage(context) : null;
        boolean roleHeld = context.getPackageName().equals(defaultPackage);
        boolean roleAvailable = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roleManager = context.getSystemService(RoleManager.class);
            roleAvailable = roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_SMS);
        } else if (supported) {
            Intent changeDefault = new Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT);
            roleAvailable = context.getPackageManager().resolveActivity(
                changeDefault,
                PackageManager.MATCH_DEFAULT_ONLY
            ) != null;
        }
        boolean permissionsGranted =
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_SMS) == PackageManager.PERMISSION_GRANTED;
        boolean enabled = context.getSharedPreferences(SafeNetSmsFilter.PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(SafeNetSmsFilter.PREF_ENABLED, false);
        result.put("supported", supported);
        result.put("roleAvailable", roleAvailable);
        result.put("roleHeld", roleHeld);
        result.put("permissionsGranted", permissionsGranted);
        result.put("enabled", enabled);
        result.put("quarantineCount", SafeNetSmsFilter.quarantineCount(context));
        result.put("mmsSupported", false);
        result.put("message", !supported
            ? "This Android version cannot provide the SMS role."
            : !roleAvailable
                ? "Android does not offer a default SMS app selection on this device."
                : !roleHeld
                    ? "SafeNet must be selected as the default SMS app before it can filter incoming texts."
                    : !permissionsGranted
                        ? "Grant SMS access to filter incoming texts and send messages."
                        : "SMS filtering and sending are available. MMS is not supported.");
        return result;
    }

    private static String normalizePhoneNumber(String value) {
        if (value == null) return null;
        String normalized = value.trim().replaceAll("[^0-9+]", "");
        if (!Pattern.matches("\\+?[0-9]{7,15}", normalized)) return null;
        return normalized;
    }
}