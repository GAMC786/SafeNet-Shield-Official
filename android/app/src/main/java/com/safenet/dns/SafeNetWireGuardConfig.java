package com.safenet.dns;

import com.wireguard.config.BadConfigException;
import com.wireguard.config.Config;
import com.wireguard.config.InetEndpoint;
import com.wireguard.config.ParseException;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

/**
 * Build-time configuration for the SafeNet-operated WireGuard gateway.
 *
 * The gateway and peer values are deliberately not guessed. A build is
 * WireGuard-capable only when all of the values are supplied by the SafeNet
 * release environment and the official WireGuard parser accepts them.
 */
final class SafeNetWireGuardConfig {
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

    static String validationError() {
        try {
            load();
            return null;
        } catch (IllegalArgumentException | BadConfigException | java.io.IOException error) {
            return safeMessage(error);
        }
    }

    static Config load() throws java.io.IOException, BadConfigException {
        String owner = required(BuildConfig.SAFENET_WIREGUARD_GATEWAY_OWNER, "gateway owner");
        if (!"SafeNet".equals(owner)) {
            throw new IllegalArgumentException("The WireGuard gateway must be operated by SafeNet.");
        }

        String endpoint = required(
            BuildConfig.SAFENET_WIREGUARD_GATEWAY_ENDPOINT,
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
            BuildConfig.SAFENET_WIREGUARD_PEER_PUBLIC_KEY,
            "gateway peer public key"
        );
        String clientPrivateKey = required(
            BuildConfig.SAFENET_WIREGUARD_CLIENT_PRIVATE_KEY,
            "client private key"
        );
        String clientAddress = required(
            BuildConfig.SAFENET_WIREGUARD_CLIENT_ADDRESS,
            "client address"
        );
        String allowedIps = required(
            BuildConfig.SAFENET_WIREGUARD_ALLOWED_IPS,
            "allowed IPs"
        );
        String dnsServers = required(
            BuildConfig.SAFENET_WIREGUARD_DNS_SERVERS,
            "DNS servers"
        );
        String keepalive = required(
            BuildConfig.SAFENET_WIREGUARD_PERSISTENT_KEEPALIVE,
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