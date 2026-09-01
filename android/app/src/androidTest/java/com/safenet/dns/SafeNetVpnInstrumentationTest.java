package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;
import android.net.VpnService;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;

import org.json.JSONObject;
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
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * End-to-end checks for the native SafeNet DNS VPN.
 *
 * These tests intentionally use the Capacitor bridge rather than calling the
 * service directly. That keeps the EULA, permission, service, and stop checks
 * on the same path as the shipped application.
 */
@RunWith(AndroidJUnit4.class)
public class SafeNetVpnInstrumentationTest {
    private static final String PACKAGE_NAME = "com.safenet.dns";
    private static final String VIRTUAL_DNS = "10.248.0.1";
    private static final String VIRTUAL_DNS_V6 = "fd00:534e:5348::1";
    private static final int DNS_PORT = 53;
    private static final long JS_TIMEOUT_SECONDS = 20;
    private static final long VPN_START_TIMEOUT_SECONDS = 15;

    private final Context context =
        InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiDevice device =
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private Activity activity;

    @Before
    public void setUp() throws Exception {
        assertEquals(PACKAGE_NAME, context.getPackageName());
        context.stopService(new Intent(context, SafeNetVpnService.class));
        clearTargetAppData();

        Intent launchIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        activity = InstrumentationRegistry.getInstrumentation().startActivitySync(launchIntent);
        waitForBridge();
    }

    private void clearTargetAppData() throws Exception {
        ParcelFileDescriptor output = InstrumentationRegistry.getInstrumentation()
            .getUiAutomation()
            .executeShellCommand("pm clear " + PACKAGE_NAME);
        StringBuilder commandOutput = new StringBuilder();
        try (ParcelFileDescriptor.AutoCloseInputStream input =
                 new ParcelFileDescriptor.AutoCloseInputStream(output)) {
            int value;
            while ((value = input.read()) != -1) {
                commandOutput.append((char) value);
                // Wait for pm clear to finish before launching the app again.
            }
        }
        assertTrue("Could not reset target app data: " + commandOutput,
            commandOutput.toString().contains("Success"));
    }

    @After
    public void tearDown() throws Exception {
        context.stopService(new Intent(context, SafeNetVpnService.class));
        if (activity != null && !activity.isFinishing()) {
            waitForVpnState(false, 5);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
        }
    }

    @Test
    public void eulaGateAndVpnPermissionFlow() throws Exception {
        JSONObject initial = callVpn(
            "window.Capacitor.Plugins.SafeNetVpn.getStatus()"
        );
        assertFalse("A fresh install must not have accepted the EULA",
            requireValue(initial).getBoolean("eulaAccepted"));

        JSONObject blocked = callVpn(
            "window.Capacitor.Plugins.SafeNetVpn.start(" +
                "{\"type\":\"plain\",\"primaryAddress\":\"1.1.1.1\"})"
        );
        assertFalse(blocked.getBoolean("ok"));
        assertEquals("EULA_REQUIRED", blocked.getString("code"));

        JSONObject accepted = callVpn(
            "window.Capacitor.Plugins.SafeNetVpn.acceptEula({\"version\":\"1.0\"})"
        );
        assertTrue(requireValue(accepted).getBoolean("eulaAccepted"));

        Intent permissionIntent = VpnService.prepare(context);
        if (permissionIntent != null) {
            assertEquals("android.net.VpnService", permissionIntent.getAction());
        }

        JSONObject started = startVpnWithPermission("plain", plainPrimary(), plainSecondary());
        assertTrue("The VPN start call should resolve after permission is granted", started.getBoolean("ok"));
        waitForVpnState(true, VPN_START_TIMEOUT_SECONDS);
    }

