package com.safenet.dns;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.VpnService;
import android.os.Build;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.Map;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;

public class SafeNetVpnService extends VpnService {
    public static final String EXTRA_TYPE = "resolver_type";
    public static final String EXTRA_PRIMARY = "resolver_primary";
    public static final String EXTRA_SECONDARY = "resolver_secondary";

    private static final String CHANNEL_ID = "safenet_dns_vpn";
    private static final String VIRTUAL_DNS = "10.248.0.1";
    private static final String VIRTUAL_CLIENT = "10.248.0.2";
    private static final String VIRTUAL_DNS_V6 = "fd00:534e:5348::1";
    private static final String VIRTUAL_CLIENT_V6 = "fd00:534e:5348::2";
    private static final int DNS_PORT = 53;
    private static final int TCP_PROTOCOL = 6;
    private static final int UDP_PROTOCOL = 17;
    private static final int TCP_FLAG_FIN = 0x01;
    private static final int TCP_FLAG_SYN = 0x02;
    private static final int TCP_FLAG_RST = 0x04;
    private static final int TCP_FLAG_PSH = 0x08;
    private static final int TCP_FLAG_ACK = 0x10;
    private static final int SOCKET_TIMEOUT_MS = 3500;
    private static final int MAX_DNS_RESPONSE = 65527;
    private static final int MAX_TCP_DNS_RESPONSE = 65493;

    private static volatile SafeNetVpnService instance;
    private static volatile String lastError;

    private final Object lifecycleLock = new Object();
    private volatile boolean running;
    private volatile boolean stopRequested;
    private ParcelFileDescriptor vpnInterface;
    private ExecutorService worker;
    private ResolverConfig resolver;
    private final Map<String, TcpSession> tcpSessions = new ConcurrentHashMap<>();

    public static boolean isRunning() {
        SafeNetVpnService service = instance;
        return service != null && service.running;
    }

    public static String getLastError() {
        return lastError;
    }

