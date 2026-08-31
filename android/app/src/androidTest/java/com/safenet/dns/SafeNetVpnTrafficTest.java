package com.safenet.dns;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import org.junit.Assert;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Run this test while the APK's DNS VPN is shown as active. DNS resolution
 * exercises the configured resolver; HTTPS verifies non-DNS traffic remains
 * usable while the DNS-only VPN is established.
 */
@RunWith(AndroidJUnit4.class)
public class SafeNetVpnTrafficTest {
    @Test
    public void dnsResolutionAndHttpsTrafficRemainAvailable() throws Exception {
        InetAddress resolved = InetAddress.getByName("example.com");
        Assert.assertNotNull("DNS query did not return an address", resolved.getHostAddress());

        HttpsURLConnection connection = (HttpsURLConnection)
            new URL("https://example.com/").openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(10000);
        connection.setInstanceFollowRedirects(false);
        try {
            int responseCode = connection.getResponseCode();
            Assert.assertTrue(
                "HTTPS request failed with response code " + responseCode,
                responseCode >= HttpURLConnection.HTTP_OK
                    && responseCode < HttpURLConnection.HTTP_MULT_CHOICE
            );
        } finally {
            connection.disconnect();
        }
    }
}