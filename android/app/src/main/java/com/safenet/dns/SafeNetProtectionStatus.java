package com.safenet.dns;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Describes the protection path SafeNet can actually verify.
 *
 * A normal Android app cannot inspect another app's embedded proxy, encrypted
 * DNS, HTTPS, or private VPN tunnel. Those paths are deliberately reported as
 * uninspectable instead of being inferred as safe.
 */
public final class SafeNetProtectionStatus {
    // These Android Private DNS identifiers are runtime-stable, but are not
    // exposed as compile-time constants by every pinned SDK platform.
    private static final String PRIVATE_DNS_MODE = "private_dns_mode";
    private static final String PRIVATE_DNS_SPECIFIER = "private_dns_specifier";
    public static final String STATE_PROTECTED = "protected";
    public static final String STATE_VPN_REPLACED = "vpn_replaced";
    public static final String STATE_PROXY_UNINSPECTABLE = "proxy_uninspectable";
    public static final String STATE_DNS_BYPASS_POSSIBLE = "dns_bypass_possible";
    public static final String STATE_CAPTURE_UNAVAILABLE = "capture_unavailable";
    public static final String STATE_PROTECTION_UNAVAILABLE = "protection_unavailable";

    private SafeNetProtectionStatus() {}

    public static JSONObject get(Context context) {
        return get(context, null);
    }

    public static JSONObject get(Context context, String expectedHostname) {
        ConnectivitySnapshot snapshot = readConnectivity(context);
        PrivateDnsSnapshot privateDns = readPrivateDns(context, expectedHostname);
        String state = resolvePrivateDnsState(privateDns.active, snapshot.otherVpnActive);

        JSONObject result = new JSONObject();
        try {
            result.put("state", state);
            result.put("timestamp", System.currentTimeMillis());
            result.put("safeNetVpnRunning", false);
            result.put("safeNetOwnsActiveVpn", false);
            result.put("safeNetPrivateDnsActive", privateDns.active);
            result.put("privateDnsMode", privateDns.mode);
            result.put("privateDnsHostname", privateDns.hostname == null ? JSONObject.NULL : privateDns.hostname);
            result.put(
                "privateDnsExpectedHostname",
                privateDns.expectedHostname == null ? JSONObject.NULL : privateDns.expectedHostname
            );
            result.put("otherVpnActive", snapshot.otherVpnActive);
            result.put("activeNetwork", snapshot.activeNetwork);
            result.put("vpnRevoked", false);
            result.put("scope", "SafeNet uses Android Private DNS for encrypted DNS-over-TLS resolution.");
            result.put(
                "message",
                messageFor(
                    state,
                    snapshot.ownerIdentityKnown,
                    snapshot.otherVpnActive
                )
            );
            result.put(
                "proxyState",
                STATE_PROXY_UNINSPECTABLE
            );
            JSONArray states = new JSONArray();
            states.put(state);
            states.put(STATE_PROXY_UNINSPECTABLE);
            result.put("states", states);
            result.put(
                "proxyMessage",
                "SafeNet does not inspect traffic through private browser proxies, HTTPS content, "
                    + "or another VPN."
            );
            JSONArray limitations = new JSONArray();
            limitations.put("SafeNet Private DNS encrypts DNS resolution only; it does not inspect HTTPS content or arbitrary application traffic.");
            limitations.put("A private proxy browser can hide its destination from SafeNet.");
            limitations.put("Apps using their own encrypted DNS or another VPN can bypass Android Private DNS.");
            limitations.put("Screen content requires separate, explicit MediaProjection consent.");
            result.put("limitations", limitations);
        } catch (Exception ignored) {
            // JSONObject operations above contain only primitive values.
        }
        return result;
    }

    static String resolvePrivateDnsState(boolean privateDnsActive, boolean otherVpnActive) {
        if (otherVpnActive) {
            return STATE_VPN_REPLACED;
        }
        return privateDnsActive ? STATE_PROTECTED : STATE_PROTECTION_UNAVAILABLE;
    }

    static boolean privateDnsMatchesExpectedHostname(String mode, String hostname, String expectedHostname) {
        String normalizedExpected = normalizePrivateDnsHostname(expectedHostname);
        String normalizedHostname = normalizePrivateDnsHostname(hostname);
        return "hostname".equals(mode)
            && normalizedExpected != null
            && normalizedExpected.equals(normalizedHostname);
    }