    public static void requestStop() {
        SafeNetVpnService service = instance;
        lastError = null;
        if (service == null) {
            return;
        }
        service.stopRequested = true;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        stopVpn(false);
        stopRequested = false;
        if (intent == null) {
            lastError = "VPN configuration was lost. Start protection again.";
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        try {
            resolver = ResolverConfig.from(
                intent.getStringExtra(EXTRA_TYPE),
                intent.getStringExtra(EXTRA_PRIMARY),
                intent.getStringExtra(EXTRA_SECONDARY)
            );
            startForeground(1001, buildNotification());
            vpnInterface = new Builder()
                .setSession("SafeNet DNS")
                .setBlocking(true)
                .addAddress(VIRTUAL_CLIENT, 32)
                .addAddress(VIRTUAL_CLIENT_V6, 128)
                .addRoute(VIRTUAL_DNS, 32)
                .addRoute(VIRTUAL_DNS_V6, 128)
                .addDnsServer(VIRTUAL_DNS)
                .addDnsServer(VIRTUAL_DNS_V6)
                .establish();
            if (vpnInterface == null) {
                throw new IOException("Android could not establish the DNS VPN interface.");
            }

            running = true;
            lastError = null;
            worker = Executors.newSingleThreadExecutor();
            worker.execute(this::runVpnLoop);
            return START_NOT_STICKY;
        } catch (Exception error) {
            lastError = safeMessage(error, "Unable to start DNS protection.");
            stopVpn(true);
            stopSelf(startId);
            return START_NOT_STICKY;
        }
    }

    @Override
    public void onDestroy() {
        boolean intentionalStop = stopRequested;
        String existingError = lastError;
        stopVpn(true);
        if (intentionalStop) {
            lastError = null;
        } else if (existingError == null) {
            lastError = "DNS protection stopped unexpectedly. Turn the switch on to reconnect.";
        }
        if (instance == this) {
            instance = null;
        }
        super.onDestroy();
    }

    @Override
    public void onRevoke() {
        stopVpn(true);
        stopRequested = false;
        lastError = "Android revoked VPN access. Turn the switch on to reconnect.";
        stopSelf();
        super.onRevoke();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return super.onBind(intent);
    }

    private void runVpnLoop() {
        ParcelFileDescriptor localInterface = vpnInterface;
        if (localInterface == null) {
            return;
        }

        byte[] packet = new byte[65535];
        try (
            FileInputStream input = new FileInputStream(localInterface.getFileDescriptor());
            FileOutputStream output = new FileOutputStream(localInterface.getFileDescriptor())
        ) {
            while (running) {
                int length = input.read(packet);
                if (length <= 0) {
                    continue;
                }
                forwardPacket(packet, length, output);
            }
        } catch (IOException error) {
            if (running) {
                lastError = safeMessage(error, "The DNS VPN stopped unexpectedly.");
                stopSelf();
            }
        } finally {
            running = false;
        }
    }

    private void forwardPacket(byte[] packet, int length, FileOutputStream output) throws IOException {
        if (length < 1) {
            return;
        }

        if ((packet[0] & 0xf0) == 0x40) {
            forwardIpv4Packet(packet, length, output);
        } else if ((packet[0] & 0xf0) == 0x60) {
            forwardIpv6Packet(packet, length, output);
        }
    }

    private void forwardIpv4Packet(byte[] packet, int length, FileOutputStream output) throws IOException {
        if (length < 28) {
            return;
        }

        int headerLength = (packet[0] & 0x0f) * 4;
        int ipv4TotalLength = readUnsignedShort(packet, 2);
        if (headerLength < 20 || headerLength > 60 ||
            length < headerLength + 8 || ipv4TotalLength < headerLength + 8 ||
            ipv4TotalLength > length || !matchesAddress(packet, 16, VIRTUAL_DNS)) {
            return;
        }

        int protocol = packet[9] & 0xff;
        if (protocol == TCP_PROTOCOL) {
            forwardIpv4TcpPacket(packet, length, headerLength, output);
            return;
        }
        if (protocol != UDP_PROTOCOL) {
            return;
        }

        int udpOffset = headerLength;
        int sourcePort = readUnsignedShort(packet, udpOffset);
        int destinationPort = readUnsignedShort(packet, udpOffset + 2);
        if (destinationPort != DNS_PORT) {
            return;
        }

        int udpLength = readUnsignedShort(packet, udpOffset + 4);
        int payloadOffset = udpOffset + 8;
        if (udpLength < 8 || udpLength > ipv4TotalLength - udpOffset ||
            udpLength > length - udpOffset || udpLength - 8 > MAX_DNS_RESPONSE) {
            return;
        }
        int payloadLength = udpLength - 8;

        byte[] query = new byte[payloadLength];
        System.arraycopy(packet, payloadOffset, query, 0, payloadLength);
        ResolverConfig activeResolver = resolver;
        if (activeResolver == null) {
            return;
        }
        byte[] response = activeResolver.forward(query, this);
        if (response == null || response.length == 0 || response.length > MAX_DNS_RESPONSE) {
            return;
        }

        byte[] responsePacket = createUdpResponse(packet, sourcePort, destinationPort, response);
        output.write(responsePacket);
        output.flush();
    }

    private void forwardIpv6Packet(byte[] packet, int length, FileOutputStream output) throws IOException {
        final int ipv6HeaderLength = 40;
        if (length < ipv6HeaderLength + 8 ||
            !matchesAddress(packet, 24, VIRTUAL_DNS_V6)) {
            return;
        }

        int protocol = packet[6] & 0xff;
        if (protocol == TCP_PROTOCOL) {
            forwardIpv6TcpPacket(packet, length, output);
            return;
        }
        if (protocol != UDP_PROTOCOL) {
            return;
        }

        int udpOffset = ipv6HeaderLength;
        int sourcePort = readUnsignedShort(packet, udpOffset);
        int destinationPort = readUnsignedShort(packet, udpOffset + 2);
        if (destinationPort != DNS_PORT) {
            return;
        }

        int udpLength = readUnsignedShort(packet, udpOffset + 4);
        int payloadOffset = udpOffset + 8;
        int ipv6PayloadLength = readUnsignedShort(packet, 4);
        if (udpLength < 8 || udpLength > ipv6PayloadLength ||
            udpLength > length - ipv6HeaderLength || udpLength - 8 > MAX_DNS_RESPONSE) {
            return;
        }
        int payloadLength = udpLength - 8;

        byte[] query = new byte[payloadLength];
        System.arraycopy(packet, payloadOffset, query, 0, payloadLength);
        ResolverConfig activeResolver = resolver;
        if (activeResolver == null) {
            return;
        }
        byte[] response = activeResolver.forward(query, this);
        if (response == null || response.length == 0 || response.length > MAX_DNS_RESPONSE) {
            return;
        }

        byte[] responsePacket = createUdpIpv6Response(packet, sourcePort, destinationPort, response);
        output.write(responsePacket);
        output.flush();
    }

    private void forwardIpv4TcpPacket(
        byte[] packet,
        int length,
        int ipHeaderLength,
        FileOutputStream output
    ) throws IOException {
        int totalLength = readUnsignedShort(packet, 2);
        int tcpOffset = ipHeaderLength;
        forwardTcpPacket(
            packet,
            length,
            totalLength - tcpOffset,
            tcpOffset,
            false,
            output
        );
    }

    private void forwardIpv6TcpPacket(
        byte[] packet,
        int length,
        FileOutputStream output
    ) throws IOException {
        int payloadLength = readUnsignedShort(packet, 4);
        if (payloadLength > length - 40) {
            return;
        }
        forwardTcpPacket(packet, length, payloadLength, 40, true, output);
    }

    private void forwardTcpPacket(
        byte[] packet,
        int length,
        int ipPayloadLength,
        int tcpOffset,
        boolean ipv6,
        FileOutputStream output
    ) throws IOException {
        if (ipPayloadLength < 20 || tcpOffset < 0 || tcpOffset + ipPayloadLength > length) {
            return;
        }

        int sourcePort = readUnsignedShort(packet, tcpOffset);
        int destinationPort = readUnsignedShort(packet, tcpOffset + 2);
        if (destinationPort != DNS_PORT) {
            return;
        }

        int sequence = readInt(packet, tcpOffset + 4);
        int tcpHeaderLength = ((packet[tcpOffset + 12] & 0xf0) >>> 4) * 4;
        if (tcpHeaderLength < 20 || tcpOffset + tcpHeaderLength > length) {
            return;
        }

        int flags = packet[tcpOffset + 13] & 0xff;
        int dataOffset = tcpOffset + tcpHeaderLength;
        int dataLength = Math.min(
            ipPayloadLength - tcpHeaderLength,
            length - dataOffset
        );
        if (dataLength < 0 || dataLength > MAX_DNS_RESPONSE + 2) {
            return;
        }

        String key = tcpSessionKey(packet, ipv6, sourcePort);
        if ((flags & TCP_FLAG_SYN) != 0 && (flags & TCP_FLAG_ACK) == 0) {
            TcpSession session = new TcpSession(
                sequence + 1,
                initialServerSequence(sourcePort, sequence)
            );
            tcpSessions.put(key, session);
            writeTcpPacket(
                packet,
                tcpOffset,
                ipv6,
                session.serverSequence,
                session.expectedClientSequence,
                TCP_FLAG_SYN | TCP_FLAG_ACK,
                new byte[0],
                output
            );
            return;
        }

        TcpSession session = tcpSessions.get(key);
        if (session == null) {
            return;
        }
        if ((flags & TCP_FLAG_RST) != 0) {
            tcpSessions.remove(key);
            return;
        }

        if (dataLength > 0 && sequence == session.expectedClientSequence) {
            session.expectedClientSequence += dataLength;
            session.pending.write(packet, dataOffset, dataLength);
        } else if (dataLength > 0 && sequence != session.expectedClientSequence) {
            writeTcpPacket(
                packet,
                tcpOffset,
                ipv6,
                session.serverSequence,
                session.expectedClientSequence,
                TCP_FLAG_ACK,
                new byte[0],
                output
            );
            return;
        }

        byte[] responsePayload = session.readDnsResponse(resolver, this);
        if (responsePayload != null) {
            writeTcpPacket(
                packet,
                tcpOffset,
                ipv6,
                session.serverSequence,
                session.expectedClientSequence,
                TCP_FLAG_PSH | TCP_FLAG_ACK,
                responsePayload,
                output
            );
            session.serverSequence += responsePayload.length;
        } else if (dataLength > 0 || (flags & TCP_FLAG_ACK) != 0) {
            writeTcpPacket(
                packet,
                tcpOffset,
                ipv6,
                session.serverSequence,
                session.expectedClientSequence,
                TCP_FLAG_ACK,
                new byte[0],
                output
            );
        }

        if ((flags & TCP_FLAG_FIN) != 0 &&
            sequence + dataLength == session.expectedClientSequence) {
            session.expectedClientSequence += 1;
            writeTcpPacket(
                packet,
                tcpOffset,
                ipv6,
                session.serverSequence,
                session.expectedClientSequence,
                TCP_FLAG_FIN | TCP_FLAG_ACK,
                new byte[0],
                output
            );
            session.serverSequence += 1;
            tcpSessions.remove(key);
        }
    }

    private byte[] createUdpResponse(
        byte[] request,
        int sourcePort,
        int destinationPort,
        byte[] payload
    ) {
        int udpLength = 8 + payload.length;
        int totalLength = 20 + udpLength;
        byte[] response = new byte[totalLength];
        response[0] = 0x45;
        response[1] = 0;
        writeUnsignedShort(response, 2, totalLength);
        response[4] = request[4];
        response[5] = request[5];
        response[6] = 0;
        response[7] = 0;
        response[8] = 64;
        response[9] = 17;
        System.arraycopy(request, 16, response, 12, 4);
        System.arraycopy(request, 12, response, 16, 4);
        writeUnsignedShort(response, 10, checksum(response, 0, 20));

        writeUnsignedShort(response, 20, destinationPort);
        writeUnsignedShort(response, 22, sourcePort);
        writeUnsignedShort(response, 24, udpLength);
        System.arraycopy(payload, 0, response, 28, payload.length);
        writeUnsignedShort(response, 26, udpChecksum(response, 20, udpLength));
        return response;
    }

    private byte[] createUdpIpv6Response(
        byte[] request,
        int sourcePort,
        int destinationPort,
        byte[] payload
    ) {
        int udpLength = 8 + payload.length;
        int totalLength = 40 + udpLength;
        byte[] response = new byte[totalLength];
        System.arraycopy(request, 0, response, 0, 4);
        writeUnsignedShort(response, 4, udpLength);
        response[6] = 17;
        response[7] = 64;
        System.arraycopy(request, 24, response, 8, 16);
        System.arraycopy(request, 8, response, 24, 16);

        writeUnsignedShort(response, 40, destinationPort);
        writeUnsignedShort(response, 42, sourcePort);
        writeUnsignedShort(response, 44, udpLength);
        System.arraycopy(payload, 0, response, 48, payload.length);
        writeUnsignedShort(response, 46, udpChecksumIpv6(response, 40, udpLength));
        return response;
    }

    private static String tcpSessionKey(byte[] packet, boolean ipv6, int sourcePort) {
        int addressOffset = ipv6 ? 8 : 12;
        int addressLength = ipv6 ? 16 : 4;
        StringBuilder key = new StringBuilder(addressLength * 2 + 8);
        for (int i = 0; i < addressLength; i++) {
            key.append(String.format(Locale.US, "%02x", packet[addressOffset + i] & 0xff));
        }
        return key.append(':').append(sourcePort).toString();
    }

    private static int initialServerSequence(int sourcePort, int clientSequence) {
        return 0x534e0000 ^ (sourcePort << 8) ^ clientSequence;
    }

    private void writeTcpPacket(
        byte[] request,
        int tcpOffset,
        boolean ipv6,
        int sequence,
        int acknowledgement,
        int flags,
        byte[] payload,
        FileOutputStream output
    ) throws IOException {
        int ipHeaderLength = ipv6 ? 40 : 20;
        int tcpLength = 20 + payload.length;
        byte[] response = new byte[ipHeaderLength + tcpLength];
        int responseTcpOffset = ipHeaderLength;

        if (ipv6) {
            System.arraycopy(request, 0, response, 0, 4);
            writeUnsignedShort(response, 4, tcpLength);
            response[6] = TCP_PROTOCOL;
            response[7] = 64;
            System.arraycopy(request, 24, response, 8, 16);
            System.arraycopy(request, 8, response, 24, 16);
        } else {
            response[0] = 0x45;
            writeUnsignedShort(response, 2, response.length);
            response[4] = request[4];
            response[5] = request[5];
            response[8] = 64;
            response[9] = TCP_PROTOCOL;
            System.arraycopy(request, 16, response, 12, 4);
            System.arraycopy(request, 12, response, 16, 4);
            writeUnsignedShort(response, 10, checksum(response, 0, 20));
        }

        writeUnsignedShort(response, responseTcpOffset, readUnsignedShort(request, tcpOffset + 2));
        writeUnsignedShort(response, responseTcpOffset + 2, readUnsignedShort(request, tcpOffset));
        writeInt(response, responseTcpOffset + 4, sequence);
        writeInt(response, responseTcpOffset + 8, acknowledgement);
        response[responseTcpOffset + 12] = 0x50;
        response[responseTcpOffset + 13] = (byte) flags;
        writeUnsignedShort(response, responseTcpOffset + 14, 65535);
        writeUnsignedShort(response, responseTcpOffset + 16, 0);
        writeUnsignedShort(response, responseTcpOffset + 18, 0);
        System.arraycopy(payload, 0, response, responseTcpOffset + 20, payload.length);
        writeUnsignedShort(
            response,
            responseTcpOffset + 16,
            tcpChecksum(response, responseTcpOffset, tcpLength, ipv6)
        );
        output.write(response);
        output.flush();
    }

    private static int tcpChecksum(byte[] packet, int tcpOffset, int tcpLength, boolean ipv6) {
        long sum = 0;
        if (ipv6) {
            for (int i = 8; i < 40; i += 2) {
                sum += ((packet[i] & 0xff) << 8) | (packet[i + 1] & 0xff);
            }
        } else {
            for (int i = 12; i < 20; i += 2) {
                sum += ((packet[i] & 0xff) << 8) | (packet[i + 1] & 0xff);
            }
        }
        sum += (tcpLength >>> 16) & 0xffff;
        sum += tcpLength & 0xffff;
        sum += TCP_PROTOCOL;
        for (int i = tcpOffset; i < tcpOffset + tcpLength; i += 2) {
            int high = packet[i] & 0xff;
            int low = i + 1 < tcpOffset + tcpLength ? packet[i + 1] & 0xff : 0;
            sum += (high << 8) | low;
        }
        while ((sum >>> 16) != 0) {
            sum = (sum & 0xffff) + (sum >>> 16);
        }
        int result = (int) (~sum) & 0xffff;
        return result == 0 ? 0xffff : result;
    }

    private void stopVpn(boolean retainError) {
        synchronized (lifecycleLock) {
            running = false;
            if (worker != null) {
                worker.shutdownNow();
                worker = null;
            }
            tcpSessions.clear();
            if (vpnInterface != null) {
                try {
                    vpnInterface.close();
                } catch (IOException ignored) {
                    // The interface is already being torn down.
                }
                vpnInterface = null;
            }
            resolver = null;
            if (!retainError) {
                lastError = null;
            }
        }
    }

    private Notification buildNotification() {
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        return builder
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle("SafeNet DNS protection active")
            .setContentText("DNS requests are being filtered through SafeNet.")
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL_ID,
                "SafeNet DNS protection",
                NotificationManager.IMPORTANCE_LOW
            ));
        }
    }

    private static boolean matchesAddress(byte[] packet, int offset, String expected) {
        try {
            byte[] address = InetAddress.getByName(expected).getAddress();
            if (offset < 0 || offset + address.length > packet.length) {
                return false;
            }
            for (int i = 0; i < address.length; i++) {
                if (packet[offset + i] != address[i]) {
                    return false;
                }
            }
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static int readUnsignedShort(byte[] value, int offset) {
        return ((value[offset] & 0xff) << 8) | (value[offset + 1] & 0xff);
    }

    private static int readInt(byte[] value, int offset) {
        return ((value[offset] & 0xff) << 24) |
            ((value[offset + 1] & 0xff) << 16) |
            ((value[offset + 2] & 0xff) << 8) |
            (value[offset + 3] & 0xff);
    }

    private static void writeUnsignedShort(byte[] value, int offset, int number) {
        value[offset] = (byte) ((number >>> 8) & 0xff);
        value[offset + 1] = (byte) (number & 0xff);
    }

    private static void writeInt(byte[] value, int offset, int number) {
        value[offset] = (byte) (number >>> 24);
        value[offset + 1] = (byte) (number >>> 16);
        value[offset + 2] = (byte) (number >>> 8);
        value[offset + 3] = (byte) number;
    }

    private static int checksum(byte[] value, int offset, int length) {
        long sum = 0;
        for (int i = offset; i < offset + length; i += 2) {
            sum += ((value[i] & 0xff) << 8) | (value[i + 1] & 0xff);
        }
        while ((sum >>> 16) != 0) {
            sum = (sum & 0xffff) + (sum >>> 16);
        }
        return (int) (~sum) & 0xffff;
    }

    private static int udpChecksum(byte[] packet, int udpOffset, int udpLength) {
        long sum = 0;
        for (int i = 12; i < 20; i += 2) {
            sum += ((packet[i] & 0xff) << 8) | (packet[i + 1] & 0xff);
        }
        sum += 17;
        sum += udpLength;
        for (int i = udpOffset; i < udpOffset + udpLength; i += 2) {
            int high = packet[i] & 0xff;
            int low = i + 1 < udpOffset + udpLength ? packet[i + 1] & 0xff : 0;
            sum += (high << 8) | low;
        }
        while ((sum >>> 16) != 0) {
            sum = (sum & 0xffff) + (sum >>> 16);
        }
        int result = (int) (~sum) & 0xffff;
        return result == 0 ? 0xffff : result;
    }

    private static int udpChecksumIpv6(byte[] packet, int udpOffset, int udpLength) {
        long sum = 0;
        for (int i = 8; i < 40; i += 2) {
            sum += ((packet[i] & 0xff) << 8) | (packet[i + 1] & 0xff);
        }
        sum += (udpLength >>> 16) & 0xffff;
        sum += udpLength & 0xffff;
        sum += 17;
        for (int i = udpOffset; i < udpOffset + udpLength; i += 2) {
            int high = packet[i] & 0xff;
            int low = i + 1 < udpOffset + udpLength ? packet[i + 1] & 0xff : 0;
            sum += (high << 8) | low;
        }
        while ((sum >>> 16) != 0) {
            sum = (sum & 0xffff) + (sum >>> 16);
        }
        int result = (int) (~sum) & 0xffff;
        return result == 0 ? 0xffff : result;
    }

    private static String safeMessage(Exception error, String fallback) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? fallback : message;
    }

    private static final class TcpSession {
        private int expectedClientSequence;
        private int serverSequence;
        private final ByteArrayOutputStream pending = new ByteArrayOutputStream();
        private boolean responseSent;

        private TcpSession(int expectedClientSequence, int serverSequence) {
            this.expectedClientSequence = expectedClientSequence;
            this.serverSequence = serverSequence;
        }

        private byte[] readDnsResponse(ResolverConfig config, SafeNetVpnService service) {
            if (responseSent || config == null || pending.size() < 2) {
                return null;
            }

            byte[] framedQuery = pending.toByteArray();
            int queryLength = readUnsignedShort(framedQuery, 0);
            if (queryLength <= 0 || queryLength > MAX_DNS_RESPONSE) {
                responseSent = true;
                return null;
            }
            if (framedQuery.length < queryLength + 2) {
                return null;
            }

            byte[] query = new byte[queryLength];
            System.arraycopy(framedQuery, 2, query, 0, queryLength);
            byte[] response = config.forwardTcp(query, service);
            if (response == null || response.length == 0 ||
                response.length > MAX_TCP_DNS_RESPONSE) {
                return null;
            }

            byte[] framedResponse = new byte[response.length + 2];
            writeUnsignedShort(framedResponse, 0, response.length);
            System.arraycopy(response, 0, framedResponse, 2, response.length);
            responseSent = true;
            return framedResponse;
        }
    }

    private static final class ResolverConfig {
        private final String type;
        private final List<String> addresses;

        private ResolverConfig(String type, List<String> addresses) {
            this.type = type;
            this.addresses = addresses;
        }

        static ResolverConfig from(String type, String primary, String secondary) throws IOException {
            String normalizedType = type == null ? "plain" : type.trim().toLowerCase(Locale.US);
            if (!normalizedType.equals("plain") && !normalizedType.equals("doh") && !normalizedType.equals("dot")) {
                throw new IOException("Unsupported DNS resolver type.");
            }

            List<String> addresses = new ArrayList<>();
            if (primary != null && !primary.trim().isEmpty()) {
                addresses.add(primary.trim());
            }
            if (secondary != null && !secondary.trim().isEmpty()) {
                addresses.add(secondary.trim());
            }
            if (addresses.isEmpty()) {
                throw new IOException("Select an active DNS server before starting protection.");
            }
            return new ResolverConfig(normalizedType, addresses);
        }

        byte[] forward(byte[] query, SafeNetVpnService service) {
            for (String address : addresses) {
                try {
                    byte[] response;
                    if (type.equals("plain")) {
                        response = forwardPlain(query, address, service);
                    } else if (type.equals("dot")) {
                        response = forwardDot(query, address, service);
                    } else {
                        response = forwardDoh(query, address, service);
                    }
                    if (response != null && response.length > 0) {
                        lastError = null;
                        return response;
                    }
                } catch (Exception error) {
                    lastError = safeMessage(error, "The configured DNS resolver did not respond.");
                }
            }
            return null;
        }

        byte[] forwardTcp(byte[] query, SafeNetVpnService service) {
            for (String address : addresses) {
                try {
                    byte[] response;
                    if (type.equals("plain")) {
                        response = forwardPlainTcp(query, address, service);
                    } else if (type.equals("dot")) {
                        response = forwardDot(query, address, service);
                    } else {
                        response = forwardDoh(query, address, service);
                    }
                    if (response != null && response.length > 0) {
                        lastError = null;
                        return response;
                    }
                } catch (Exception error) {
                    lastError = safeMessage(error, "The configured DNS resolver did not respond.");
                }
            }
            return null;
        }

        private static byte[] forwardPlain(byte[] query, String address, SafeNetVpnService service) throws IOException {
            InetAddress[] upstreams = service.resolveHost(address);
            IOException last = null;
            for (InetAddress upstream : upstreams) {
                try (DatagramSocket socket = new DatagramSocket()) {
                    if (!service.protect(socket)) {
                        throw new IOException("Could not protect the DNS connection from the VPN loop.");
                    }
                    socket.setSoTimeout(SOCKET_TIMEOUT_MS);
                    socket.connect(new InetSocketAddress(upstream, DNS_PORT));
                    socket.send(new DatagramPacket(query, query.length));
                    byte[] response = new byte[MAX_DNS_RESPONSE];
                    DatagramPacket packet = new DatagramPacket(response, response.length);
                    socket.receive(packet);
                    byte[] result = new byte[packet.getLength()];
                    System.arraycopy(packet.getData(), packet.getOffset(), result, 0, packet.getLength());
                    return result;
                } catch (IOException error) {
                    last = error;
                }
            }
            throw last == null
                ? new IOException("The configured DNS resolver address could not be reached.")
                : last;
        }

        private static byte[] forwardPlainTcp(
            byte[] query,
            String address,
            SafeNetVpnService service
        ) throws IOException {
            InetAddress[] upstreams = service.resolveHost(address);
            IOException last = null;
            for (InetAddress upstream : upstreams) {
                try (Socket socket = service.openProtectedSocket(
                    new InetAddress[] { upstream },
                    DNS_PORT
                )) {
                    socket.setSoTimeout(SOCKET_TIMEOUT_MS);
                    DataOutputStream output = new DataOutputStream(socket.getOutputStream());
                    output.writeShort(query.length);
                    output.write(query);
                    output.flush();

                    DataInputStream input = new DataInputStream(socket.getInputStream());
                    int length = input.readUnsignedShort();
                    if (length <= 0 || length > MAX_DNS_RESPONSE) {
                        throw new IOException("The DNS-over-TCP response was invalid.");
                    }
                    byte[] response = new byte[length];
                    input.readFully(response);
                    return response;
                } catch (IOException error) {
                    last = error;
                }
            }
            throw last == null
                ? new IOException("The configured DNS resolver address could not be reached.")
                : last;
        }

        private static byte[] forwardDot(byte[] query, String address, SafeNetVpnService service)
            throws IOException, GeneralSecurityException {
            Endpoint endpoint = Endpoint.forDot(address);
            try (Socket raw = service.openProtectedSocket(
                service.resolveHost(endpoint.host),
                endpoint.port
            )) {
                SSLSocket socket = (SSLSocket) SSLContext.getDefault().getSocketFactory()
                    .createSocket(raw, endpoint.host, endpoint.port, true);
                socket.setSoTimeout(SOCKET_TIMEOUT_MS);
                try (SSLSocket secure = socket) {
                    secure.startHandshake();
                    DataOutputStream output = new DataOutputStream(secure.getOutputStream());
                    DataInputStream input = new DataInputStream(secure.getInputStream());
                    output.writeShort(query.length);
                    output.write(query);
                    output.flush();
                    int length = input.readUnsignedShort();
                    if (length <= 0 || length > MAX_DNS_RESPONSE) {
                        throw new IOException("The DNS-over-TLS response was invalid.");
                    }
                    byte[] response = new byte[length];
                    input.readFully(response);
                    return response;
                }
            }
        }

        private static byte[] forwardDoh(byte[] query, String address, SafeNetVpnService service)
            throws IOException, GeneralSecurityException {
            URI uri;
            try {
                uri = URI.create(address);
            } catch (IllegalArgumentException error) {
                throw new IOException("The DNS-over-HTTPS address is invalid.", error);
            }
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
                throw new IOException("DNS-over-HTTPS requires an HTTPS resolver address.");
            }

            int port = uri.getPort() == -1 ? 443 : uri.getPort();
            String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
            if (uri.getRawQuery() != null && !uri.getRawQuery().isEmpty()) {
                path += "?" + uri.getRawQuery();
            }
            try (Socket raw = service.openProtectedSocket(
                service.resolveHost(uri.getHost()),
                port
            )) {
                SSLSocket socket = (SSLSocket) SSLContext.getDefault().getSocketFactory()
                    .createSocket(raw, uri.getHost(), port, true);
                socket.setSoTimeout(SOCKET_TIMEOUT_MS);
                try (SSLSocket secure = socket) {
                    secure.startHandshake();
                    String headers =
                        "POST " + path + " HTTP/1.1\r\n" +
                        "Host: " + uri.getHost() + "\r\n" +
                        "Accept: application/dns-message\r\n" +
                        "Content-Type: application/dns-message\r\n" +
                        "Content-Length: " + query.length + "\r\n" +
                        "Connection: close\r\n\r\n";
                    secure.getOutputStream().write(headers.getBytes(StandardCharsets.US_ASCII));
                    secure.getOutputStream().write(query);
                    secure.getOutputStream().flush();
                    return readHttpResponse(secure.getInputStream());
                }
            }
        }

        private static byte[] readHttpResponse(InputStream stream) throws IOException {
            BufferedInputStream input = new BufferedInputStream(stream);
            ByteArrayOutputStream headerBytes = new ByteArrayOutputStream();
            int matched = 0;
            while (headerBytes.size() < 16384) {
                int value = input.read();
                if (value == -1) {
                    throw new IOException("The DNS-over-HTTPS connection closed before its headers.");
                }
                headerBytes.write(value);
                if ((matched == 0 && value == '\r') ||
                    (matched == 2 && value == '\r') ||
                    (matched == 1 && value == '\n') ||
                    (matched == 3 && value == '\n')) {
                    matched++;
                    if (matched == 4) {
                        break;
                    }
                } else {
                    matched = value == '\r' ? 1 : 0;
                }
            }
            if (matched != 4) {
                throw new IOException("The DNS-over-HTTPS response headers were invalid.");
            }

            String header = new String(headerBytes.toByteArray(), StandardCharsets.ISO_8859_1);
            String[] lines = header.split("\r\n");
            if (lines.length == 0 || !lines[0].contains(" 2")) {
                throw new IOException("The DNS-over-HTTPS resolver returned an error.");
            }
            int contentLength = -1;
            boolean chunked = false;
            for (String line : lines) {
                String lower = line.toLowerCase(Locale.US);
                if (lower.startsWith("content-length:")) {
                    contentLength = Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
                } else if (lower.startsWith("transfer-encoding:") && lower.contains("chunked")) {
                    chunked = true;
                }
            }

            if (chunked) {
                return readChunkedBody(input);
            }
            if (contentLength < 0 || contentLength > MAX_DNS_RESPONSE) {
                throw new IOException("The DNS-over-HTTPS response length was invalid.");
            }
            byte[] body = new byte[contentLength];
            new DataInputStream(input).readFully(body);
            return body;
        }

        private static byte[] readChunkedBody(InputStream input) throws IOException {
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            while (true) {
                String line = readAsciiLine(input);
                int separator = line.indexOf(';');
                String sizeText = separator >= 0 ? line.substring(0, separator) : line;
                int size = Integer.parseInt(sizeText.trim(), 16);
                if (size == 0) {
                    readAsciiLine(input);
                    break;
                }
                if (body.size() + size > MAX_DNS_RESPONSE) {
                    throw new IOException("The DNS-over-HTTPS response was too large.");
                }
                byte[] chunk = new byte[size];
                new DataInputStream(input).readFully(chunk);
                body.write(chunk);
                if (input.read() != '\r' || input.read() != '\n') {
                    throw new IOException("The DNS-over-HTTPS chunk was invalid.");
                }
            }
            return body.toByteArray();
        }

        private static String readAsciiLine(InputStream input) throws IOException {
            ByteArrayOutputStream line = new ByteArrayOutputStream();
            int previous = -1;
            while (line.size() < 4096) {
                int value = input.read();
                if (value == -1) {
                    throw new IOException("The DNS-over-HTTPS response ended unexpectedly.");
                }
                if (previous == '\r' && value == '\n') {
                    byte[] bytes = line.toByteArray();
                    return new String(bytes, 0, bytes.length - 1, StandardCharsets.US_ASCII);
                }
                line.write(value);
                previous = value;
            }
            throw new IOException("The DNS-over-HTTPS response line was too long.");
        }
    }

    private InetAddress[] resolveHost(String host) throws IOException {
        String normalizedHost = host == null ? "" : host.trim();
        if (normalizedHost.isEmpty()) {
            throw new IOException("The DNS resolver hostname is empty.");
        }

        if (isIpLiteral(normalizedHost)) {
            try {
                return new InetAddress[] { InetAddress.getByName(normalizedHost) };
            } catch (UnknownHostException error) {
                throw new IOException("The DNS resolver address is invalid.", error);
            }
        }

        ConnectivityManager connectivity =
            (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity != null) {
            Network[] networks = connectivity.getAllNetworks();
            for (Network network : networks) {
                NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
                if (capabilities == null ||
                    !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ||
                    !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) ||
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                    continue;
                }
                try {
                    InetAddress[] addresses = network.getAllByName(normalizedHost);
                    if (addresses.length > 0) {
                        return addresses;
                    }
                } catch (UnknownHostException ignored) {
                    // Try another underlying network before falling back.
                }
            }
        }

        throw new IOException("No underlying network is available to resolve the DNS resolver.");
    }

    private static boolean isIpLiteral(String host) {
        return host.indexOf(':') >= 0 || host.matches("\\d{1,3}(\\.\\d{1,3}){3}");
    }

    private Socket openProtectedSocket(InetAddress[] addresses, int port) throws IOException {
        IOException last = null;
        for (InetAddress address : addresses) {
            Socket socket = new Socket();
            if (!protect(socket)) {
                socket.close();
                throw new IOException("Could not protect the DNS connection from the VPN loop.");
            }
            try {
                socket.connect(new InetSocketAddress(address, port), SOCKET_TIMEOUT_MS);
                return socket;
            } catch (IOException error) {
                last = error;
                socket.close();
            }
        }
        throw last == null ? new IOException("The DNS resolver address could not be reached.") : last;
    }

    private static final class Endpoint {
        final String host;
        final int port;

        private Endpoint(String host, int port) {
            this.host = host;
            this.port = port;
        }

        static Endpoint forDot(String value) throws IOException {
            String normalized = value.trim();
            if (normalized.startsWith("dot://")) {
                normalized = normalized.substring("dot://".length());
            } else if (normalized.startsWith("tls://")) {
                normalized = normalized.substring("tls://".length());
            }
            try {
                URI uri = URI.create("dot://" + normalized);
                if (uri.getHost() == null) {
                    throw new IOException("The DNS-over-TLS address is invalid.");
                }
                return new Endpoint(uri.getHost(), uri.getPort() == -1 ? 853 : uri.getPort());
            } catch (IllegalArgumentException error) {
                throw new IOException("The DNS-over-TLS address is invalid.", error);
            }
        }
    }
}