package com.safenet.dns;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Routes device DNS packets through the configured resolver and evaluates the
 * SafeNet DNS firewall before an upstream request is made.
 *
 * This is intentionally a DNS-only VPN. It does not claim to inspect HTTPS
 * payloads or route arbitrary application traffic.
 */
public final class SafeNetDnsVpnService extends VpnService {
    public static final String EXTRA_TYPE = "resolver_type";
    public static final String EXTRA_IP_VERSION = "resolver_ip_version";
    public static final String EXTRA_PRIMARY = "resolver_primary";
    public static final String EXTRA_SECONDARY = "resolver_secondary";

    private static final String CHANNEL_ID = "safenet_dns_filtering";
    private static final String VIRTUAL_DNS = "10.248.0.1";
    private static final String VIRTUAL_CLIENT = "10.248.0.2";
    private static final int DNS_PORT = 53;
    private static final int UDP = 17;
    private static final int TCP = 6;
    private static final int TIMEOUT_MS = 4000;
    private static final int MAX_PACKET = 65535;

    private static volatile SafeNetDnsVpnService instance;
    private static volatile String lastError;

    private final Object lifecycleLock = new Object();
    private volatile boolean running;
    private volatile boolean stopRequested;
    private ParcelFileDescriptor vpnInterface;
    private ExecutorService worker;
    private Resolver resolver;
    private volatile DnsFirewall firewall = DnsFirewall.failClosed();

    public static boolean isRunning() {
        SafeNetDnsVpnService service = instance;
        return service != null && service.running;
    }

    public static String getLastError() {
        return lastError;
    }

    static void updateFirewallConfig(String serialized) throws org.json.JSONException {
        DnsFirewall updated = DnsFirewall.fromJson(serialized);
        SafeNetDnsVpnService service = instance;
        if (service != null) {
            service.firewall = updated;
        }
    }

    static boolean isFirewallEnabled() {
        SafeNetDnsVpnService service = instance;
        return service != null && service.firewall.isEnabled();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        synchronized (lifecycleLock) {
            stopRequested = false;
            instance = this;
            try {
                resolver = Resolver.from(
                    intent == null ? null : intent.getStringExtra(EXTRA_TYPE),
                    intent == null ? null : intent.getStringExtra(EXTRA_IP_VERSION),
                    intent == null ? null : intent.getStringExtra(EXTRA_PRIMARY),
                    intent == null ? null : intent.getStringExtra(EXTRA_SECONDARY)
                );
                firewall = FirewallConfigStore.load(this);
                createNotificationChannel();
                startForeground(1001, buildNotification());

                Builder builder = new Builder()
                    .setSession("SafeNet DNS filtering")
                    .setBlocking(true)
                    .addAddress(VIRTUAL_CLIENT, 32)
                    .addRoute(VIRTUAL_DNS, 32)
                    .addDnsServer(VIRTUAL_DNS);
                NetworkBinding.bind(builder, findUnderlyingNetwork());
                vpnInterface = builder.establish();
                if (vpnInterface == null) {
                    throw new IOException("Android could not establish the DNS filtering path.");
                }
                running = true;
                lastError = null;
                worker = Executors.newSingleThreadExecutor();
                worker.execute(this::runLoop);
                return START_NOT_STICKY;
            } catch (Exception error) {
                lastError = message(error, "Unable to start DNS filtering.");
                stopVpn(true);
                stopSelf(startId);
                return START_NOT_STICKY;
            }
        }
    }

