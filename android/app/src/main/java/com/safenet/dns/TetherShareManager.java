package com.safenet.dns;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.p2p.WifiP2pDevice;
import android.net.wifi.p2p.WifiP2pConfig;
import android.net.wifi.p2p.WifiP2pGroup;
import android.net.wifi.p2p.WifiP2pManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.UnknownHostException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Provides the no-root Wi-Fi Direct and HTTP proxy portion of Internet Share.
 *
 * Android does not expose a general-purpose tethering API to ordinary apps.
 * Wi-Fi Direct plus an explicit proxy is the supported user-space path, which
 * is also the model used by TetherFuseNet.
 */
final class TetherShareManager {
    static final int PROXY_PORT = 8080;
    static final String PROXY_HOST = "192.168.49.1";

    static final class DeviceSnapshot {
        final String name;
        final String address;

        DeviceSnapshot(String name, String address) {
            this.name = name;
            this.address = address;
        }
    }

    static final class Snapshot {
        final boolean running;
        final boolean starting;
        final String networkName;
        final String passphrase;
        final String credentialSource;
        final String proxyHost;
        final int proxyPort;
        final boolean groupOwner;
        final String lastError;
        final List<DeviceSnapshot> devices;

        Snapshot(
            boolean running,
            boolean starting,
            String networkName,
            String passphrase,
            String credentialSource,
            String proxyHost,
            int proxyPort,
            boolean groupOwner,
            String lastError,
            List<DeviceSnapshot> devices
        ) {
            this.running = running;
            this.starting = starting;
            this.networkName = networkName;
            this.passphrase = passphrase;
            this.credentialSource = credentialSource;
            this.proxyHost = proxyHost;
            this.proxyPort = proxyPort;
            this.groupOwner = groupOwner;
            this.lastError = lastError;
            this.devices = devices;
        }
    }

    private static TetherShareManager instance;
    private static final String CREDENTIAL_SOURCE_APP_DEFINED = "APP_DEFINED";
    private static final String CREDENTIAL_SOURCE_ANDROID_API = "ANDROID_API";
    private static final String CREDENTIAL_SOURCE_ANDROID_SETTINGS = "ANDROID_SETTINGS";
    private static final char[] CREDENTIAL_ALPHABET =
        "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789".toCharArray();

    static synchronized TetherShareManager get(Context context) {
        if (instance == null) {
            instance = new TetherShareManager(context.getApplicationContext());
        }
        return instance;
    }

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService proxyExecutor = Executors.newCachedThreadPool();
    private final Set<Socket> clientSockets = ConcurrentHashMap.newKeySet();
    private WifiP2pManager wifiP2pManager;
    private WifiP2pManager.Channel wifiChannel;
    private ServerSocket proxyServer;
    private volatile boolean running;
    private volatile boolean starting;
    private volatile String networkName;
    private volatile String passphrase;
    private volatile String appDefinedNetworkName;
    private volatile String credentialSource;
    private volatile boolean groupOwner;
    private volatile String lastError;
    private volatile List<DeviceSnapshot> devices = Collections.emptyList();

    private TetherShareManager(Context context) {
        this.context = context;
    }