    @Test
    public void dnsOnlyRoutingAndOrdinaryConnectivity() throws Exception {
        acceptEula();
        startVpnWithPermission("plain", plainPrimary(), plainSecondary());
        waitForVpnState(true, VPN_START_TIMEOUT_SECONDS);

        ConnectivityManager connectivity =
            (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        assertNotNull(connectivity);
        Network vpnNetwork = null;
        LinkProperties vpnProperties = null;
        for (Network network : connectivity.getAllNetworks()) {
            NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
            if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                vpnNetwork = network;
                vpnProperties = connectivity.getLinkProperties(network);
                break;
            }
        }
        assertNotNull("Android did not expose an active VPN network", vpnNetwork);
        assertNotNull(vpnProperties);

        boolean hasVirtualDnsRoute = false;
        boolean hasVirtualDnsV6Route = false;
        boolean hasDefaultRoute = false;
        for (RouteInfo route : vpnProperties.getRoutes()) {
            if (route.isDefaultRoute()) {
                hasDefaultRoute = true;
            }
            if (route.getDestination() != null &&
                VIRTUAL_DNS.equals(route.getDestination().getAddress().getHostAddress()) &&
                route.getDestination().getPrefixLength() == 32) {
                hasVirtualDnsRoute = true;
            }
            if (route.getDestination() != null &&
                VIRTUAL_DNS_V6.equalsIgnoreCase(route.getDestination().getAddress().getHostAddress()) &&
                route.getDestination().getPrefixLength() == 128) {
                hasVirtualDnsV6Route = true;
            }
        }
        assertTrue("The VPN must own the virtual DNS /32 route", hasVirtualDnsRoute);
        assertTrue("The VPN must own the virtual DNS IPv6 /128 route", hasVirtualDnsV6Route);
        assertFalse("DNS-only protection must not install a default route", hasDefaultRoute);

        byte[] response = queryVirtualDns();
        assertTrue(
            isFixtureMode()
                ? "FIXTURE_FAILURE: the virtual DNS endpoint did not return a DNS response"
                : "The virtual DNS endpoint must return a DNS response",
            response.length >= 12
        );
        assertEquals("DNS response ID must match the query ID", 0x534e, readUnsignedShort(response, 0));
        assertResolverResponse(response);

        byte[] ipv6Response = queryVirtualDnsV6();
        assertTrue("The virtual IPv6 DNS endpoint must return a DNS response",
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

    @Test
    public void dohAndDotFallback() throws Exception {
        acceptEula();

        JSONObject dohStarted = startVpnWithPermission(
            "doh",
            "https://192.0.2.1/dns-query",
            dohSecondary()
        );
        assertTrue(dohStarted.getBoolean("ok"));
        waitForVpnState(true, VPN_START_TIMEOUT_SECONDS);
        byte[] dohResponse = queryVirtualDns();
        assertResolverResponse(dohResponse);
        stopAndAssertClean();

        JSONObject dotStarted = startVpnWithPermission("dot", "192.0.2.1", dotSecondary());
        assertTrue(dotStarted.getBoolean("ok"));
        waitForVpnState(true, VPN_START_TIMEOUT_SECONDS);
        byte[] dotResponse = queryVirtualDns();
        assertResolverResponse(dotResponse);
        stopAndAssertClean();
    }

    private void acceptEula() throws Exception {
        JSONObject status = callVpn(
            "window.Capacitor.Plugins.SafeNetVpn.getStatus()"
        );
        if (!requireValue(status).getBoolean("eulaAccepted")) {
            JSONObject accepted = callVpn(
                "window.Capacitor.Plugins.SafeNetVpn.acceptEula({\"version\":\"1.0\"})"
            );
            assertTrue(requireValue(accepted).getBoolean("eulaAccepted"));
        }
    }

    private JSONObject startVpnWithPermission(String type, String primary, String secondary)
        throws Exception {
        JSONObject result = callVpn(
            "window.Capacitor.Plugins.SafeNetVpn.start(" +
                "{\"type\":\"" + jsQuote(type) + "\",\"primaryAddress\":\"" +
                jsQuote(primary) + "\",\"secondaryAddress\":\"" + jsQuote(secondary) + "\"})",
            true
        );
        if (!result.getBoolean("ok")) {
            fail("VPN start failed code=" + result.optString("code") +
                " message=" + result.optString("message"));
        }
        return result;
    }

    private void stopAndAssertClean() throws Exception {
        JSONObject stopped = callVpn("window.Capacitor.Plugins.SafeNetVpn.stop()");
        assertTrue(stopped.getBoolean("ok"));
        waitForVpnState(false, 10);
    }

    private JSONObject callVpn(String expression) throws Exception {
        return callVpn(expression, false);
    }

    private JSONObject callVpn(String expression, boolean handlePermission) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        String[] rawResult = new String[1];
        TestResultBridge resultBridge = new TestResultBridge(rawResult, completed);
        String script =
            "(async function() {" +
                "try { return JSON.stringify({ok:true,value:await (" + expression + ")}); }" +
                "catch (error) { return JSON.stringify({ok:false,message:String(error.message||error)," +
                    "code:error.code||''}); }" +
            "})()" +
            ".then(function(value) { window.SafeNetTestBridge.resolve(value); })" +
            ".catch(function(error) { window.SafeNetTestBridge.resolve(" +
                "JSON.stringify({ok:false,message:String(error.message||error),code:error.code||''})); })";

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            webView.addJavascriptInterface(resultBridge, "SafeNetTestBridge");
            webView.evaluateJavascript(script, null);
        });

