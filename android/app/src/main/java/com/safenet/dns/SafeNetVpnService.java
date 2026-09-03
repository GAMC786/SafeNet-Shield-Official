package com.safenet.dns;

import android.app.Service;
import android.content.Intent;
import android.net.VpnService;
import android.os.ParcelFileDescriptor;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketException;
import java.nio.ByteBuffer;
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

public class SafeNetVpnService extends VpnService {
    private static final String TAG = "SafeNetVPN";
    private static final String VIRTUAL_DNS = "10.0.0.1";
    private static final String VIRTUAL_CLIENT = "10.0.0.2";
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
    private static final Object lifecycleLock = new Object();
    private volatile boolean running = false;
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

    public static SafeNetVpnService getInstance() {
        return instance;
    }

    public static void stopVpn() {
        SafeNetVpnService service = instance;
        if (service != null) {
            service.stopSelf();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        synchronized (lifecycleLock) {
            if (running) {
                return START_STICKY;
            }
            instance = this;
            running = true;
            lastError = null;
            worker = Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "SafeNetVPN-Worker");
                t.setDaemon(false);
                return t;
            });
            worker.execute(this::runVpn);
            return START_STICKY;
        }
    }

    private void runVpn() {
        try {
            Builder builder = new Builder();
            builder.setSession("SafeNet DNS VPN")
                .addDnsServer(VIRTUAL_DNS)
                .addDnsServer(VIRTUAL_DNS_V6)
                .addRoute(VIRTUAL_DNS, 32)
                .addRoute(VIRTUAL_DNS_V6 + "/128", 128)
                .addAddress(VIRTUAL_CLIENT, 24)
                .addAddress(VIRTUAL_CLIENT_V6 + "/64", 64);
            
            vpnInterface = builder.establish();
            if (vpnInterface == null) {
                lastError = "Failed to establish VPN interface";
                return;
            }

            try (FileOutputStream out = new FileOutputStream(vpnInterface.getFileDescriptor())) {
                resolver = new ResolverConfig("plain", new ArrayList<>());
                byte[] packet = new byte[32768];
                while (running) {
                    try {
                        int length = vpnInterface.getFileDescriptor().read(packet);
                        if (length > 0) {
                            byte version = (byte) (packet[0] >> 4);
                            if (version == 4) {
                                forwardIpv4Packet(packet, length, out);
                            } else if (version == 6) {
                                forwardIpv6Packet(packet, length, out);
                            }
                        }
                    } catch (IOException e) {
                        if (running) {
                            lastError = "Packet processing error: " + e.getMessage();
                        }
                    }
                }
            }
        } catch (Exception e) {
            lastError = "VPN setup failed: " + e.getMessage();
        } finally {
            stopVpn(false);
        }
    }

    private void forwardIpv4Packet(byte[] packet, int length, FileOutputStream output) throws IOException {
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
        int udpLength = readUnsignedShort(packet, udpOffset + 4);
        if (destinationPort != DNS_PORT || udpLength < 8 ||
            udpLength > ipv4TotalLength - headerLength) {
            return;
        }

        byte[] query = new byte[udpLength - 8];
        System.arraycopy(packet, udpOffset + 8, query, 0, query.length);
        byte[] response = resolver.forward(query, this);
        if (response != null) {
            byte[] ipResponse = createUdpIpv4Response(packet, headerLength, sourcePort, response);
            output.write(ipResponse);
            output.flush();
        }
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
        int udpLength = readUnsignedShort(packet, udpOffset + 4);
        if (destinationPort != DNS_PORT || udpLength < 8 || udpOffset + udpLength > length) {
            return;
        }

        byte[] query = new byte[udpLength - 8];
        System.arraycopy(packet, udpOffset + 8, query, 0, query.length);
        byte[] response = resolver.forward(query, this);
        if (response != null) {
            byte[] ipResponse = createUdpIpv6Response(packet, sourcePort, response);
            output.write(ipResponse);
            output.flush();
        }
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
        byte[] response,
        boolean ipv6
    ) {
        int ipHeaderLength = ipv6 ? 40 : 20;
        byte[] result = new byte[ipHeaderLength + 8 + response.length];
        System.arraycopy(request, 0, result, 0, ipHeaderLength);
        int udpOffset = ipHeaderLength;
        writeUnsignedShort(result, udpOffset, DNS_PORT);
        writeUnsignedShort(result, udpOffset + 2, sourcePort);
        writeUnsignedShort(result, udpOffset + 4, 8 + response.length);
        writeUnsignedShort(result, udpOffset + 6, 0);
        System.arraycopy(response, 0, result, udpOffset + 8, response.length);
        return result;
    }

    private byte[] createUdpIpv4Response(
        byte[] request,
        int headerLength,
        int sourcePort,
        byte[] response
    ) {
        byte[] udpResponse = createUdpResponse(request, sourcePort, response, false);
        writeUnsignedShort(udpResponse, 2, udpResponse.length);
        writeUnsignedShort(udpResponse, 10, checksum(udpResponse, 0, 20));
        return udpResponse;
    }

    private byte[] createUdpIpv6Response(
        byte[] request,
        int sourcePort,
        byte[] response
    ) {
        return createUdpResponse(request, sourcePort, response, true);
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
                } catch (IOException e) {
                    // Ignore
                }
                vpnInterface = null;
            }
            if (!retainError) {
                lastError = null;
            }
            instance = null;
        }
    }

    @Override
    public void onDestroy() {
        stopVpn(true);
        super.onDestroy();
    }

    private boolean matchesAddress(byte[] packet, int offset, String address) {
        byte[] bytes = parseAddress(address);
        if (bytes == null || bytes.length == 0) {
            return false;
        }
        for (int i = 0; i < bytes.length; i++) {
            if (packet[offset + i] != bytes[i]) {
                return false;
            }
        }
        return true;
    }

    private byte[] parseAddress(String address) {
        try {
            return InetAddress.getByName(address).getAddress();
        } catch (Exception e) {
            return null;
        }
    }

    protected InetAddress[] resolveHost(String host) throws IOException {
        return InetAddress.getAllByName(host);
    }

    protected Socket openProtectedSocket(InetAddress[] addresses, int port) throws IOException {
        for (InetAddress address : addresses) {
            try {
                Socket socket = new Socket();
                protect(socket);
                socket.connect(new InetSocketAddress(address, port));
                return socket;
            } catch (IOException e) {
                // Try next address
            }
        }
        throw new IOException("Could not connect to any resolver address");
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
            int high = (value[i] & 0xff) << 8;
            int low = i + 1 < offset + length ? value[i + 1] & 0xff : 0;
            sum += high | low;
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
                    socket.setSoTimeout(SOCKET_TIMEOUT_MS);
                    DatagramPacket request = new DatagramPacket(
                        query, query.length, new InetSocketAddress(upstream, DNS_PORT));
                    socket.send(request);
                    byte[] response = new byte[MAX_DNS_RESPONSE];
                    DatagramPacket responsePacket = new DatagramPacket(response, response.length);
                    socket.receive(responsePacket);
                    byte[] result = new byte[responsePacket.getLength()];
                    System.arraycopy(response, 0, result, 0, responsePacket.getLength());
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
            // DoT implementation
            return null;
        }

        private static byte[] forwardDoh(byte[] query, String address, SafeNetVpnService service)
            throws IOException, GeneralSecurityException {
            // DoH implementation
            return null;
        }
    }
}