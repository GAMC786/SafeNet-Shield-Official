package com.safenet.dns;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import java.io.ByteArrayOutputStream;
import java.net.NetworkInterface;
import java.security.KeyStore;
import java.util.Collections;
import org.json.JSONArray;
import libtailscale.Libtailscale;
import java.nio.charset.StandardCharsets;

/** Small SafeNet-owned host for the upstream gomobile Tailscale engine. */
public final class SafeNetTailscaleApp extends Application implements libtailscale.AppContext {
    private volatile libtailscale.Application engine;
    private volatile Network underlyingNetwork;
    private ConnectivityManager.NetworkCallback networkCallback;

    public static SafeNetTailscaleApp get(Context context) {
        SafeNetTailscaleApp app = (SafeNetTailscaleApp) context.getApplicationContext();
        app.startIfNeeded();
        return app;
    }

    public libtailscale.Application engine() {
        startIfNeeded();
        return engine;
    }
    public org.json.JSONObject api(String method, String path, org.json.JSONObject body) throws Exception {
        byte[] bytes = body == null ? null : body.toString().getBytes(StandardCharsets.UTF_8);
        libtailscale.LocalAPIResponse response = engine().callLocalAPI(5000L, method, path,
            bytes == null ? null : new SafeNetTailscalePlugin.BytesInput(bytes));
        byte[] payload = response.bodyBytes();
        if (response.statusCode() >= 400) throw new IllegalStateException("LocalAPI " + response.statusCode());
        return payload == null || payload.length == 0 ? new org.json.JSONObject() :
            new org.json.JSONObject(new String(payload, StandardCharsets.UTF_8));
    }
    public void setWantRunning(boolean value) throws Exception {
        org.json.JSONObject body = new org.json.JSONObject()
            .put("WantRunningSet", true)
            .put("WantRunning", value);
        api("PATCH", "/localapi/v0/prefs", body);
    }