        try {
            if (handlePermission && VpnService.prepare(context) != null) {
                grantVpnPermissionDialog();
            }
            if (!completed.await(JS_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                throw new AssertionError("Timed out waiting for SafeNetVpn bridge call: " + expression);
            }
            if (rawResult[0] == null) {
                throw new AssertionError("SafeNetVpn bridge returned no result");
            }
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                ((MainActivity) activity).getBridge().getWebView()
                    .removeJavascriptInterface("SafeNetTestBridge")
            );
        }
        return new JSONObject(rawResult[0]);
    }

    private JSONObject requireValue(JSONObject result) throws Exception {
        assertTrue("SafeNetVpn bridge call failed: " + result.optString("message"),
            result.getBoolean("ok"));
        return result.getJSONObject("value");
    }

    private void waitForBridge() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            try {
                JSONObject result = callVpn(
                    "Boolean(window.Capacitor && window.Capacitor.Plugins && " +
                        "window.Capacitor.Plugins.SafeNetVpn)"
                );
                if (result.getBoolean("ok") && result.getBoolean("value")) {
                    return;
                }
            } catch (Exception ignored) {
                // The WebView can take a few seconds to load the bundled app.
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Capacitor SafeNetVpn plugin was not available");
    }

    private void waitForVpnState(boolean expected, long timeoutSeconds) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds);
        while (System.nanoTime() < deadline) {
            try {
                JSONObject result = callVpn(
                    "window.Capacitor.Plugins.SafeNetVpn.getStatus()"
                );
                if (result.getBoolean("ok") &&
                    expected == result.getJSONObject("value").getBoolean("running")) {
                    return;
                }
                if (!expected && result.getBoolean("ok") &&
                    result.getJSONObject("value").optString("error", "").length() > 0) {
                    throw new AssertionError("VPN reported an error while stopping: " +
                        result.getJSONObject("value").optString("error"));
                }
            } catch (AssertionError error) {
                throw error;
            } catch (Exception ignored) {
                // The bridge may be busy completing a permission result.
            }
            Thread.sleep(250);
        }
        String error = "";
        try {
            JSONObject status = callVpn(
                "window.Capacitor.Plugins.SafeNetVpn.getStatus()"
            );
            if (status.optBoolean("ok", false)) {
                error = requireValue(status).optString("error", "");
            } else {
                error = status.optString("message", "");
            }
        } catch (Exception ignored) {
            // Keep the timeout evidence useful even if the WebView is gone.
        }
        String category = classifyNetworkFailure(error);
        throw new AssertionError("VPN state did not become " + expected +
            " category=" + category + " error=" + error);
    }

    private void grantVpnPermissionDialog() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            UiObject2 allow = device.findObject(
                By.text(Pattern.compile("(?i)(allow|ok|connect|i trust this application)"))
            );
            if (allow != null && allow.isEnabled()) {
                allow.click();
                return;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Android VPN permission dialog did not appear");
    }

    private byte[] queryVirtualDns() throws Exception {
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
                query, query.length, new InetSocketAddress(VIRTUAL_DNS, DNS_PORT)
            );
            socket.send(request);
            byte[] buffer = new byte[65535];
            DatagramPacket response = new DatagramPacket(buffer, buffer.length);
            socket.receive(response);
            byte[] result = new byte[response.getLength()];
            System.arraycopy(response.getData(), response.getOffset(), result, 0, response.getLength());
            return result;
        } catch (IOException error) {
            String category = classifyResolverFailure(error.getMessage());
            throw new AssertionError("DNS query failed category=" + category +
                " message=" + error.getMessage(), error);
        }
    }

    private byte[] queryVirtualDnsV6() throws Exception {
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
                query, query.length, new InetSocketAddress(VIRTUAL_DNS_V6, DNS_PORT)
            );
            socket.send(request);
            byte[] buffer = new byte[65535];
            DatagramPacket response = new DatagramPacket(buffer, buffer.length);
            socket.receive(response);
            byte[] result = new byte[response.getLength()];
            System.arraycopy(response.getData(), response.getOffset(), result, 0, response.getLength());
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
            isFixtureMode()
                ? "FIXTURE_FAILURE: the virtual DNS endpoint did not return a DNS response"
                : "The virtual DNS endpoint must return a DNS response",
            response.length >= 12
        );
        if (isFixtureMode()) {
            byte[] expectedAddress = new byte[] {(byte) 203, 0, 113, 7};
            assertTrue(
                "FIXTURE_FAILURE: controlled resolver returned an unexpected DNS response",
                containsBytes(response, expectedAddress)
            );
        }
    }

    private static boolean containsBytes(byte[] value, byte[] expected) {
        for (int start = 0; start <= value.length - expected.length; start++) {
            boolean matches = true;
            for (int offset = 0; offset < expected.length; offset++) {
                if (value[start + offset] != expected[offset]) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                return true;
            }
        }
        return false;
    }

    private void checkOrdinaryConnectivity() throws Exception {
        String url = argument("ordinary-url", "https://example.com/");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(7000);
            connection.setReadTimeout(7000);
            connection.setInstanceFollowRedirects(false);
            int responseCode = connection.getResponseCode();
            assertTrue("Ordinary non-DNS connectivity returned an HTTP error",
                responseCode >= 200 && responseCode < 500);
        } catch (IOException error) {
            String category = isFixtureMode()
                ? classifyResolverFailure(error.getMessage())
                : classifyNetworkFailure(error.getMessage());
            fail("Ordinary non-DNS connectivity failed category=" + category +
                " message=" + error.getMessage());
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private String plainPrimary() {
        return argument("plain-primary", "1.1.1.1");
    }

    private String plainSecondary() {
        return argument("plain-secondary", "8.8.8.8");
    }

    private String dohSecondary() {
        return argument("doh-secondary", "https://cloudflare-dns.com/dns-query");
    }

    private String dotSecondary() {
        return argument("dot-secondary", "cloudflare-dns.com");
    }

    private String argument(String name, String fallback) {
        Bundle arguments = InstrumentationRegistry.getArguments();
        String value = arguments.getString(name);
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private static int readUnsignedShort(byte[] value, int offset) {
        return ((value[offset] & 0xff) << 8) | (value[offset + 1] & 0xff);
    }

    private static String jsQuote(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static String classifyNetworkFailure(String message) {
        String normalized = message == null ? "" : message.toUpperCase(Locale.US);
        if (normalized.contains("ENETUNREACH") || normalized.contains("NETWORK IS UNREACHABLE")) {
            return "ENETUNREACH";
        }
        if (normalized.contains("EAI_AGAIN") || normalized.contains("UNKNOWNHOST") ||
            normalized.contains("TIMED OUT") || normalized.contains("TIMEOUT") ||
            normalized.contains("ECONNREFUSED") || normalized.contains("CONNECTION RESET")) {
            return "UNRELATED_NETWORK_FAILURE";
        }
        return "NON_NETWORK_FAILURE";
    }

    private String classifyResolverFailure(String message) {
        String category = classifyNetworkFailure(message);
        if (isFixtureMode() &&
            ("NON_NETWORK_FAILURE".equals(category) ||
                (message != null && message.toUpperCase(Locale.US).contains("ECONNREFUSED")))) {
            return "FIXTURE_FAILURE";
        }
        return category;
    }

    private boolean isFixtureMode() {
        return "fixture".equals(argument("resolver-mode", "public"));
    }

    private static final class TestResultBridge {
        private final String[] result;
        private final CountDownLatch completed;

        TestResultBridge(String[] result, CountDownLatch completed) {
            this.result = result;
            this.completed = completed;
        }

        @JavascriptInterface
        public void resolve(String value) {
            result[0] = value;
            completed.countDown();
        }
    }
}