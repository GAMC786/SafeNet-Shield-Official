package com.safenet.dns;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Stores the last authenticated firewall snapshot for offline VPN operation.
 * The encryption key is non-exportable and lives in Android Keystore.
 */
final class FirewallConfigStore {
    private static final String PREFS_NAME = "safenet_vpn";
    private static final String PREF_FIREWALL_CONFIG = "firewall_config";
    private static final String KEY_ALIAS = "safenet_firewall_config";
    private static final int GCM_TAG_BITS = 128;
    private static final int IV_BYTES = 12;

    private FirewallConfigStore() {}

    static void save(Context context, String serialized) throws org.json.JSONException {
        DnsFirewall.fromJson(serialized);
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            byte[] iv = new byte[IV_BYTES];
            new SecureRandom().nextBytes(iv);
            cipher.init(Cipher.ENCRYPT_MODE, getKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] encrypted = cipher.doFinal(serialized.getBytes(StandardCharsets.UTF_8));
            byte[] payload = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, payload, 0, iv.length);
            System.arraycopy(encrypted, 0, payload, iv.length, encrypted.length);
            boolean saved = preferences(context).edit()
                .putString(PREF_FIREWALL_CONFIG, Base64.encodeToString(payload, Base64.NO_WRAP))
                .commit();
            if (!saved) {
                throw new IllegalStateException("Android did not persist the firewall rules.");
            }
        } catch (org.json.JSONException error) {
            throw error;
        } catch (Exception error) {
            throw new IllegalStateException("Unable to securely save firewall rules.", error);
        }
    }

    static DnsFirewall load(Context context) {
        String encoded = preferences(context).getString(PREF_FIREWALL_CONFIG, null);
        if (encoded == null || encoded.trim().isEmpty()) {
            return DnsFirewall.allowAll();
        }
        try {
            byte[] payload = Base64.decode(encoded, Base64.NO_WRAP);
            if (payload.length <= IV_BYTES) {
                return DnsFirewall.failClosed();
            }
            byte[] iv = new byte[IV_BYTES];
            byte[] encrypted = new byte[payload.length - IV_BYTES];
            System.arraycopy(payload, 0, iv, 0, IV_BYTES);
            System.arraycopy(payload, IV_BYTES, encrypted, 0, encrypted.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            return DnsFirewall.fromJson(
                new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8)
            );
        } catch (Exception error) {
            // A damaged or tampered cached policy must not turn protection off.
            return DnsFirewall.failClosed();
        }
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static SecretKey getKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        );
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(false)
            .build());
        return generator.generateKey();
    }
}