    synchronized void start() {
        if (running || starting) return;
        lastError = null;
        starting = true;
        networkName = null;
        passphrase = null;
        appDefinedNetworkName = null;
        credentialSource = null;
        try {
            wifiP2pManager = (WifiP2pManager) context.getSystemService(Context.WIFI_P2P_SERVICE);
            if (wifiP2pManager == null) {
                fail("Wi-Fi Direct is not available on this device.");
                return;
            }
            wifiChannel = wifiP2pManager.initialize(context, context.getMainLooper(), null);
            if (wifiChannel == null) {
                fail("Android could not initialize Wi-Fi Direct.");
                return;
            }
            WifiP2pManager.ActionListener listener = new WifiP2pManager.ActionListener() {
                    @Override
                    public void onSuccess() {
                        SafeNetVpnService.refreshUnderlyingNetwork();
                        mainHandler.postDelayed(() -> refreshGroupInfo(0), 400L);
                    }

                    @Override
                    public void onFailure(int reason) {
                        fail(wifiFailureMessage(reason));
                    }
                };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                String requestedNetworkName = createNetworkName();
                String requestedPassphrase = createPassphrase();
                WifiP2pConfig config = new WifiP2pConfig.Builder()
                    .setNetworkName(requestedNetworkName)
                    .setPassphrase(requestedPassphrase)
                    .build();
                networkName = requestedNetworkName;
                passphrase = requestedPassphrase;
                appDefinedNetworkName = requestedNetworkName;
                credentialSource = CREDENTIAL_SOURCE_APP_DEFINED;
                wifiP2pManager.createGroup(wifiChannel, config, listener);
            } else {
                wifiP2pManager.createGroup(wifiChannel, listener);
            }
        } catch (SecurityException error) {
            fail("Nearby Wi-Fi permission is required to create the sharing network.");
        } catch (RuntimeException error) {
            fail("Android could not start the SafeNet sharing network.");
        }
    }

    synchronized void stop() {
        starting = false;
        running = false;
        closeProxy();
        devices = Collections.emptyList();
        networkName = null;
        passphrase = null;
        appDefinedNetworkName = null;
        credentialSource = null;
        groupOwner = false;
        if (wifiP2pManager != null && wifiChannel != null) {
            try {
                wifiP2pManager.removeGroup(wifiChannel, new WifiP2pManager.ActionListener() {
                    @Override public void onSuccess() {}
                    @Override public void onFailure(int reason) {}
                });
            } catch (SecurityException | RuntimeException ignored) {
                // The local proxy is already stopped; Android can clean up the group.
            }
        }
        SafeNetVpnService.refreshUnderlyingNetwork();
    }

    Snapshot snapshot() {
        return new Snapshot(
            running,
            starting,
            networkName,
            passphrase,
            credentialSource,
            PROXY_HOST,
            PROXY_PORT,
            groupOwner,
            lastError,
            new ArrayList<>(devices)
        );
    }

    private void refreshGroupInfo(int attempt) {
        if (!starting && !running) return;
        try {
            wifiP2pManager.requestGroupInfo(wifiChannel, group -> {
                if (group == null) {
                    if (attempt < 8) {
                        mainHandler.postDelayed(() -> refreshGroupInfo(attempt + 1), 400L);
                    } else {
                        fail("Android created the Wi-Fi Direct group but did not return its connection details.");
                    }
                    return;
                }
                synchronized (this) {
                    starting = false;
                    running = true;
                    groupOwner = group.isGroupOwner();
                    networkName = group.getNetworkName();
                    String androidPassphrase =
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? group.getPassphrase() : null;
                    if (androidPassphrase != null && !androidPassphrase.trim().isEmpty()) {
                        passphrase = androidPassphrase;
                        credentialSource = CREDENTIAL_SOURCE_ANDROID_API;
                    } else if (!CREDENTIAL_SOURCE_APP_DEFINED.equals(credentialSource) ||
                        networkName == null || !networkName.equals(appDefinedNetworkName)) {
                        passphrase = null;
                        credentialSource = CREDENTIAL_SOURCE_ANDROID_SETTINGS;
                    }
                    List<DeviceSnapshot> nextDevices = new ArrayList<>();
                    for (WifiP2pDevice device : group.getClientList()) {
                        nextDevices.add(new DeviceSnapshot(device.deviceName, device.deviceAddress));
                    }
                    devices = nextDevices;
                }
                ensureProxy();
                mainHandler.postDelayed(() -> refreshGroupInfo(0), 1500L);
            });
        } catch (SecurityException error) {
            fail("Nearby Wi-Fi permission is required to read the sharing network.");
        } catch (RuntimeException error) {
            fail("Android could not read the SafeNet sharing network.");
        }
    }

    private synchronized void ensureProxy() {
        if (proxyServer != null) return;
        try {
            proxyServer = new ServerSocket(PROXY_PORT);
            proxyExecutor.execute(() -> {
                while (running && proxyServer != null && !proxyServer.isClosed()) {
                    try {
                        Socket client = proxyServer.accept();
                        clientSockets.add(client);
                        proxyExecutor.execute(() -> handleClient(client));
                    } catch (IOException error) {
                        if (running) lastError = "The local sharing proxy stopped unexpectedly.";
                    }
                }
            });
        } catch (IOException error) {
            lastError = "SafeNet could not open the local proxy port " + PROXY_PORT + ".";
        } catch (RuntimeException error) {
            lastError = "SafeNet could not start the local sharing proxy.";
        }
    }

    private void handleClient(Socket client) {
        try {
            client.setSoTimeout(15_000);
            InputStream clientInput = client.getInputStream();
            String requestLine = readLine(clientInput);
            if (requestLine == null || requestLine.trim().isEmpty()) return;
            String[] requestParts = requestLine.split(" ", 3);
            if (requestParts.length < 2) {
                writeError(client, "400 Bad Request");
                return;
            }
            String method = requestParts[0];
            String target = requestParts[1];
            List<String> headers = new ArrayList<>();
            String host = null;
            int contentLength = 0;
            String line;
            while ((line = readLine(clientInput)) != null && !line.isEmpty()) {
                headers.add(line);
                int separator = line.indexOf(':');
                if (separator > 0) {
                    String headerName = line.substring(0, separator).trim();
                    String headerValue = line.substring(separator + 1).trim();
                    if ("Host".equalsIgnoreCase(headerName)) host = headerValue;
                    if ("Content-Length".equalsIgnoreCase(headerName)) {
                        try { contentLength = Integer.parseInt(headerValue); } catch (NumberFormatException ignored) {}
                    }
                }
            }
            if ("CONNECT".equalsIgnoreCase(method)) {
                HostPort destination = parseHostPort(target, 443);
                Socket upstream = openUpstream(destination.host, destination.port);
                OutputStream output = client.getOutputStream();
                output.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: SafeNet Internet Share\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1));
                output.flush();
                relay(client, upstream);
                return;
            }
            if (host == null || host.trim().isEmpty()) {
                writeError(client, "400 Host Required");
                return;
            }
            URI targetUri = target.startsWith("http://") || target.startsWith("https://")
                ? URI.create(target)
                : URI.create("http://" + host + (target.startsWith("/") ? target : "/" + target));
            int port = targetUri.getPort() > 0 ? targetUri.getPort() : 80;
            Socket upstream = openUpstream(targetUri.getHost(), port);
            BufferedWriter upstreamWriter = new BufferedWriter(
                new OutputStreamWriter(upstream.getOutputStream(), StandardCharsets.ISO_8859_1)
            );
            String path = targetUri.getRawPath();
            if (path == null || path.isEmpty()) path = "/";
            if (targetUri.getRawQuery() != null) path += "?" + targetUri.getRawQuery();
            upstreamWriter.write(method + " " + path + " HTTP/1.1\r\n");
            for (String header : headers) {
                int separator = header.indexOf(':');
                if (separator <= 0) continue;
                String name = header.substring(0, separator).trim();
                if ("Proxy-Connection".equalsIgnoreCase(name) || "Connection".equalsIgnoreCase(name)) continue;
                upstreamWriter.write(header + "\r\n");
            }
            upstreamWriter.write("Connection: close\r\n\r\n");
            upstreamWriter.flush();
            if (contentLength > 0) {
                byte[] buffer = new byte[8192];
                int remaining = contentLength;
                while (remaining > 0) {
                    int count = clientInput.read(buffer, 0, Math.min(buffer.length, remaining));
                    if (count < 0) break;
                    upstream.getOutputStream().write(buffer, 0, count);
                    remaining -= count;
                }
                upstream.getOutputStream().flush();
            }
            relay(client, upstream);
        } catch (Exception error) {
            try { writeError(client, "502 Bad Gateway"); } catch (IOException ignored) {}
        } finally {
            closeSocket(client);
            clientSockets.remove(client);
        }
    }

    private Socket openUpstream(String host, int port) throws IOException {
        Network upstreamNetwork = findUpstreamNetwork();
        InetAddress[] addresses;
        try {
            // Resolve through SafeNet first so the phone's DNS policy still
            // applies to proxy requests when the DNS VPN is active.
            addresses = InetAddress.getAllByName(host);
        } catch (UnknownHostException error) {
            if (upstreamNetwork == null) throw error;
            // Wi-Fi Direct can temporarily become Android's default network.
            // Resolve on the validated internet network instead of the local
            // sharing interface when that happens.
            addresses = upstreamNetwork.getAllByName(host);
        }

        IOException lastError = null;
        for (InetAddress address : addresses) {
            Socket upstream = new Socket();
            try {
                if (upstreamNetwork != null) {
                    upstreamNetwork.bindSocket(upstream);
                }
                upstream.connect(new InetSocketAddress(address, port), 10_000);
                return upstream;
            } catch (IOException error) {
                lastError = error;
                closeSocket(upstream);
            }
        }
        throw lastError == null
            ? new IOException("No address was available for the proxy destination.")
            : lastError;
    }

    private Network findUpstreamNetwork() {
        ConnectivityManager connectivity =
            (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) return null;

        Network active = connectivity.getActiveNetwork();
        if (isValidatedInternetNetwork(connectivity, active)) return active;
        for (Network network : connectivity.getAllNetworks()) {
            if (isValidatedInternetNetwork(connectivity, network)) return network;
        }
        return null;
    }

    private boolean isValidatedInternetNetwork(ConnectivityManager connectivity, Network network) {
        if (network == null) return false;
        NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
        return capabilities != null
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
    }

    private String readLine(InputStream input) throws IOException {
        StringBuilder line = new StringBuilder();
        int previous = -1;
        int current;
        while ((current = input.read()) >= 0) {
            if (current == '\n' && previous == '\r') {
                line.setLength(Math.max(0, line.length() - 1));
                return line.toString();
            }
            line.append((char) current);
            previous = current;
            if (line.length() > 16_384) throw new IOException("Proxy header is too large");
        }
        return line.isEmpty() ? null : line.toString();
    }

    private void relay(Socket client, Socket upstream) throws IOException {
        client.setSoTimeout(0);
        upstream.setSoTimeout(0);
        proxyExecutor.execute(() -> copy(client, upstream));
        copy(upstream, client);
        closeSocket(upstream);
    }

    private void copy(Socket source, Socket destination) {
        try {
            byte[] buffer = new byte[16 * 1024];
            int count;
            while ((count = source.getInputStream().read(buffer)) >= 0) {
                destination.getOutputStream().write(buffer, 0, count);
                destination.getOutputStream().flush();
            }
        } catch (IOException ignored) {
        } finally {
            closeSocket(source);
            closeSocket(destination);
        }
    }

    private void writeError(Socket client, String status) throws IOException {
        String body = "SafeNet Internet Share: " + status;
        String response = "HTTP/1.1 " + status + "\r\nContent-Type: text/plain\r\nContent-Length: "
            + body.length() + "\r\nConnection: close\r\n\r\n" + body;
        client.getOutputStream().write(response.getBytes(StandardCharsets.ISO_8859_1));
        client.getOutputStream().flush();
    }

    private HostPort parseHostPort(String value, int defaultPort) {
        String candidate = value == null ? "" : value.trim();
        if (candidate.startsWith("[")) {
            int closingBracket = candidate.indexOf(']');
            if (closingBracket <= 1) {
                throw new IllegalArgumentException("Invalid IPv6 proxy destination.");
            }
            String host = candidate.substring(1, closingBracket);
            int port = defaultPort;
            if (closingBracket + 1 < candidate.length()) {
                if (candidate.charAt(closingBracket + 1) != ':') {
                    throw new IllegalArgumentException("Invalid IPv6 proxy destination.");
                }
                port = parsePort(candidate.substring(closingBracket + 2));
            }
            return new HostPort(host, port);
        }
        int separator = candidate.lastIndexOf(':');
        if (separator > 0 && candidate.indexOf(':') == separator) {
            try {
                return new HostPort(candidate.substring(0, separator), parsePort(candidate.substring(separator + 1)));
            } catch (NumberFormatException ignored) {}
        }
        return new HostPort(candidate, defaultPort);
    }

    private int parsePort(String value) {
        int port = Integer.parseInt(value);
        if (port < 1 || port > 65_535) {
            throw new NumberFormatException("Port is outside the valid range.");
        }
        return port;
    }

    private synchronized void closeProxy() {
        if (proxyServer != null) {
            try { proxyServer.close(); } catch (IOException ignored) {}
            proxyServer = null;
        }
        for (Socket socket : clientSockets) closeSocket(socket);
        clientSockets.clear();
    }

    private void closeSocket(Socket socket) {
        try { socket.close(); } catch (IOException ignored) {}
    }

    synchronized void fail(String message) {
        starting = false;
        running = false;
        devices = Collections.emptyList();
        networkName = null;
        passphrase = null;
        appDefinedNetworkName = null;
        credentialSource = null;
        groupOwner = false;
        lastError = message;
        closeProxy();
    }

    private String wifiFailureMessage(int reason) {
        switch (reason) {
            case WifiP2pManager.BUSY: return "Android Wi-Fi Direct is busy. Turn Wi-Fi on and try again.";
            case WifiP2pManager.ERROR: return "Android reported a Wi-Fi Direct error.";
            case WifiP2pManager.P2P_UNSUPPORTED: return "This device does not support Wi-Fi Direct.";
            default: return "Android could not create the SafeNet sharing network.";
        }
    }

    private String createNetworkName() {
        return "DIRECT-SN" + randomCredentialCharacters(6);
    }

    private String createPassphrase() {
        return randomCredentialCharacters(16);
    }

    private String randomCredentialCharacters(int length) {
        SecureRandom random = new SecureRandom();
        StringBuilder value = new StringBuilder(length);
        for (int index = 0; index < length; index++) {
            value.append(CREDENTIAL_ALPHABET[random.nextInt(CREDENTIAL_ALPHABET.length)]);
        }
        return value.toString();
    }

    private static final class HostPort {
        final String host;
        final int port;

        HostPort(String host, int port) {
            this.host = host;
            this.port = port;
        }
    }
}