    static boolean isPrivateDnsActive(Context context, String expectedHostname) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return false;
        }
        return readPrivateDns(context, expectedHostname).active;
    }

    static String resolveState(
        boolean serviceRunning,
        boolean ownsSafeNetVpn,
        boolean otherVpnActive,
        boolean activeNetwork
    ) {
        return resolveState(
            serviceRunning,
            ownsSafeNetVpn,
            otherVpnActive,
            activeNetwork,
            false
        );
    }

    static String resolveState(
        boolean serviceRunning,
        boolean ownsSafeNetVpn,
        boolean otherVpnActive,
        boolean activeNetwork,
        boolean vpnRevoked
    ) {
        if (vpnRevoked) {
            return STATE_VPN_REPLACED;
        }
        if (otherVpnActive) {
            return STATE_VPN_REPLACED;
        }
        if (serviceRunning && ownsSafeNetVpn) {
            return STATE_PROTECTED;
        }
        if (serviceRunning && activeNetwork) {
            return STATE_DNS_BYPASS_POSSIBLE;
        }
        return STATE_PROTECTION_UNAVAILABLE;
    }

    private static String messageFor(
        String state,
        boolean ownerIdentityKnown,
        boolean otherVpnActive
    ) {
        switch (state) {
            case STATE_PROTECTED:
                return "Android is using the expected SafeNet Private DNS hostname for encrypted DNS resolution. Private proxy traffic remains outside inspection.";
            case STATE_VPN_REPLACED:
                return otherVpnActive
                    ? "Another VPN currently owns Android's network path. SafeNet DNS blocking is not active."
                    : "Android replaced SafeNet's VPN path. Reconnect SafeNet protection.";
            case STATE_DNS_BYPASS_POSSIBLE:
                return ownerIdentityKnown
                    ? "SafeNet is running, but Android did not expose an active SafeNet VPN path."
                    : "SafeNet is running, but this Android version cannot prove which VPN owns the path.";
            default:
                return "SafeNet does not currently control Android's network path.";
        }
    }

    private static ConnectivitySnapshot readConnectivity(Context context) {
        ConnectivitySnapshot snapshot = new ConnectivitySnapshot();
        ConnectivityManager connectivity =
            (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) {
            return snapshot;
        }

        try {
            Network active = connectivity.getActiveNetwork();
            snapshot.activeNetwork = active != null;
            NetworkCapabilities activeCapabilities =
                active == null ? null : connectivity.getNetworkCapabilities(active);
            if (activeCapabilities == null ||
                !activeCapabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                return snapshot;
            }

            snapshot.ownerIdentityKnown = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
            if (snapshot.ownerIdentityKnown) {
                int ownerUid = activeCapabilities.getOwnerUid();
                if (ownerUid == context.getApplicationInfo().uid) {
                    snapshot.ownsSafeNetVpn = true;
                } else {
                    snapshot.otherVpnActive = true;
                }
            } else {
                // On older Android versions the VPN owner is not exposed.
                // Do not infer ownership from SafeNet's service flag.
                snapshot.ownsSafeNetVpn = false;
            }
        } catch (SecurityException ignored) {
            snapshot.activeNetwork = false;
        }
        return snapshot;
    }

    private static PrivateDnsSnapshot readPrivateDns(Context context, String expectedHostname) {
        PrivateDnsSnapshot snapshot = new PrivateDnsSnapshot();
        snapshot.expectedHostname = normalizePrivateDnsHostname(expectedHostname);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            snapshot.mode = "unsupported";
            return snapshot;
        }
        try {
            String mode = android.provider.Settings.Global.getString(
                context.getContentResolver(),
                PRIVATE_DNS_MODE
            );
            snapshot.mode = mode == null ? "unknown" : mode;
            snapshot.hostname = android.provider.Settings.Global.getString(
                context.getContentResolver(),
                PRIVATE_DNS_SPECIFIER
            );
            snapshot.active = privateDnsMatchesExpectedHostname(
                mode,
                snapshot.hostname,
                snapshot.expectedHostname
            );
        } catch (SecurityException ignored) {
            snapshot.mode = "unknown";
        }
        return snapshot;
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

    private static final class ConnectivitySnapshot {
        private boolean activeNetwork;
        private boolean ownsSafeNetVpn;
        private boolean otherVpnActive;
        private boolean ownerIdentityKnown;
    }

    private static final class PrivateDnsSnapshot {
        private boolean active;
        private String mode = "unknown";
        private String hostname;
        private String expectedHostname;
    }
}