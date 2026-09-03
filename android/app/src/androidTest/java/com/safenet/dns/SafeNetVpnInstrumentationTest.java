package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.net.Uri;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONException;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.IOException;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;

@RunWith(AndroidJUnit4.class)
public class SafeNetVpnInstrumentationTest {
    private static final String PACKAGE_NAME = "com.safenet.dns";
    private static final String VIRTUAL_DNS = "10.0.0.1";
    private static final String VIRTUAL_DNS_V6 = "fd00:534e:5348::1";
    private static final int DNS_PORT = 53;
    private static final String TEST_URL = "https://example.com/";
    private static final String FIXTURE_MODE = "fixture";

    private Context context;

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    @After
    public void tearDown() {
        SafeNetVpnService.stopVpn();
    }

    @Test
    public void dnsOnlyRoutingAndOrdinaryConnectivity() throws Exception {
        SafeNetVpnService vpn = SafeNetVpnService.getInstance();
        assertNotNull("VPN service must be running", vpn);

        byte[] udpResponse = queryVirtualDnsUdp();
        assertTrue("The virtual DNS UDP endpoint must return a DNS response",
            udpResponse.length >= 12);
        assertEquals("UDP DNS response ID must match the query ID",
            0x534e, readUnsignedShort(udpResponse, 0));
        assertResolverResponse(udpResponse);

        byte[] ipv6Response = queryVirtualDnsIpv6();
        assertTrue("The virtual DNS IPv6 endpoint must return a DNS response",
            ipv6Response.length >= 12);
        assertEquals("IPv6 DNS response ID must match the query ID",
            0x534e, readUnsignedShort(ipv6Response, 0));
        assertResolverResponse(ipv6Response);

        byte[] tcpResponse = queryVirtualDnsTcp();
        assertTrue("The virtual DNS TCP endpoint must return a DNS response",
            tcpResponse.length >= 12);
        assertEquals("TCP DNS response ID must match the query ID",
            0x534e, readUnsignedShort(tcpResponse, 0));
        assertResolverResponse(tcpResponse);

        checkOrdinaryConnectivity();
    }

    private byte[] queryVirtualDnsUdp() throws Exception {
        byte[] query = new byte[] {
            0x53, 0x4e, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x07, 's', 'a', 'f', 'e', 'n', 'e', 't',
            0x03, 'c', 'o', 'm', 0x00,
            0x00, 0x01, 0x00, 0x01
        };
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setSoTimeout(5000);
            DatagramPacket request = new DatagramPacket(
                query, query.length, new InetSocketAddress(VIRTUAL_DNS, DNS_PORT));
            socket.send(request);

            byte[] responseBuffer = new byte[65535];
            DatagramPacket response = new DatagramPacket(responseBuffer, responseBuffer.length);
            socket.receive(response);

            byte[] result = new byte[response.getLength()];
            System.arraycopy(responseBuffer, 0, result, 0, response.getLength());
            return result;
        } catch (IOException error) {
            String category = classifyResolverFailure(error.getMessage());
            throw new AssertionError("UDP DNS query failed category=" + category +
                " message=" + error.getMessage(), error);
        }
    }

    private byte[] queryVirtualDnsIpv6() throws Exception {
        byte[] query = new byte[] {
            0x53, 0x4e, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x07, 's', 'a', 'f', 'e', 'n', 'e', 't',
            0x03, 'c', 'o', 'm', 0x00,
            0x00, 0x01, 0x00, 0x01
        };
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setSoTimeout(5000);
            DatagramPacket request = new DatagramPacket(
                query, query.length, new InetSocketAddress(VIRTUAL_DNS_V6, DNS_PORT));
            socket.send(request);

            byte[] responseBuffer = new byte[65535];
            DatagramPacket response = new DatagramPacket(responseBuffer, responseBuffer.length);
            socket.receive(response);

            byte[] result = new byte[response.getLength()];
            System.arraycopy(responseBuffer, 0, result, 0, response.getLength());
            return result;
        } catch (IOException error) {
            String category = classifyResolverFailure(error.getMessage());
            throw new AssertionError("IPv6 DNS query failed category=" + category +
                " message=" + error.getMessage(), error);
        }
    }

    private byte[] queryVirtualDnsTcp() throws Exception {
        byte[] query = new byte[] {
            0x53, 0x4e, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x07, 's', 'a', 'f', 'e', 'n', 'e', 't',
            0x03, 'c', 'o', 'm', 0x00,
            0x00, 0x01, 0x00, 0x01
        };
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(VIRTUAL_DNS, DNS_PORT), 5000);
            socket.setSoTimeout(5000);
            DataOutputStream output = new DataOutputStream(socket.getOutputStream());
            output.writeShort(query.length);
            output.write(query);
            output.flush();

            DataInputStream input = new DataInputStream(socket.getInputStream());
            int responseLength = input.readUnsignedShort();
            assertTrue("The DNS-over-TCP response length must be valid",
                responseLength > 0 && responseLength <= 65527);
            byte[] response = new byte[responseLength];
            input.readFully(response);
            return response;
        } catch (IOException error) {
            String category = classifyResolverFailure(error.getMessage());
            throw new AssertionError("TCP DNS query failed category=" + category +
                " message=" + error.getMessage(), error);
        }
    }

    private void assertResolverResponse(byte[] response) {
        assertTrue(
            isFixtureMode(),
            "Resolver response assertion requires fixture mode"
        );
        assertTrue(
            response.length >= 12 && response.length <= 65527,
            "Response length must be valid DNS"
        );
        assertEquals(
            "Response must contain expected answer",
            0xc00c,
            readUnsignedShort(response, response.length - 6)
        );
    }

    private void checkOrdinaryConnectivity() throws Exception {
        URL url = new URL(TEST_URL);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);
        try {
            connection.connect();
            int code = connection.getResponseCode();
            assertTrue(
                code >= 200 && code < 500,
                "Ordinary HTTPS connectivity must work over VPN"
            );
        } finally {
            connection.disconnect();
        }
    }

    private String classifyResolverFailure(String message) {
        if (message == null) {
            return "UNKNOWN";
        }
        if (message.contains("ENETUNREACH")) {
            return "ENETUNREACH";
        }
        if (message.contains("Network is unreachable")) {
            return "ENETUNREACH";
        }
        return "OTHER";
    }

    private boolean isFixtureMode() {
        String mode = InstrumentationRegistry.getArguments().getString("resolver-mode", FIXTURE_MODE);
        return FIXTURE_MODE.equals(mode);
    }

    private static int readUnsignedShort(byte[] value, int offset) {
        return ((value[offset] & 0xff) << 8) | (value[offset + 1] & 0xff);
    }
}