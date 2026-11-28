package com.safenet.dns;

import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "SafeNetAuthStorage")
public class SafeNetAuthStoragePlugin extends Plugin {
    private static final String PREFS_NAME = "safenet_auth_secure";
    private static final Set<String> ALLOWED_KEYS = new HashSet<>(Arrays.asList(
        "better_auth_token",
        "pkce_state",
        "pkce_verifier",
        "mobile_auth_challenge"
    ));

    private SharedPreferences getSecurePreferences() throws Exception {
        MasterKey masterKey = new MasterKey.Builder(getContext())
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build();
        return EncryptedSharedPreferences.create(
            getContext(),
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        );
    }

    private String validateKey(PluginCall call) {
        String key = call.getString("key", "");
        if (!ALLOWED_KEYS.contains(key)) {
            call.reject("Unsupported authentication storage key.");
            return null;
        }
        return key;
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = validateKey(call);
        if (key == null) return;
        try {
            JSObject result = new JSObject();
            result.put("value", getSecurePreferences().getString(key, null));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Secure authentication storage is unavailable.", error);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = validateKey(call);
        if (key == null) return;
        String value = call.getString("value");
        if (value == null || value.length() > 8192) {
            call.reject("Authentication storage value is invalid.");
            return;
        }
        try {
            getSecurePreferences().edit().putString(key, value).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("Secure authentication storage is unavailable.", error);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = validateKey(call);
        if (key == null) return;
        try {
            getSecurePreferences().edit().remove(key).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("Secure authentication storage is unavailable.", error);
        }
    }
}
