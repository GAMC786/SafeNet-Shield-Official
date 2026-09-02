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
    public static final String STATE_PROTECTED = "protected";
    public static final String STATE_VPN_REPLACED = "vpn_replaced";
    public static final String STATE_PROXY_UNINSPECTABLE = "proxy_uninspectable";
    public static final String STATE_DNS_BYPASS_POSSIBLE = "dns_bypass_possible";
    public static final String STATE_CAPTURE_UNAVAILABLE = "capture_unavailable";
    public static final String STATE_PROTECTION_UNAVAILABLE = "protection_unavailable";

    private SafeNetProtectionStatus() {}

    public static JSONObject get(Context context) {
        ConnectivitySnapshot snapshot = readConnectivity(context);
        boolean serviceRunning = SafeNetVpnService.isRunning();
        String lastError = SafeNetVpnService.getLastError();
        boolean vpnRevoked = lastError != null
            && lastError.toLowerCase().contains("revoked");
        String state = resolveState(
            serviceRunning,
            snapshot.ownsSafeNetVpn,
            snapshot.otherVpnActive,
            snapshot.activeNetwork,
            vpnRevoked
        );

        JSONObject result = new JSONObject();
        try {
            result.put("state", state);
            result.put("timestamp", System.currentTimeMillis());
            result.put("safeNetVpnRunning", serviceRunning);
            result.put("safeNetOwnsActiveVpn", snapshot.ownsSafeNetVpn);
            result.put("otherVpnActive", snapshot.otherVpnActive);
            result.put("activeNetwork", snapshot.activeNetwork);
            result.put("vpnRevoked", vpnRevoked);
            result.put("scope", "DNS requests routed through SafeNet's active Android VPN.");
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
                "Embedded browser proxies, encrypted DNS, HTTPS content, and another VPN "
                    + "cannot be inspected by SafeNet's DNS-only VPN."
            );
            JSONArray limitations = new JSONArray();
            limitations.put("DNS-only filtering; ordinary web traffic is not routed through this VPN.");
            limitations.put("A private proxy browser can hide its destination from SafeNet.");
            limitations.put("Only one Android VPN can own the device path at a time.");
            limitations.put("Screen content requires separate, explicit MediaProjection consent.");
            result.put("limitations", limitations);
        } catch (Exception ignored) {
            // JSONObject operations above contain only primitive values.
        }
        return result;
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
                return "SafeNet owns Android's active VPN path for DNS filtering. Private proxy traffic remains outside inspection.";
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

    private static final class ConnectivitySnapshot {
        private boolean activeNetwork;
        private boolean ownsSafeNetVpn;
        private boolean otherVpnActive;
        private boolean ownerIdentityKnown;
    }
}