    @Override
    public void onDestroy() {
        boolean intentional = stopRequested;
        stopVpn(true);
        if (!intentional && lastError == null) {
            lastError = "DNS filtering stopped unexpectedly. Turn it on again to reconnect.";
        }
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public void onRevoke() {
        stopVpn(true);
        stopRequested = false;
        lastError = "Android revoked DNS filtering access. Turn filtering on again to reconnect.";
        stopSelf();
        super.onRevoke();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return super.onBind(intent);
    }

    static void requestStop() {
        SafeNetDnsVpnService service = instance;
        if (service != null) service.stopVpn(true);
    }

    private void runLoop() {
        ParcelFileDescriptor descriptor = vpnInterface;
        if (descriptor == null) return;
        byte[] packet = new byte[MAX_PACKET];
        try (
            FileInputStream input = new FileInputStream(descriptor.getFileDescriptor());
            FileOutputStream output = new FileOutputStream(descriptor.getFileDescriptor())
        ) {
            while (running) {
                int length = input.read(packet);
                if (length > 0) handlePacket(packet, length, output);
            }
        } catch (IOException error) {
            if (running) {
                lastError = message(error, "The DNS filtering path stopped unexpectedly.");
            }
        } finally {
            running = false;
        }
    }

    private void handlePacket(byte[] packet, int length, FileOutputStream output) {
        if (length < 28 || (packet[0] & 0xf0) != 0x40) return;
        int headerLength = (packet[0] & 0x0f) * 4;
        int totalLength = unsignedShort(packet, 2);
        if (headerLength < 20 || totalLength < headerLength + 8 || totalLength > length) return;
        if (!VIRTUAL_DNS.equals(ip(packet, 16))) return;
        int protocol = packet[9] & 0xff;
        if (protocol != UDP && protocol != TCP) return;
        int transportOffset = headerLength;
        int destinationPort = unsignedShort(packet, transportOffset + 2);
        if (destinationPort != DNS_PORT) return;
        int payloadOffset = transportOffset + (protocol == UDP ? 8 : 20);
        if (payloadOffset > totalLength) return;
        byte[] query = new byte[totalLength - payloadOffset];
        System.arraycopy(packet, payloadOffset, query, 0, query.length);
        String source = ip(packet, 12);
        DnsFirewall.Evaluation evaluation = firewall.evaluateWithReason(query, source, VIRTUAL_DNS);
        byte[] response;
        try {
            response = evaluation.decision == DnsFirewall.Decision.BLOCK
                ? DnsFirewall.blockedResponse(query)
                : resolver.query(this, query);
        } catch (Exception error) {
            response = DnsFirewall.blockedResponse(query);
        }
        try {
            byte[] reply = buildReply(packet, totalLength, headerLength, protocol, response);
            output.write(reply);
            output.flush();
        } catch (IOException ignored) {
            // The VPN may be revoked while the worker is writing a response.
        }
    }

    private static byte[] buildReply(
        byte[] request,
        int requestLength,
        int headerLength,
        int protocol,
        byte[] payload
    ) {
        int transportLength = protocol == UDP ? 8 : 20;
        int totalLength = headerLength + transportLength + payload.length;
        byte[] reply = new byte[totalLength];
        System.arraycopy(request, 0, reply, 0, headerLength);
        System.arraycopy(request, 12, reply, 16, 4);
        System.arraycopy(request, 16, reply, 12, 4);
        reply[2] = (byte) (totalLength >>> 8);
        reply[3] = (byte) totalLength;
        reply[8] = 64;
        reply[9] = (byte) protocol;
        reply[10] = 0;
        reply[11] = 0;
        writeShort(reply, headerLength, unsignedShort(request, headerLength + 2));
        writeShort(reply, headerLength + 2, unsignedShort(request, headerLength));
        if (protocol == UDP) {
            writeShort(reply, headerLength + 4, 8 + payload.length);
            writeShort(reply, headerLength + 6, 0);
        } else {
            System.arraycopy(request, headerLength + 4, reply, headerLength + 4, 16);
            writeShort(reply, headerLength + 4, unsignedShort(request, headerLength + 16));
            writeShort(reply, headerLength + 16, unsignedShort(request, headerLength + 4));
        }
        System.arraycopy(payload, 0, reply, headerLength + transportLength, payload.length);
        writeShort(reply, 10, checksum(reply, 0, headerLength, 0));
        if (protocol == UDP) {
            int checksum = pseudoChecksum(reply, headerLength, 8 + payload.length);
            if (checksum == 0) checksum = 0xffff;
            writeShort(reply, headerLength + 6, checksum);
        } else {
            writeShort(reply, headerLength + 16, pseudoChecksum(reply, headerLength, 20 + payload.length));
        }
        return reply;
    }

    private void stopVpn(boolean clearError) {
        synchronized (lifecycleLock) {
            running = false;
            if (worker != null) {
                worker.shutdownNow();
                worker = null;
            }
            if (vpnInterface != null) {
                try {
                    vpnInterface.close();
                } catch (IOException ignored) {}
                vpnInterface = null;
            }
            if (clearError) lastError = null;
        }
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setContentTitle("SafeNet DNS filtering")
            .setContentText("Device DNS requests are being filtered.")
            .setSmallIcon(android.R.drawable.ic_secure)
            .setOngoing(true)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, "DNS filtering", NotificationManager.IMPORTANCE_LOW
                ));
            }
        }
    }

    private android.net.Network findUnderlyingNetwork() {
        android.net.ConnectivityManager connectivity =
            (android.net.ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) return null;
        android.net.Network active = connectivity.getActiveNetwork();
        if (active == null) return null;
        android.net.NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(active);
        if (capabilities == null ||
            capabilities.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN)) {
            return null;
        }
        return active;
    }

    private static int unsignedShort(byte[] value, int offset) {
        return ((value[offset] & 0xff) << 8) | (value[offset + 1] & 0xff);
    }

    private static void writeShort(byte[] value, int offset, int number) {
        value[offset] = (byte) (number >>> 8);
        value[offset + 1] = (byte) number;
    }

    private static String ip(byte[] value, int offset) {
        return (value[offset] & 0xff) + "." + (value[offset + 1] & 0xff) + "."
            + (value[offset + 2] & 0xff) + "." + (value[offset + 3] & 0xff);
    }

    private static int checksum(byte[] value, int offset, int length, int initial) {
        long sum = initial;
        for (int index = 0; index < length; index += 2) {
            int word = (value[offset + index] & 0xff) << 8;
            if (index + 1 < length) word |= value[offset + index + 1] & 0xff;
            sum += word;
            while ((sum >>> 16) != 0) sum = (sum & 0xffff) + (sum >>> 16);
        }
        return (int) (~sum) & 0xffff;
    }

    private static int pseudoChecksum(byte[] packet, int offset, int length) {
        long sum = 0;
        sum += ((packet[12] & 0xff) << 8) | (packet[13] & 0xff);
        sum += ((packet[14] & 0xff) << 8) | (packet[15] & 0xff);
        sum += ((packet[16] & 0xff) << 8) | (packet[17] & 0xff);
        sum += ((packet[18] & 0xff) << 8) | (packet[19] & 0xff);
        sum += packet[9] & 0xff;
        sum += length;
        byte[] copy = packet.clone();
        copy[offset + 6] = 0;
        copy[offset + 7] = 0;
        return checksum(copy, offset, length, (int) sum);
    }

    private static String message(Exception error, String fallback) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? fallback : message;
    }

    private static final class NetworkBinding {
        private static void bind(VpnService.Builder builder, android.net.Network network) {
            if (network != null) builder.setUnderlyingNetworks(new android.net.Network[] { network });
        }
    }

    private static final class Resolver {
        private final String type;
        private final String primary;
        private final String secondary;

        private Resolver(String type, String primary, String secondary) {
            this.type = type;
            this.primary = primary;
            this.secondary = secondary;
        }

        static Resolver from(String type, String ipVersion, String primary, String secondary) {
            String normalizedType = type == null ? "plain" : type.trim().toLowerCase(Locale.US);
            if (!normalizedType.equals("plain") && !normalizedType.equals("doh") && !normalizedType.equals("dot")) {
                throw new IllegalArgumentException("Unsupported DNS service type.");
            }
            if (primary == null || primary.trim().isEmpty()) {
                throw new IllegalArgumentException("An active DNS resolver is required.");
            }
            return new Resolver(normalizedType, primary.trim(), secondary == null ? "" : secondary.trim());
        }

        byte[] query(VpnService service, byte[] request) throws Exception {
            Exception first = null;
            for (String endpoint : new String[] { primary, secondary }) {
                if (endpoint == null || endpoint.isEmpty()) continue;
                try {
                    if (type.equals("plain")) return plain(service, endpoint, request);
                    if (type.equals("dot")) return tls(service, endpoint, request, 853, false);
                    return tls(service, endpoint, request, 443, true);
                } catch (Exception error) {
                    first = error;
                }
            }
            throw first == null ? new IOException("No DNS resolver endpoint is configured.") : first;
        }

        private byte[] plain(VpnService service, String endpoint, byte[] request) throws Exception {
            DatagramSocket socket = new DatagramSocket();
            try {
                if (!service.protect(socket)) throw new IOException("Could not bypass the DNS VPN for upstream traffic.");
                socket.setSoTimeout(TIMEOUT_MS);
                DatagramPacket outgoing = new DatagramPacket(
                    request, request.length, InetAddress.getByName(endpoint), DNS_PORT
                );
                socket.send(outgoing);
                byte[] response = new byte[65535];
                DatagramPacket incoming = new DatagramPacket(response, response.length);
                socket.receive(incoming);
                byte[] result = new byte[incoming.getLength()];
                System.arraycopy(incoming.getData(), incoming.getOffset(), result, 0, result.length);
                return result;
            } finally {
                socket.close();
            }
        }

        private byte[] tls(VpnService service, String endpoint, byte[] request, int defaultPort, boolean http)
            throws Exception {
            URI uri = http ? URI.create(endpoint) : URI.create("tls://" + endpoint);
            String host = uri.getHost();
            if (host == null || host.isEmpty()) throw new IOException("DNS resolver host is invalid.");
            int port = uri.getPort() > 0 ? uri.getPort() : defaultPort;
            Socket raw = new Socket();
            if (!service.protect(raw)) throw new IOException("Could not bypass the DNS VPN for upstream traffic.");
            raw.connect(new InetSocketAddress(host, port), TIMEOUT_MS);
            raw.setSoTimeout(TIMEOUT_MS);
            SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
            SSLSocket socket = (SSLSocket) factory.createSocket(raw, host, port, true);
            try {
                if (!service.protect(socket)) throw new IOException("Could not protect the encrypted DNS socket.");
                socket.startHandshake();
                if (http) return doh(socket, host, uri, request);
                DataOutputStream output = new DataOutputStream(socket.getOutputStream());
                output.writeShort(request.length);
                output.write(request);
                output.flush();
                DataInputStream input = new DataInputStream(socket.getInputStream());
                int length = input.readUnsignedShort();
                if (length <= 0 || length > 65535) throw new IOException("Encrypted DNS response is invalid.");
                byte[] response = new byte[length];
                input.readFully(response);
                return response;
            } finally {
                socket.close();
            }
        }

        private byte[] doh(SSLSocket socket, String host, URI uri, byte[] request) throws Exception {
            String path = uri.getRawPath();
            if (path == null || path.isEmpty()) path = "/dns-query";
            if (uri.getRawQuery() != null) path += "?" + uri.getRawQuery();
            String headers = "POST " + path + " HTTP/1.1\r\nHost: " + host
                + "\r\nContent-Type: application/dns-message\r\nAccept: application/dns-message\r\n"
                + "Content-Length: " + request.length + "\r\nConnection: close\r\n\r\n";
            socket.getOutputStream().write(headers.getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().write(request);
            socket.getOutputStream().flush();
            ByteArrayOutputStream response = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = socket.getInputStream().read(buffer)) != -1 && response.size() < 131072) {
                response.write(buffer, 0, read);
            }
            byte[] bytes = response.toByteArray();
            int body = indexOf(bytes, new byte[] { 13, 10, 13, 10 });
            if (body < 0) throw new IOException("Encrypted DNS response headers are invalid.");
            body += 4;
            if (bytes.length <= body) throw new IOException("Encrypted DNS response is empty.");
            byte[] result = new byte[bytes.length - body];
            System.arraycopy(bytes, body, result, 0, result.length);
            return result;
        }

        private static int indexOf(byte[] value, byte[] needle) {
            outer: for (int index = 0; index <= value.length - needle.length; index++) {
                for (int nested = 0; nested < needle.length; nested++) {
                    if (value[index + nested] != needle[nested]) continue outer;
                }
                return index;
            }
            return -1;
        }
    }
}