package com.safenet.dns;

import com.wireguard.config.BadConfigException;
import com.wireguard.config.Config;
import com.wireguard.config.InetEndpoint;
import com.wireguard.config.ParseException;

import java.io.ByteArrayInputStream;
import java.net.InetAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Build-time configuration for the SafeNet-operated WireGuard gateway.
 *
 * The gateway and peer values are deliberately not guessed. A build is
 * WireGuard-capable only when all of the values are supplied by the SafeNet
 * release environment and the official WireGuard parser accepts them.
 */
final class SafeNetWireGuardConfig {
    static final class Settings {
        final String gatewayEndpoint;
        final String gatewayOwner;
        final String peerPublicKey;
        final String clientPrivateKey;
        final String clientAddress;
        final String allowedIps;
        final String dnsServers;
        final String persistentKeepalive;

        Settings(
            String gatewayEndpoint,
            String gatewayOwner,
            String peerPublicKey,
            String clientPrivateKey,
            String clientAddress,
            String allowedIps,
            String dnsServers,
            String persistentKeepalive
        ) {
            this.gatewayEndpoint = gatewayEndpoint;
            this.gatewayOwner = gatewayOwner;
            this.peerPublicKey = peerPublicKey;
            this.clientPrivateKey = clientPrivateKey;
            this.clientAddress = clientAddress;
            this.allowedIps = allowedIps;
            this.dnsServers = dnsServers;
            this.persistentKeepalive = persistentKeepalive;
        }
    }

    private SafeNetWireGuardConfig() {
    }

    static boolean isConfigured() {
        try {
            load();
            return true;
        } catch (IllegalArgumentException | BadConfigException | java.io.IOException error) {
            return false;
        }
    }

    /**
     * Returns whether the gateway and peer are usable even when the build did
     * not provide a default DNS value. The selected resolver is supplied when
     * the tunnel is started.
     */
    static boolean isCoreConfigured() {
        try {
            load("1.1.1.1");
            return true;
        } catch (IllegalArgumentException | BadConfigException | java.io.IOException error) {
            return false;
        }
    }

    static String validationError() {
        try {
            load("1.1.1.1");
            return null;
        } catch (IllegalArgumentException | BadConfigException | java.io.IOException error) {
            return safeMessage(error);
        }
    }

    static Config load() throws java.io.IOException, BadConfigException {
        return load(fromBuildConfig(), null);
    }

    static Config load(String selectedDnsServers) throws java.io.IOException, BadConfigException {
        return load(fromBuildConfig(), selectedDnsServers);
    }

    static Config load(Settings settings, String selectedDnsServers)
        throws java.io.IOException, BadConfigException {
        String owner = required(settings.gatewayOwner, "gateway owner");
        if (!"SafeNet".equals(owner)) {
            throw new IllegalArgumentException("The WireGuard gateway must be operated by SafeNet.");
        }

        String endpoint = required(
            settings.gatewayEndpoint,
            "gateway endpoint"
        );
        // Parse the endpoint independently so a syntactically valid config
        // cannot accidentally omit the explicit SafeNet gateway destination.
        try {
            InetEndpoint.parse(endpoint);
        } catch (ParseException error) {
            throw new IllegalArgumentException("The SafeNet WireGuard gateway endpoint is invalid.");
        }

        String peerPublicKey = required(
            settings.peerPublicKey,
            "gateway peer public key"
        );
        String clientPrivateKey = required(
            settings.clientPrivateKey,
            "client private key"
        );
        String clientAddress = required(
            settings.clientAddress,
            "client address"
        );
        String allowedIps = required(
            settings.allowedIps,
            "allowed IPs"
        );
        requireDefaultRoute(allowedIps);
        String dnsServers = resolveDnsServers(normalizeDnsServers(
            selectedDnsServers == null || selectedDnsServers.trim().isEmpty()
                ? required(settings.dnsServers, "DNS servers")
                : selectedDnsServers
        ));
        String keepalive = required(
            settings.persistentKeepalive,
            "persistent keepalive"
        );

        int keepaliveSeconds;
        try {
            keepaliveSeconds = Integer.parseInt(keepalive);
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("The WireGuard persistent keepalive is invalid.");
        }
        if (keepaliveSeconds < 0 || keepaliveSeconds > 65535) {
            throw new IllegalArgumentException("The WireGuard persistent keepalive is out of range.");
        }

        String configText = "[Interface]\n"
            + "PrivateKey = " + clientPrivateKey + "\n"
            + "Address = " + clientAddress + "\n"
            + "DNS = " + dnsServers + "\n"
            + "\n[Peer]\n"
            + "PublicKey = " + peerPublicKey + "\n"
            + "AllowedIPs = " + allowedIps + "\n"
            + "Endpoint = " + endpoint + "\n"
            + "PersistentKeepalive = " + keepaliveSeconds + "\n";
        return Config.parse(new ByteArrayInputStream(configText.getBytes(StandardCharsets.UTF_8)));
    }

