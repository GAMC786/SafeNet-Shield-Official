package com.safenet.dns;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.fail;

import com.wireguard.config.BadConfigException;
import com.wireguard.config.Config;

import java.io.IOException;

import org.junit.Test;

public class SafeNetWireGuardConfigTest {
    private static final String FIXTURE_KEY =
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    @Test
    public void validFixtureIsAcceptedByTheOfficialParser() throws Exception {
        Config config = SafeNetWireGuardConfig.load(fixture(), "1.1.1.1");

        assertNotNull(config);
    }

    @Test
    public void malformedGatewayEndpointIsRejected() {
        assertRejected(
            new SafeNetWireGuardConfig.Settings(
                "not-an-endpoint",
                "SafeNet",
                FIXTURE_KEY,
                FIXTURE_KEY,
                "10.0.0.2/32",
                "0.0.0.0/0, ::/0",
                "1.1.1.1",
                "25"
            ),
            "1.1.1.1",
            "gateway endpoint"
        );
    }

    @Test
    public void malformedKeysAreRejected() {
        assertRejected(
            new SafeNetWireGuardConfig.Settings(
                "198.51.100.10:51820",
                "SafeNet",
                "not-a-wireguard-key",
                FIXTURE_KEY,
                "10.0.0.2/32",
                "0.0.0.0/0, ::/0",
                "1.1.1.1",
                "25"
            ),
            "1.1.1.1",
            "peer public key"
        );
        assertRejected(
            new SafeNetWireGuardConfig.Settings(
                "198.51.100.10:51820",
                "SafeNet",
                FIXTURE_KEY,
                "not-a-wireguard-key",
                "10.0.0.2/32",
                "0.0.0.0/0, ::/0",
                "1.1.1.1",
                "25"
            ),
            "1.1.1.1",
            "client private key"
        );
    }

    @Test
    public void malformedAddressAndRouteAreRejected() {
        assertRejected(
            new SafeNetWireGuardConfig.Settings(
                "198.51.100.10:51820",
                "SafeNet",
                FIXTURE_KEY,
                FIXTURE_KEY,
                "not-an-address",
                "0.0.0.0/0, ::/0",
                "1.1.1.1",
                "25"
            ),
            "1.1.1.1",
            "client address"
        );
        assertRejected(
            new SafeNetWireGuardConfig.Settings(
                "198.51.100.10:51820",
                "SafeNet",
                FIXTURE_KEY,
                FIXTURE_KEY,
                "10.0.0.2/32",
                "10.0.0.0/24",
                "1.1.1.1",
                "25"
            ),
            "1.1.1.1",
            "allowed IPs"
        );
    }

    @Test
    public void malformedDnsAndKeepaliveAreRejected() {
        assertRejected(
            new SafeNetWireGuardConfig.Settings(
                "198.51.100.10:51820",
                "SafeNet",
                FIXTURE_KEY,
                FIXTURE_KEY,
                "10.0.0.2/32",
                "0.0.0.0/0, ::/0",
                "http://dns.example",
                "25"
            ),
            null,
            "DNS servers"
        );
        assertRejected(
            new SafeNetWireGuardConfig.Settings(
                "198.51.100.10:51820",
                "SafeNet",
                FIXTURE_KEY,
                FIXTURE_KEY,
                "10.0.0.2/32",
                "0.0.0.0/0, ::/0",
                "1.1.1.1",
                "65536"
            ),
            "1.1.1.1",
            "persistent keepalive"
        );
    }

    @Test
    public void protectedReleaseConfigurationUsesTheSameParser() throws Exception {
        if (!Boolean.getBoolean("safenet.validateReleaseConfig")) {
            return;
        }

        try {
            SafeNetWireGuardConfig.load();
        } catch (IllegalArgumentException | BadConfigException | IOException error) {
            throw new AssertionError("SafeNet WireGuard release configuration is invalid.");
        }
    }

    private static SafeNetWireGuardConfig.Settings fixture() {
        return new SafeNetWireGuardConfig.Settings(
            "198.51.100.10:51820",
            "SafeNet",
            FIXTURE_KEY,
            FIXTURE_KEY,
            "10.0.0.2/32",
            "0.0.0.0/0, ::/0",
            "1.1.1.1",
            "25"
        );
    }

    private static void assertRejected(
        SafeNetWireGuardConfig.Settings settings,
        String selectedDnsServers,
        String label
    ) {
        try {
            SafeNetWireGuardConfig.load(settings, selectedDnsServers);
            fail("Expected invalid " + label + " fixture to be rejected.");
        } catch (IllegalArgumentException | BadConfigException | IOException expected) {
            // The exact parser message is intentionally not part of release output.
        }
    }
}