    @Override public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            ConnectivityManager manager = getSystemService(ConnectivityManager.class);
            if (manager != null) {
                underlyingNetwork = findUnderlyingNetwork(manager);
                networkCallback = new ConnectivityManager.NetworkCallback() {
                    @Override public void onAvailable(Network network) {
                        updateUnderlyingNetwork(manager, network);
                    }
                    @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) {
                        if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                            underlyingNetwork = network;
                            SafeNetTailscaleVpnService.updateUnderlyingNetworks(new Network[] { network });
                        }
                    }
                    @Override public void onLost(Network network) {
                        if (network.equals(underlyingNetwork)) {
                            underlyingNetwork = findUnderlyingNetwork(manager);
                            SafeNetTailscaleVpnService.updateUnderlyingNetworks(underlyingNetworks());
                        }
                    }
                };
                try {
                    manager.registerDefaultNetworkCallback(networkCallback);
                } catch (RuntimeException e) {
                    networkCallback = null;
                    Log.w("SafeNetTailscale", "Underlying network tracking unavailable", e);
                }
            }
        }
    }

    @Override public void onTerminate() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        if (manager != null && networkCallback != null) {
            try { manager.unregisterNetworkCallback(networkCallback); } catch (RuntimeException ignored) {}
        }
        super.onTerminate();
    }

    private void updateUnderlyingNetwork(ConnectivityManager manager, Network network) {
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        if (capabilities != null && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
            underlyingNetwork = network;
            SafeNetTailscaleVpnService.updateUnderlyingNetworks(new Network[] { network });
        }
    }

    private static Network findUnderlyingNetwork(ConnectivityManager manager) {
        Network active = manager.getActiveNetwork();
        NetworkCapabilities activeCapabilities = active == null ? null : manager.getNetworkCapabilities(active);
        if (activeCapabilities != null
            && activeCapabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            && !activeCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
            return active;
        }
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities != null
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                return network;
            }
        }
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities != null
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                return network;
            }
        }
        return null;
    }

    Network[] underlyingNetworks() {
        Network network = underlyingNetwork;
        if (network == null) {
            ConnectivityManager manager = getSystemService(ConnectivityManager.class);
            network = manager == null ? null : findUnderlyingNetwork(manager);
            underlyingNetwork = network;
        }
        return network == null ? new Network[0] : new Network[] { network };
    }

    private synchronized void startIfNeeded() {
        if (Build.VERSION.SDK_INT < 26 || engine != null) return;
        engine = Libtailscale.start(getFilesDir().getAbsolutePath(),
            getFilesDir().getAbsolutePath(), false, this);
    }

    private SharedPreferences prefs() {
        try {
            MasterKey key = new MasterKey.Builder(this)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
            return EncryptedSharedPreferences.create(this, "tailscale_state", key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        } catch (Exception e) {
            throw new IllegalStateException("Encrypted Tailscale state is unavailable", e);
        }
    }
    @Override public void log(String tag, String line) { Log.d(tag, line); }
    @Override public void encryptToPref(String key, String value) { prefs().edit().putString(key, value).commit(); }
    @Override public String decryptFromPref(String key) { return prefs().getString(key, ""); }
    @Override public String getStateStoreKeysJSON() {
        JSONArray out = new JSONArray();
        for (String key : prefs().getAll().keySet())
            if (key.startsWith("statestore-")) out.put(key.substring("statestore-".length()));
        return out.toString();
    }
    @Override public String getOSVersion() { return Build.VERSION.RELEASE; }
    @Override public long getSDKInt() { return Build.VERSION.SDK_INT; }
    @Override public String getDeviceName() {
        String name = Settings.Global.getString(getContentResolver(), Settings.Global.DEVICE_NAME);
        if (name != null && !name.isEmpty()) return name;
        return Build.MANUFACTURER + " " + Build.MODEL;
    }
    @Override public String getInstallSource() {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                String installer = getPackageManager().getInstallSourceInfo(getPackageName()).getInstallingPackageName();
                return installer == null ? "" : installer;
            }
            String installer = getPackageManager().getInstallerPackageName(getPackageName());
            return installer == null ? "" : installer;
        } catch (Exception e) {
            return "";
        }
    }
    @Override public boolean shouldUseGoogleDNSFallback() { return false; }
    @Override public boolean isChromeOS() { return getPackageManager().hasSystemFeature("android.hardware.type.pc"); }
    @Override public boolean isClientLoggingEnabled() { return false; }
    @Override public String getInterfacesAsJson() {
        JSONArray result = new JSONArray();
        try {
            for (NetworkInterface n : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                try {
                    org.json.JSONObject item = new org.json.JSONObject();
                    item.put("name", n.getName());
                    item.put("index", n.getIndex());
                    item.put("mtu", n.getMTU());
                    item.put("up", n.isUp());
                    item.put("broadcast", n.supportsMulticast());
                    item.put("loopback", n.isLoopback());
                    item.put("pointToPoint", n.isPointToPoint());
                    item.put("multicast", n.supportsMulticast());
                    JSONArray addresses = new JSONArray();
                    for (java.net.InterfaceAddress address : n.getInterfaceAddresses()) {
                        if (address.getAddress() == null) continue;
                        org.json.JSONObject entry = new org.json.JSONObject();
                        entry.put("ip", address.getAddress().getHostAddress());
                        entry.put("prefixLen", address.getNetworkPrefixLength());
                        addresses.put(entry);
                    }
                    item.put("addrs", addresses);
                    result.put(item);
                } catch (Exception e) {
                    Log.w("SafeNetTailscale", "Skipping an unavailable network interface", e);
                }
            }
        } catch (Exception e) { throw new IllegalStateException("Network interfaces unavailable", e); }
        return result.toString();
    }
    @Override public String getPlatformDNSConfig() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        if (cm == null) return "";
        try {
            Network[] underlying = underlyingNetworks();
            Network selected = underlying.length == 0 ? null : underlying[0];
            LinkProperties properties = selected == null ? null : cm.getLinkProperties(selected);
            if (properties == null) return "";
            StringBuilder servers = new StringBuilder();
            for (java.net.InetAddress address : properties.getDnsServers()) {
                if (servers.length() > 0) servers.append(' ');
                servers.append(address.getHostAddress());
            }
            String domains = properties.getDomains();
            return servers + "\n" + (domains == null ? "" : domains);
        } catch (Exception e) {
            throw new IllegalStateException("Platform DNS configuration unavailable", e);
        }
    }
    @Override public boolean shouldBlockDNSPacket(
        byte[] query,
        String sourceAddress,
        String destinationAddress,
        boolean isTcp,
        boolean trustedResolver,
        boolean fragmented
    ) {
        try {
            return FirewallConfigStore.load(this).shouldBlockTailscalePacket(
                query,
                sourceAddress,
                destinationAddress,
                isTcp,
                trustedResolver,
                fragmented
            );
        } catch (RuntimeException error) {
            // A JNI/policy failure must not let a DNS query bypass filtering.
            Log.e("SafeNetTailscale", "DNS firewall evaluation failed closed", error);
            return true;
        }
    }
    @Override public byte[] blockedDNSResponse(byte[] query) {
        return DnsFirewall.blockedResponse(query);
    }
    @Override public String getSyspolicyStringValue(String key) { throw new IllegalStateException("Policy unavailable"); }
    @Override public boolean getSyspolicyBooleanValue(String key) { throw new IllegalStateException("Policy unavailable"); }
    @Override public String getSyspolicyStringArrayJSONValue(String key) { throw new IllegalStateException("Policy unavailable"); }
    @Override public boolean hardwareAttestationKeySupported() { return false; }
    @Override public String hardwareAttestationKeyCreate() { throw new UnsupportedOperationException(); }
    @Override public void hardwareAttestationKeyRelease(String id) { throw new UnsupportedOperationException(); }
    @Override public byte[] hardwareAttestationKeyPublic(String id) { throw new UnsupportedOperationException(); }
    @Override public byte[] hardwareAttestationKeySign(String id, byte[] data) { throw new UnsupportedOperationException(); }
    @Override public void hardwareAttestationKeyLoad(String id) { throw new UnsupportedOperationException(); }
    @Override public boolean bindSocketToNetwork(int fd) {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        Network network = cm == null ? null : cm.getActiveNetwork();
        try (android.os.ParcelFileDescriptor descriptor = android.os.ParcelFileDescriptor.fromFd(fd)) {
            if (network == null) return false;
            network.bindSocket(descriptor.getFileDescriptor());
            return true;
        } catch (Exception e) { return false; }
    }
    @Override public byte[] getUserCACertsPEM() {
        try {
            KeyStore store = KeyStore.getInstance("AndroidCAStore");
            store.load(null);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            for (java.util.Enumeration<String> aliases = store.aliases(); aliases.hasMoreElements();) {
                String alias = aliases.nextElement();
                if (!alias.startsWith("user:")) continue;
                java.security.cert.Certificate certificate = store.getCertificate(alias);
                if (certificate == null) continue;
                output.write("-----BEGIN CERTIFICATE-----\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                String pem = Base64.encodeToString(certificate.getEncoded(), Base64.NO_WRAP);
                for (int offset = 0; offset < pem.length(); offset += 64) {
                    output.write(pem.substring(offset, Math.min(offset + 64, pem.length()))
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    output.write('\n');
                }
                output.write("-----END CERTIFICATE-----\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            return output.toByteArray();
        } catch (Exception e) {
            throw new IllegalStateException("User CA certificates are unavailable", e);
        }
    }
}