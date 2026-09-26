package com.safenet.dns;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import com.wireguard.config.BadConfigException;
import com.wireguard.config.Config;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;

final class WindscribeProfileStore {
    private static final String PREFERENCES_FILE = "windscribe_wireguard_profile";
    private static final String CONFIG_KEY = "config";
    private static final int MAX_PROFILE_BYTES = 64 * 1024;
    private final Context context;
    private volatile SharedPreferences cachedPreferences;

    WindscribeProfileStore(Context context) {
        this.context = context.getApplicationContext();
    }

    boolean hasProfile() {
        return preferences().contains(CONFIG_KEY);
    }

    String readProfile() {
        return preferences().getString(CONFIG_KEY, null);
    }

    void saveProfile(String config) {
        if (!preferences().edit().putString(CONFIG_KEY, config).commit()) {
            throw new IllegalStateException("Could not save the encrypted Windscribe profile.");
        }
    }

    void clearProfile() {
        if (!preferences().edit().remove(CONFIG_KEY).commit()) {
            throw new IllegalStateException("Could not remove the encrypted Windscribe profile.");
        }
    }

    static Config parseProfile(String text) throws IOException, BadConfigException {
        if (text == null || text.trim().isEmpty()
                || text.getBytes(StandardCharsets.UTF_8).length > MAX_PROFILE_BYTES) {
            throw new IllegalArgumentException("WireGuard profile is empty or too large.");
        }
        Config config = Config.parse(
                new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
        if (config.getPeers().isEmpty()) {
            throw new IllegalArgumentException("WireGuard profile has no peer.");
        }
        return config;
    }

    private SharedPreferences preferences() {
        SharedPreferences preferences = cachedPreferences;
        if (preferences != null) return preferences;
        synchronized (this) {
            preferences = cachedPreferences;
            if (preferences != null) return preferences;
            try {
                MasterKey masterKey = new MasterKey.Builder(context)
                        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                        .build();
                preferences = EncryptedSharedPreferences.create(
                        context,
                        PREFERENCES_FILE,
                        masterKey,
                        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
                cachedPreferences = preferences;
                return preferences;
            } catch (GeneralSecurityException | IOException e) {
                throw new IllegalStateException("Encrypted Windscribe profile storage is unavailable.", e);
            }
        }
    }
}