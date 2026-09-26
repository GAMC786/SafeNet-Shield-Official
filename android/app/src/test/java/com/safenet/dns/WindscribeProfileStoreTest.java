package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import com.wireguard.config.BadConfigException;
import com.wireguard.config.Config;

import org.junit.Test;

import java.io.IOException;

public class WindscribeProfileStoreTest {
    private static final String VALID_PROFILE =
            "[Interface]\n"
                    + "PrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n"
                    + "Address = 10.66.0.2/32\n"
                    + "DNS = 10.255.255.3\n"
                    + "\n"
                    + "[Peer]\n"
                    + "PublicKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n"
                    + "AllowedIPs = 0.0.0.0/0, ::/0\n"
                    + "Endpoint = 198.51.100.2:443\n"
                    + "PersistentKeepalive = 25\n";

    @Test
    public void parsesWindscribeStyleWireGuardProfile() throws IOException, BadConfigException {
        Config config = WindscribeProfileStore.parseProfile(VALID_PROFILE);

        assertEquals(1, config.getPeers().size());
    }

    @Test
    public void rejectsProfileWithoutPeers() {
        assertThrows(
                IllegalArgumentException.class,
                () -> WindscribeProfileStore.parseProfile(
                        "[Interface]\nPrivateKey = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n"));
    }

    @Test
    public void rejectsOversizedProfile() {
        String profile = "[Interface]\n" + "x".repeat(70 * 1024);
        assertThrows(
                IllegalArgumentException.class,
                () -> WindscribeProfileStore.parseProfile(profile));
    }
}