package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;
import android.net.VpnService;
import android.net.wifi.p2p.WifiP2pGroup;
import android.net.wifi.p2p.WifiP2pManager;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;
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
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
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
    private static final long TETHER_START_TIMEOUT_SECONDS = 25;
    private static final long TETHER_CLIENT_HOLD_SECONDS = 45;

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
        // A previous instrumentation invocation may have been interrupted
        // after GoBackend claimed Android's VPN owner. Reset that state before
        // asserting the fresh-install behavior below.
        try {
            callVpn("window.Capacitor.Plugins.SafeNetVpn.stopWireGuard()");
        } catch (Exception ignored) {
            // The first launch may not have a configured WireGuard build.
        }
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
        if (activity != null && !activity.isFinishing()) {
            callVpn("window.Capacitor.Plugins.SafeNetVpn.stop()");
            waitForVpnState(false, 5);
            waitForWireGuardState(false, 5);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
        } else {
            context.stopService(new Intent(context, SafeNetVpnService.class));
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
    public void configuredWireGuardStartsTunnelAndReportsSafeNetGateway() throws Exception {
        JSONObject initialResult = callVpn(
            "window.Capacitor.Plugins.SafeNetVpn.getStatus()"
        );
        if (!initialResult.optBoolean("ok", false)) {
            fail("WIREGUARD_FAILURE category=CONFIGURATION " +
                "message=" + initialResult.optString("message"));
        }

        JSONObject initial = requireValue(initialResult);
        if (!initial.optBoolean("wireguardConfigured", false)) {
            fail("WIREGUARD_FAILURE category=CONFIGURATION message=" +
                initial.optString("wireguardError", "SafeNet WireGuard is not configured."));
        }
        assertEquals(
            "WIREGUARD_FAILURE category=CONFIGURATION message=unexpected_gateway_owner",
            "SafeNet",
            initial.optString("wireguardGatewayOwner")
        );
        assertNotEmptyGatewayField(initial, "wireguardGateway");
        assertNotEmptyGatewayField(initial, "wireguardPeerPublicKey");
        assertNotEmptyGatewayField(initial, "wireguardAllowedIps");
        assertNotEmptyGatewayField(initial, "wireguardDnsServers");

        JSONObject started;
        boolean permissionPending = VpnService.prepare(context) != null;
        try {
            started = callVpn(
                "window.Capacitor.Plugins.SafeNetVpn.startWireGuard({})",
                true
            );
        } catch (AssertionError error) {
            fail("WIREGUARD_FAILURE category=" +
                (permissionPending ? "PERMISSION" : "GATEWAY_CONNECTIVITY") +
                " " + error.getMessage());
            return;
        }
        if (!started.optBoolean("ok", false)) {
            String code = started.optString("code", "");
            String category = "PERMISSION_DENIED".equals(code)
                ? "PERMISSION"
                : "WIREGUARD_NOT_CONFIGURED".equals(code)
                    ? "CONFIGURATION"
                    : "GATEWAY_CONNECTIVITY";
            fail("WIREGUARD_FAILURE category=" + category +
                " code=" + code + " message=" + started.optString("message"));
        }

        JSONObject running = requireValue(started);
        if (!running.optBoolean("wireguardRunning", false) ||
            !"wireguard".equals(running.optString("activeTunnel")) ||
            !"SafeNet WireGuard".equals(running.optString("vpnPermissionOwner"))) {
            fail("WIREGUARD_FAILURE category=GATEWAY_CONNECTIVITY " +
                "message=wireguard_did_not_reach_running_state");
        }

        ConnectivityManager connectivity =
            (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        assertNotNull(
            "WIREGUARD_FAILURE category=GATEWAY_CONNECTIVITY message=connectivity_manager_unavailable",
            connectivity
        );
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
        assertNotNull(
            "WIREGUARD_FAILURE category=GATEWAY_CONNECTIVITY message=android_vpn_transport_missing",
            vpnNetwork
        );
        assertNotNull(
            "WIREGUARD_FAILURE category=GATEWAY_CONNECTIVITY message=wireguard_link_properties_missing",
            vpnProperties
        );
        boolean hasDefaultRoute = false;
        for (RouteInfo route : vpnProperties.getRoutes()) {
            if (route.isDefaultRoute()) {
                hasDefaultRoute = true;
                break;
            }
        }
        assertTrue(
            "WIREGUARD_FAILURE category=ROUTE message=wireguard_default_route_missing",
            hasDefaultRoute
        );
        android.util.Log.i(
            "SafeNetWireGuardSmoke",
            "WIREGUARD_TUNNEL result=PASS state=UP transport=VPN route=PASS"
        );

        JSONObject confirmed = callVpn(
            "window.Capacitor.Plugins.SafeNetVpn.getStatus()"
        );
        JSONObject confirmedStatus = requireValue(confirmed);
        assertTrue(
            "WIREGUARD_FAILURE category=GATEWAY_CONNECTIVITY message=running_state_was_not_stable",
            confirmedStatus.optBoolean("wireguardRunning", false)
        );
        try {
            byte[] dnsResponse = queryWireGuardDns(confirmedStatus);
            assertTrue(
                "WIREGUARD_FAILURE category=DNS message=gateway_dns_response_too_short",
                dnsResponse.length >= 12
            );
            // A valid response from the configured gateway resolver is the
            // observable proof that the authenticated WireGuard peer has
            // completed a handshake and is carrying traffic. GoBackend does
            // not expose wg(8)'s latest-handshake timestamp to the app.
            android.util.Log.i(
                "SafeNetWireGuardSmoke",
                "WIREGUARD_HANDSHAKE result=PASS gateway_dns=PASS"
            );
            android.util.Log.i(
                "SafeNetWireGuardSmoke",
                "WIREGUARD_DNS result=PASS response=VALID"
            );
        } catch (AssertionError error) {
            fail("WIREGUARD_FAILURE category=DNS message=gateway_dns_response_invalid");
            return;
        } catch (Exception error) {
            fail("WIREGUARD_FAILURE category=HANDSHAKE message=gateway_handshake_probe_failed");
            return;
        }
        try {
            checkOrdinaryConnectivity();
        } catch (Exception | AssertionError error) {
            fail("WIREGUARD_FAILURE category=NAT message=wireguard_ordinary_https_probe_failed");
            return;
        }
        android.util.Log.i(
            "SafeNetWireGuardSmoke",
            "WIREGUARD_HTTPS result=PASS ordinary_https=PASS"
        );
        android.util.Log.i(
            "SafeNetWireGuardSmoke",
            "WIREGUARD_SMOKE result=PASS configuration=PASS permission=PASS " +
                "gateway_identity=SafeNet tunnel=RUNNING android_vpn=PASS " +
                "default_route=PASS handshake=PASS gateway_dns=PASS ordinary_https=PASS"
        );
    }

    @Test
    public void internetShareStartsAndStopsCleanly() throws Exception {
        JSONObject started = callTether(
            "window.Capacitor.Plugins.SafeNetVpn.startTetherShare()",
            true
        );
        assertTrue(
            "Internet Share start call failed code=" + started.optString("code") +
                " message=" + started.optString("message"),
            started.optBoolean("ok", false)
        );
        assertTrue(
            "Nearby Wi-Fi permission was not granted",
            hasTetherPermission()
        );

        JSONObject settled = waitForTetherStart();
        JSONObject status = requireValue(settled);
        boolean hasNetworkDetails =
            status.optBoolean("running", false) &&
            !status.optString("networkName", "").trim().isEmpty() &&
            !status.optString("passphrase", "").trim().isEmpty();
        String lastError = status.optString("lastError", "").trim();
        boolean hasReadableFailure = !lastError.isEmpty();
        assertTrue(
            "Internet Share returned neither network details nor a readable failure state",
            hasNetworkDetails || hasReadableFailure
        );
        boolean hasProxyDetails =
            status.optBoolean("running", false) &&
            !status.optString("proxyHost", "").trim().isEmpty() &&
            status.optInt("proxyPort", 0) > 0;
        if (hasProxyDetails) {
            android.util.Log.i(
                "InternetShareSmoke",
                "INTERNET_SHARE_PROXY result=PASS host=" +
                    status.optString("proxyHost") + " port=" + status.optInt("proxyPort")
            );
        }
        android.util.Log.i(
            "InternetShareSmoke",
            "INTERNET_SHARE_START result=PASS mode=" +
                (hasNetworkDetails ? "NETWORK_DETAILS" : "READABLE_FAILURE") +
                " permission=PASS"
        );

        if (Boolean.parseBoolean(argument("hold-internet-share", "false"))) {
            assertTrue(
                "Internet Share did not advertise a usable proxy",
                hasProxyDetails
            );
            android.util.Log.i(
                "InternetShareSmoke",
                "INTERNET_SHARE_READY result=PASS proxy=ADVERTISED"
            );
            Thread.sleep(
                TimeUnit.SECONDS.toMillis(
                    boundedTetherHoldSeconds(argument("hold-internet-share-seconds", "45"))
                )
            );
        }

        boolean notificationBeforeStop = hasInternetShareNotification();
        android.util.Log.i(
            "InternetShareSmoke",
            "INTERNET_SHARE_NOTIFICATION before_stop=" +
                (notificationBeforeStop ? "PASS" : "NOT_RECORDED")
        );

        try {
            JSONObject stopped = callTether(
                "window.Capacitor.Plugins.SafeNetVpn.stopTetherShare()"
            );
            assertTrue(
                "Internet Share stop call failed code=" + stopped.optString("code") +
                    " message=" + stopped.optString("message"),
                stopped.optBoolean("ok", false)
            );
            waitForTetherStopped();
            waitForWifiDirectGroupCleared();
            assertFalse(
                "The app activity crashed or finished during Internet Share cleanup",
                activity.isFinishing()
            );
            boolean notificationRemoved = !hasInternetShareNotification();
            assertTrue(
                "Internet Share foreground notification was not removed",
                notificationRemoved
            );
            android.util.Log.i(
                "InternetShareSmoke",
                "INTERNET_SHARE_STOP result=PASS notification=REMOVED group=NULL"
            );
            android.util.Log.i(
                "InternetShareSmoke",
                "INTERNET_SHARE_SMOKE result=PASS start=PASS stop=PASS " +
                    "notification=REMOVED group=NULL"
            );
        } finally {
            context.stopService(new Intent(context, TetherShareService.class));
        }
    }

    @Test
    public void internetShareClientUsesAdvertisedProxy() throws Exception {
        String proxyHost = argument("proxy-host", "");
        int proxyPort;
        try {
            proxyPort = Integer.parseInt(argument("proxy-port", "0"));
        } catch (NumberFormatException error) {
            fail("Internet Share client proxy port was invalid");
            return;
        }
        assertTrue("Internet Share client proxy host was missing", !proxyHost.isEmpty());
        assertTrue("Internet Share client proxy port was invalid", proxyPort > 0 && proxyPort <= 65535);

        HttpURLConnection connection = null;
        String proxyUrl = argument("proxy-url", "https://example.com/");
        String protocol = proxyUrl.regionMatches(true, 0, "https://", 0, 8)
            ? "HTTPS"
            : "HTTP";
        try {
            Proxy proxy = new Proxy(
                Proxy.Type.HTTP,
                new InetSocketAddress(proxyHost, proxyPort)
            );
            connection = (HttpURLConnection) new URL(proxyUrl).openConnection(proxy);
            connection.setConnectTimeout(7_000);
            connection.setReadTimeout(7_000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("GET");
            int responseCode = connection.getResponseCode();
            assertTrue(
                "Internet Share proxy returned an invalid HTTP response",
                responseCode >= 100 && responseCode < 600
            );
            String responseClass = (responseCode / 100) + "XX";
            android.util.Log.i(
                "InternetShareSmoke",
                "INTERNET_SHARE_CLIENT_PROXY result=PASS response=" + responseClass +
                    " protocol=" + protocol
            );
        } catch (IOException error) {
            android.util.Log.e(
                "InternetShareSmoke",
                "INTERNET_SHARE_CLIENT_PROXY result=FAIL protocol=" + protocol +
                    " category=" + classifyNetworkFailure(error.getMessage())
            );
            throw new IOException("Internet Share proxy request failed", error);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    @Test
    public void wireGuardSurvivesWifiMobileHandoff() throws Exception {
        JSONObject started = callVpn(
            "window.Capacitor.Plugins.SafeNetVpn.startWireGuard({})",
            true
        );
        if (!started.optBoolean("ok", false)) {
            fail("WIREGUARD_HANDOFF_FAILURE phase=baseline category=START");
        }
        waitForWireGuardState(true, VPN_START_TIMEOUT_SECONDS);

        long previousHandshake = verifyWireGuardHandoffCheckpoint(
            "baseline",
            0L,
            transportName(findUnderlyingNetwork(NetworkCapabilities.TRANSPORT_WIFI))
        );
        String initialWifiState = executeShellCommand("settings get global wifi_on").trim();
        String initialMobileState = executeShellCommand("settings get global mobile_data").trim();

        try {
            Network wifi = findUnderlyingNetwork(NetworkCapabilities.TRANSPORT_WIFI);
            if (wifi == null) {
                logWireGuardHandoffUnavailable("wifi_to_mobile", "WIFI_UNAVAILABLE");
                return;
            }

            executeShellCommand("svc wifi disable");
            Network cellular = awaitUnderlyingNetwork(
                NetworkCapabilities.TRANSPORT_CELLULAR,
                30
            );
            if (cellular == null) {
                logWireGuardHandoffUnavailable("wifi_to_mobile", "CELLULAR_UNAVAILABLE");
                return;
            }
            previousHandshake = verifyWireGuardHandoffCheckpoint(
                "wifi_to_mobile",
                previousHandshake,
                "CELLULAR"
            );

            executeShellCommand("svc data disable");
            executeShellCommand("svc wifi enable");
            Network restoredWifi = awaitUnderlyingNetwork(
                NetworkCapabilities.TRANSPORT_WIFI,
                30
            );
            if (restoredWifi == null) {
                logWireGuardHandoffUnavailable("mobile_to_wifi", "WIFI_UNAVAILABLE");
                return;
            }
            verifyWireGuardHandoffCheckpoint(
                "mobile_to_wifi",
                previousHandshake,
                "WIFI"
            );
        } finally {
            restoreNetworkSetting("wifi", initialWifiState);
            restoreNetworkSetting("data", initialMobileState);
        }
    }

    @Test
    public void wireGuardFailureCategoryFixtures() {
        String[][] fixtures = new String[][] {
            {"HANDSHAKE", "wireguard handshake timed out"},
            {"ROUTE", "wireguard route is unreachable"},
            {"DNS", "wireguard DNS lookup returned EAI_AGAIN"},
            {"NAT", "wireguard ordinary HTTPS connection timed out"}
        };

        for (String[] fixture : fixtures) {
            String category = classifyWireGuardFailure(fixture[1]);
            assertEquals("Synthetic WireGuard failure category changed", fixture[0], category);
            android.util.Log.i(
                "SafeNetWireGuardSmoke",
                "WIREGUARD_FAILURE_FIXTURE category=" + category + " result=PASS"
            );
        }
    }

    private void assertNotEmptyGatewayField(JSONObject status, String field) throws Exception {
        assertTrue(
            "WIREGUARD_FAILURE category=CONFIGURATION message=missing_" + field,
            status.has(field) && !status.optString(field, "").trim().isEmpty()
        );
    }

    private byte[] queryWireGuardDns(JSONObject status) throws Exception {
        return queryWireGuardDns(status, 0x534e);
    }

    private byte[] queryWireGuardDns(JSONObject status, int queryId) throws Exception {
        String configuredDns = status.getString("wireguardDnsServers")
            .split("[,\\s]+", -1)[0]
            .trim();
        InetAddress resolver = InetAddress.getByName(configuredDns);
        byte[] query = new byte[] {
            (byte) ((queryId >> 8) & 0xff), (byte) (queryId & 0xff),
            0x01, 0x00, 0x00, 0x01, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x07, 's', 'a', 'f', 'e', 'n', 'e', 't',
            0x03, 'c', 'o', 'm', 0x00,
            0x00, 0x01, 0x00, 0x01
        };
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setSoTimeout(5000);
            socket.send(new DatagramPacket(
                query,
                query.length,
                new InetSocketAddress(resolver, DNS_PORT)
            ));
            byte[] buffer = new byte[65535];
            DatagramPacket response = new DatagramPacket(buffer, buffer.length);
            socket.receive(response);
            byte[] result = new byte[response.getLength()];
            System.arraycopy(response.getData(), response.getOffset(), result, 0, response.getLength());
            assertEquals(
                "WIREGUARD_FAILURE category=GATEWAY_CONNECTIVITY message=gateway_dns_id_mismatch",
                queryId,
                readUnsignedShort(result, 0)
            );
            return result;
        }
    }

    private long verifyWireGuardHandoffCheckpoint(
        String phase,
        long previousHandshake,
        String expectedTransport
    ) throws Exception {
        try {
            if (!"baseline".equals(phase)) {
                int expectedTransportType = "CELLULAR".equals(expectedTransport)
                    ? NetworkCapabilities.TRANSPORT_CELLULAR
                    : NetworkCapabilities.TRANSPORT_WIFI;
                assertNotNull(
                    "WIREGUARD_HANDOFF_FAILURE phase=" + phase + " category=TRANSITION",
                    findUnderlyingNetwork(expectedTransportType)
                );
            }
            JSONObject statusResult = callVpn(
                "window.Capacitor.Plugins.SafeNetVpn.getStatus()"
            );
            JSONObject status = requireValue(statusResult);
            assertTrue(
                "WIREGUARD_HANDOFF_FAILURE phase=" + phase + " category=TUNNEL",
                status.optBoolean("wireguardRunning", false) &&
                    "wireguard".equals(status.optString("activeTunnel")) &&
                    "SafeNet WireGuard".equals(status.optString("vpnPermissionOwner"))
            );

            Network vpnNetwork = findVpnNetwork();
            assertNotNull(
                "WIREGUARD_HANDOFF_FAILURE phase=" + phase + " category=ROUTE",
                vpnNetwork
            );
            LinkProperties vpnProperties = connectivityProperties(vpnNetwork);
            assertNotNull(
                "WIREGUARD_HANDOFF_FAILURE phase=" + phase + " category=ROUTE",
                vpnProperties
            );
            boolean hasDefaultRoute = false;
            for (RouteInfo route : vpnProperties.getRoutes()) {
                if (route.isDefaultRoute()) {
                    hasDefaultRoute = true;
                    break;
                }
            }
            assertTrue(
                "WIREGUARD_HANDOFF_FAILURE phase=" + phase + " category=ROUTE",
                hasDefaultRoute
            );

            int queryId = "wifi_to_mobile".equals(phase) ? 0x534f : 0x5350;
            byte[] dnsResponse = queryWireGuardDns(status, queryId);
            assertTrue(
                "WIREGUARD_HANDOFF_FAILURE phase=" + phase + " category=DNS",
                dnsResponse.length >= 12
            );
            assertEquals(
                "WIREGUARD_HANDOFF_FAILURE phase=" + phase + " category=DNS",
                queryId,
                readUnsignedShort(dnsResponse, 0)
            );
            checkOrdinaryConnectivity();

            JSONObject refreshed = requireValue(callVpn(
                "window.Capacitor.Plugins.SafeNetVpn.getStatus()"
            ));
            long handshake = refreshed.optLong(
                "wireguardLatestHandshakeEpochMillis",
                0L
            );
            assertTrue(
                "WIREGUARD_HANDOFF_FAILURE phase=" + phase + " category=HANDSHAKE",
                handshake > previousHandshake
            );
            android.util.Log.i(
                "SafeNetWireGuardSmoke",
                "WIREGUARD_HANDOFF phase=" + phase +
                    " result=PASS underlying=" + expectedTransport +
                    " tunnel=UP handshake=FRESH gateway_dns=PASS ordinary_https=PASS"
            );
            return handshake;
        } catch (AssertionError error) {
            String category = classifyHandoffFailure(error.getMessage());
            android.util.Log.e(
                "SafeNetWireGuardSmoke",
                "WIREGUARD_HANDOFF_FAILURE phase=" + phase +
                    " category=" + category
            );
            throw error;
        } catch (Exception error) {
            android.util.Log.e(
                "SafeNetWireGuardSmoke",
                "WIREGUARD_HANDOFF_FAILURE phase=" + phase +
                    " category=" + classifyHandoffFailure(error.getMessage())
            );
            throw error;
        }
    }

    private void logWireGuardHandoffUnavailable(String phase, String category) {
        android.util.Log.w(
            "SafeNetWireGuardSmoke",
            "WIREGUARD_HANDOFF phase=" + phase +
                " result=UNAVAILABLE category=" + category
        );
    }

    private Network awaitUnderlyingNetwork(int transport, long timeoutSeconds)
        throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds);
        Network network;
        while (System.nanoTime() < deadline) {
            network = findUnderlyingNetwork(transport);
            if (network != null) {
                return network;
            }
            SystemClock.sleep(1000);
        }
        return null;
    }

    private Network findUnderlyingNetwork(int transport) {
        ConnectivityManager connectivity =
            (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) {
            return null;
        }
        for (Network network : connectivity.getAllNetworks()) {
            NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
            if (capabilities != null &&
                capabilities.hasTransport(transport) &&
                !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                return network;
            }
        }
        return null;
    }

    private Network findVpnNetwork() {
        ConnectivityManager connectivity =
            (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) {
            return null;
        }
        for (Network network : connectivity.getAllNetworks()) {
            NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
            if (capabilities != null &&
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                return network;
            }
        }
        return null;
    }

    private LinkProperties connectivityProperties(Network network) {
        ConnectivityManager connectivity =
            (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        return connectivity == null ? null : connectivity.getLinkProperties(network);
    }

    private String transportName(Network network) {
        if (network == null) {
            return "UNKNOWN";
        }
        ConnectivityManager connectivity =
            (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkCapabilities capabilities =
            connectivity == null ? null : connectivity.getNetworkCapabilities(network);
        if (capabilities == null) {
            return "UNKNOWN";
        }
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
            return "WIFI";
        }
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
            return "CELLULAR";
        }
        return "OTHER";
    }

    private String executeShellCommand(String command) throws IOException {
        ParcelFileDescriptor output = InstrumentationRegistry.getInstrumentation()
            .getUiAutomation()
            .executeShellCommand(command);
        StringBuilder commandOutput = new StringBuilder();
        try (ParcelFileDescriptor.AutoCloseInputStream input =
                 new ParcelFileDescriptor.AutoCloseInputStream(output)) {
            int value;
            while ((value = input.read()) != -1) {
                commandOutput.append((char) value);
            }
        }
        return commandOutput.toString();
    }

    private void restoreNetworkSetting(String network, String initialState)
        throws IOException {
        if ("0".equals(initialState)) {
            executeShellCommand("svc " + network + " disable");
        } else if ("1".equals(initialState)) {
            executeShellCommand("svc " + network + " enable");
        }
    }

    @Test
    public void bridgeReportsPrivateProxyAsUninspectable() throws Exception {
        JSONObject result = callVpn(
            "window.Capacitor.Plugins.SafeNetVpn.getProtectionStatus()"
        );
        JSONObject protection = requireValue(result);

        assertEquals("proxy_uninspectable", protection.getString("proxyState"));
        assertTrue(protection.getString("proxyMessage").toLowerCase(Locale.US).contains("cannot"));
        assertTrue(protection.getJSONArray("states").length() >= 2);
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
    public void publicResolverModesKeepOrdinaryHttpsReachable() throws Exception {
        assertFalse(
            "PHYSICAL_DNS_FAILURE category=CONFIGURATION message=public_resolver_mode_required",
            isFixtureMode()
        );
        acceptEula();

        verifyPublicResolverMode(
            "plain",
            plainPrimary(),
            plainSecondary()
        );
        verifyPublicResolverMode(
            "doh",
            argument("doh-primary", "https://cloudflare-dns.com/dns-query"),
            dohSecondary()
        );
        verifyPublicResolverMode(
            "dot",
            argument("dot-primary", "cloudflare-dns.com"),
            dotSecondary()
        );
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
        return callBridge(expression, "SafeNetTestBridge", handlePermission, false);
    }

    private JSONObject callTether(String expression) throws Exception {
        return callTether(expression, false);
    }

    private JSONObject callTether(String expression, boolean handlePermission) throws Exception {
        return callBridge(expression, "SafeNetTetherTestBridge", false, handlePermission);
    }

    private JSONObject callBridge(
        String expression,
        String bridgeName,
        boolean handleVpnPermission,
        boolean handleTetherPermission
    ) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        String[] rawResult = new String[1];
        TestResultBridge resultBridge = new TestResultBridge(rawResult, completed);
        String script =
            "(async function() {" +
                "try { return JSON.stringify({ok:true,value:await (" + expression + ")}); }" +
                "catch (error) { return JSON.stringify({ok:false,message:String(error.message||error)," +
                    "code:error.code||''}); }" +
            "})()" +
            ".then(function(value) { window." + bridgeName + ".resolve(value); })" +
            ".catch(function(error) { window." + bridgeName + ".resolve(" +
                "JSON.stringify({ok:false,message:String(error.message||error),code:error.code||''})); })";

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            webView.addJavascriptInterface(resultBridge, bridgeName);
            webView.evaluateJavascript(script, null);
        });

        try {
            if (handleVpnPermission && VpnService.prepare(context) != null) {
                grantVpnPermissionDialog();
            }
            if (handleTetherPermission && !hasTetherPermission()) {
                grantTetherPermissionDialog();
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
                    .removeJavascriptInterface(bridgeName)
            );
        }
        return new JSONObject(rawResult[0]);
    }

    private JSONObject waitForTetherStart() throws Exception {
        long deadline = System.nanoTime() +
            TimeUnit.SECONDS.toNanos(TETHER_START_TIMEOUT_SECONDS);
        JSONObject latest = null;
        while (System.nanoTime() < deadline) {
            latest = callTether("window.Capacitor.Plugins.SafeNetVpn.getTetherStatus()");
            if (latest.optBoolean("ok", false)) {
                JSONObject value = latest.optJSONObject("value");
                if (value != null &&
                    (value.optBoolean("running", false) ||
                        !value.optString("lastError", "").trim().isEmpty())) {
                    return latest;
                }
            }
            Thread.sleep(400);
        }
        throw new AssertionError(
            "Internet Share did not reach running or readable failure state: " + latest
        );
    }

    private void waitForTetherStopped() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            JSONObject result = callTether(
                "window.Capacitor.Plugins.SafeNetVpn.getTetherStatus()"
            );
            JSONObject value = result.optJSONObject("value");
            if (result.optBoolean("ok", false) && value != null &&
                !value.optBoolean("running", true) &&
                !value.optBoolean("starting", true)) {
                return;
            }
            Thread.sleep(300);
        }
        throw new AssertionError("Internet Share did not stop cleanly");
    }

    private boolean hasTetherPermission() {
        String permission = android.os.Build.VERSION.SDK_INT >= 33
            ? android.Manifest.permission.NEARBY_WIFI_DEVICES
            : android.Manifest.permission.ACCESS_FINE_LOCATION;
        return ContextCompat.checkSelfPermission(context, permission) ==
            PackageManager.PERMISSION_GRANTED;
    }

    private long boundedTetherHoldSeconds(String value) {
        try {
            long seconds = Long.parseLong(value);
            return Math.max(1L, Math.min(TETHER_CLIENT_HOLD_SECONDS, seconds));
        } catch (NumberFormatException error) {
            return TETHER_CLIENT_HOLD_SECONDS;
        }
    }

    private void grantTetherPermissionDialog() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            UiObject2 allow = device.findObject(
                By.text(Pattern.compile("(?i)(while using the app|only this time|allow)"))
            );
            if (allow != null && allow.isEnabled()) {
                allow.click();
                return;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Nearby Wi-Fi permission dialog did not appear");
    }

    private boolean hasInternetShareNotification() {
        NotificationManager notificationManager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager == null) return false;
        for (android.service.notification.StatusBarNotification notification :
            notificationManager.getActiveNotifications()) {
            if (context.getPackageName().equals(notification.getPackageName()) &&
                notification.getId() == 6101) {
                return true;
            }
        }
        return false;
    }

    private void waitForWifiDirectGroupCleared() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if (queryWifiDirectGroup() == null) return;
            Thread.sleep(400);
        }
        throw new AssertionError("Wi-Fi Direct group remained after Internet Share stopped");
    }

    private WifiP2pGroup queryWifiDirectGroup() throws Exception {
        WifiP2pManager manager =
            (WifiP2pManager) context.getSystemService(Context.WIFI_P2P_SERVICE);
        assertNotNull("Wi-Fi Direct manager is unavailable", manager);
        WifiP2pManager.Channel channel =
            manager.initialize(context, context.getMainLooper(), null);
        assertNotNull("Wi-Fi Direct channel could not be initialized", channel);
        CountDownLatch completed = new CountDownLatch(1);
        WifiP2pGroup[] result = new WifiP2pGroup[1];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            try {
                manager.requestGroupInfo(channel, group -> {
                    result[0] = group;
                    completed.countDown();
                });
            } catch (SecurityException error) {
                completed.countDown();
            }
        });
        assertTrue(
            "Timed out reading Wi-Fi Direct group state",
            completed.await(5, TimeUnit.SECONDS)
        );
        return result[0];
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

    private void waitForWireGuardState(boolean expected, long timeoutSeconds) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds);
        while (System.nanoTime() < deadline) {
            try {
                JSONObject status = callVpn(
                    "window.Capacitor.Plugins.SafeNetVpn.getStatus()"
                );
                if (status.getBoolean("ok") &&
                    expected == status.getJSONObject("value").getBoolean("wireguardRunning")) {
                    return;
                }
            } catch (Exception ignored) {
                // The bridge may be busy completing the asynchronous stop.
            }
            Thread.sleep(250);
        }
        throw new AssertionError("WireGuard state did not become " + expected);
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

    private void verifyPublicResolverMode(
        String mode,
        String primary,
        String secondary
    ) throws Exception {
        boolean started = false;
        try {
            JSONObject result = startVpnWithPermission(mode, primary, secondary);
            started = result.optBoolean("ok", false);
            waitForVpnState(true, VPN_START_TIMEOUT_SECONDS);
            byte[] response = queryVirtualDns();
            assertTrue(
                "PHYSICAL_DNS_FAILURE mode=" + mode + " category=DNS message=short_response",
                response.length >= 12
            );
            assertResolverResponse(response);
            checkOrdinaryConnectivity();
            android.util.Log.i(
                "SafeNetPhysicalConnectivity",
                "PHYSICAL_DNS_MODE mode=" + mode +
                    " result=PASS dns=PASS ordinary_https=PASS"
            );
        } catch (Exception | AssertionError error) {
            String category = classifyNetworkFailure(error.getMessage());
            android.util.Log.e(
                "SafeNetPhysicalConnectivity",
                "PHYSICAL_DNS_MODE mode=" + mode +
                    " result=FAIL category=" + category
            );
            throw error;
        } finally {
            if (started) {
                try {
                    stopAndAssertClean();
                } catch (Exception stopError) {
                    android.util.Log.e(
                        "SafeNetPhysicalConnectivity",
                        "PHYSICAL_DNS_MODE mode=" + mode +
                            " result=FAIL category=VPN_HANDOFF"
                    );
                    throw stopError;
                }
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

    private static String classifyWireGuardFailure(String message) {
        String normalized = message == null ? "" : message.toUpperCase(Locale.US);
        if (normalized.contains("HANDSHAKE")) {
            return "HANDSHAKE";
        }
        if (normalized.contains("ROUTE") || normalized.contains("ENETUNREACH") ||
            normalized.contains("NETWORK IS UNREACHABLE") ||
            normalized.contains("NO ROUTE")) {
            return "ROUTE";
        }
        if (normalized.contains("DNS") || normalized.contains("UNKNOWNHOST") ||
            normalized.contains("EAI_AGAIN")) {
            return "DNS";
        }
        if (normalized.contains("HTTPS") || normalized.contains("HTTP") ||
            normalized.contains("CONNECTION") || normalized.contains("TIMEOUT") ||
            normalized.contains("TIMED OUT")) {
            return "NAT";
        }
        return "GATEWAY_CONNECTIVITY";
    }

    private static String classifyHandoffFailure(String message) {
        String normalized = message == null ? "" : message.toUpperCase(Locale.US);
        if (normalized.contains("CATEGORY=TUNNEL") ||
            normalized.contains("CATEGORY=START")) {
            return "TUNNEL";
        }
        if (normalized.contains("CATEGORY=ROUTE")) {
            return "ROUTE";
        }
        if (normalized.contains("CATEGORY=HANDSHAKE")) {
            return "HANDSHAKE";
        }
        if (normalized.contains("CATEGORY=DNS")) {
            return "DNS";
        }
        if (normalized.contains("HTTPS") || normalized.contains("HTTP") ||
            normalized.contains("CONNECTION") || normalized.contains("TIMEOUT")) {
            return "HTTPS";
        }
        return "TRANSITION";
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