    private static Settings fromBuildConfig() {
        return new Settings(
            BuildConfig.SAFENET_WIREGUARD_GATEWAY_ENDPOINT,
            BuildConfig.SAFENET_WIREGUARD_GATEWAY_OWNER,
            BuildConfig.SAFENET_WIREGUARD_PEER_PUBLIC_KEY,
            BuildConfig.SAFENET_WIREGUARD_CLIENT_PRIVATE_KEY,
            BuildConfig.SAFENET_WIREGUARD_CLIENT_ADDRESS,
            BuildConfig.SAFENET_WIREGUARD_ALLOWED_IPS,
            BuildConfig.SAFENET_WIREGUARD_DNS_SERVERS,
            BuildConfig.SAFENET_WIREGUARD_PERSISTENT_KEEPALIVE
        );
    }

    static String gatewayEndpoint() {
        return BuildConfig.SAFENET_WIREGUARD_GATEWAY_ENDPOINT.trim();
    }

    static String gatewayOwner() {
        return BuildConfig.SAFENET_WIREGUARD_GATEWAY_OWNER.trim();
    }

    static String peerPublicKey() {
        return BuildConfig.SAFENET_WIREGUARD_PEER_PUBLIC_KEY.trim();
    }

    static String allowedIps() {
        return BuildConfig.SAFENET_WIREGUARD_ALLOWED_IPS.trim();
    }

    static String defaultDnsServers() {
        return BuildConfig.SAFENET_WIREGUARD_DNS_SERVERS == null
            ? ""
            : BuildConfig.SAFENET_WIREGUARD_DNS_SERVERS.trim();
    }

    static String normalizeDnsServers(String value) {
        String[] candidates = value == null ? new String[0] : value.trim().split("[,\\s]+");
        List<String> normalized = new ArrayList<>();
        for (String candidate : candidates) {
            if (candidate == null || candidate.trim().isEmpty()) {
                continue;
            }
            String address = candidate.trim();
            normalized.add(providerHost(address));
        }
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException(
                "Select a plain DNS resolver with at least one IP address before starting WireGuard."
            );
        }
        return String.join(", ", normalized);
    }

    private static String resolveDnsServers(String normalizedDnsServers) {
        List<String> resolved = new ArrayList<>();
        for (String host : normalizedDnsServers.split(",\\s*")) {
            if (isIpv4(host) || isIpv6(host)) {
                resolved.add(host);
                continue;
            }
            try {
                for (InetAddress address : InetAddress.getAllByName(host)) {
                    resolved.add(address.getHostAddress());
                }
            } catch (java.io.IOException error) {
                throw new IllegalArgumentException(
                    "The selected DNS provider endpoint could not be resolved."
                );
            }
        }
        if (resolved.isEmpty()) {
            throw new IllegalArgumentException(
                "The selected DNS provider did not resolve to an IP address."
            );
        }
        return String.join(", ", resolved);
    }

    private static String providerHost(String value) {
        if (isIpv4(value) || isIpv6(value)) {
            return value;
        }

        String host = value;
        if (host.startsWith("https://") || host.startsWith("http://")) {
            try {
                URI endpoint = URI.create(host);
                if (!"https".equalsIgnoreCase(endpoint.getScheme()) || endpoint.getHost() == null) {
                    throw new IllegalArgumentException(
                        "WireGuard DNS-over-HTTPS endpoints must use a valid HTTPS URL."
                    );
                }
                host = endpoint.getHost();
            } catch (IllegalArgumentException error) {
                throw new IllegalArgumentException(
                    "WireGuard DNS-over-HTTPS endpoints must use a valid HTTPS URL."
                );
            }
        } else if (host.startsWith("[") && host.contains("]")) {
            host = host.substring(1, host.indexOf("]"));
        } else {
            int lastColon = host.lastIndexOf(':');
            if (lastColon > 0 && host.substring(lastColon + 1).matches("\\d{1,5}")) {
                host = host.substring(0, lastColon);
            }
        }

        if (!host.matches("[a-zA-Z0-9.-]+")) {
            throw new IllegalArgumentException(
                "WireGuard DNS must contain IP addresses or valid resolver hostnames."
            );
        }
        return host;
    }

    private static boolean isIpv4(String value) {
        String[] octets = value.split("\\.", -1);
        if (octets.length != 4) {
            return false;
        }
        for (String octet : octets) {
            if (octet.isEmpty() || !octet.matches("\\d{1,3}")) {
                return false;
            }
            try {
                if (Integer.parseInt(octet) > 255) {
                    return false;
                }
            } catch (NumberFormatException error) {
                return false;
            }
        }
        return true;
    }

    private static boolean isIpv6(String value) {
        return value.contains(":")
            && value.matches("[0-9a-fA-F:]+")
            && value.indexOf("::") == value.lastIndexOf("::");
    }

    private static void requireDefaultRoute(String allowedIps) {
        boolean hasDefaultRoute = false;
        for (String route : allowedIps.split("[,\\s]+")) {
            if ("0.0.0.0/0".equals(route) || "::/0".equals(route)) {
                hasDefaultRoute = true;
                break;
            }
        }
        if (!hasDefaultRoute) {
            throw new IllegalArgumentException(
                "SafeNet WireGuard must use a default route so selected DNS stays inside the tunnel."
            );
        }
    }

    private static String required(String value, String label) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("SafeNet WireGuard " + label + " is not configured.");
        }
        return value.trim();
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty()
            ? "SafeNet WireGuard gateway configuration is invalid."
            : message;
    }
}