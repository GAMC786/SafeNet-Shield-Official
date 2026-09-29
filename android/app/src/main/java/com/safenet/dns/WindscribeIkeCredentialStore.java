package com.safenet.dns;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import java.net.IDN;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Stores Windscribe's generated IKEv2 hostname and credentials using
 * AndroidKeyStore-backed encrypted preferences. Values are never written to
 * the strongSwan SQLite profile database.
 */
final class WindscribeIkeCredentialStore {
    private static final String PREFERENCES_NAME = "windscribe_ikev2_credentials";
    private static final String KEY_HOST = "server_host";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_PASSWORD = "password";
    private static final int MAX_CREDENTIAL_LENGTH = 512;
    private static final Pattern HOSTNAME = Pattern.compile(
            "^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+"
                    + "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$");

    private final SharedPreferences preferences;

    WindscribeIkeCredentialStore(Context context) {
        try {
            MasterKey key = new MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
            preferences = EncryptedSharedPreferences.create(
                    context,
                    PREFERENCES_NAME,
                    key,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception error) {
            throw new IllegalStateException(
                    "Encrypted Windscribe IKEv2 storage is unavailable.", error);
        }
    }

    void save(String serverHost, String username, String password) {
        String normalizedHost = normalizeServerHost(serverHost);
        String normalizedUsername = normalizeCredential(username, "username");
        String normalizedPassword = normalizeCredential(password, "password");
        boolean saved = preferences.edit()
                .putString(KEY_HOST, normalizedHost)
                .putString(KEY_USERNAME, normalizedUsername)
                .putString(KEY_PASSWORD, normalizedPassword)
                .commit();
        if (!saved) {
            throw new IllegalStateException(
                    "Windscribe IKEv2 credentials could not be saved securely.");
        }
    }

    boolean hasCredentials() {
        return preferences.contains(KEY_HOST)
                && preferences.contains(KEY_USERNAME)
                && preferences.contains(KEY_PASSWORD);
    }

    Credentials read() {
        String serverHost = preferences.getString(KEY_HOST, null);
        String username = preferences.getString(KEY_USERNAME, null);
        String password = preferences.getString(KEY_PASSWORD, null);
        if (serverHost == null || username == null || password == null) {
            throw new IllegalStateException(
                    "Enter the Windscribe IKEv2 hostname and generated credentials first.");
        }
        return new Credentials(serverHost, username, password);
    }

    void clear() {
        if (!preferences.edit().clear().commit()) {
            throw new IllegalStateException(
                    "Windscribe IKEv2 credentials could not be removed securely.");
        }
    }

    private static String normalizeServerHost(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Enter the Windscribe IKEv2 server hostname.");
        }
        String host = value.trim();
        if (host.endsWith(".")) {
            host = host.substring(0, host.length() - 1);
        }
        try {
            host = IDN.toASCII(host, IDN.USE_STD3_ASCII_RULES)
                    .toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException(
                    "Enter a valid Windscribe IKEv2 hostname.");
        }
        if (!HOSTNAME.matcher(host).matches()) {
            throw new IllegalArgumentException(
                    "Enter a hostname only, without a scheme, path, or port.");
        }
        return host;
    }

    private static String normalizeCredential(String value, String field) {
        if (value == null) {
            throw new IllegalArgumentException(
                    "Enter the generated Windscribe " + field + ".");
        }
        String credential = value.trim();
        if (credential.isEmpty() || credential.length() > MAX_CREDENTIAL_LENGTH) {
            throw new IllegalArgumentException(
                    "The generated Windscribe " + field + " is invalid.");
        }
        for (int index = 0; index < credential.length(); index++) {
            if (Character.isISOControl(credential.charAt(index))) {
                throw new IllegalArgumentException(
                        "The generated Windscribe " + field + " is invalid.");
            }
        }
        return credential;
    }

    static final class Credentials {
        final String serverHost;
        final String username;
        final String password;

        Credentials(String serverHost, String username, String password) {
            this.serverHost = serverHost;
            this.username = username;
            this.password = password;
        }
    }
}