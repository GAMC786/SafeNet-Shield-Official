package com.safenet.dns

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat
import bridge.Bridge
import bridge.Handler
import bridge.TCPConn
import bridge.UDPConn
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

class SafeNetLocalVpnService : VpnService() {
    companion object {
        const val ACTION_START = "com.safenet.dns.LOCAL_VPN_START"
        const val ACTION_STOP = "com.safenet.dns.LOCAL_VPN_STOP"
        @Volatile var running = false
            private set
        @Volatile private var lastError: String? = null
        @JvmStatic fun isRunningNow(): Boolean = running
        @JvmStatic fun getLastErrorMessage(): String? = lastError
        private const val CHANNEL = "safenet-local-vpn"
    }

    @Volatile private var resolverType = "dot"
    @Volatile private var resolverPrimary = "family.adguard-dns.com"
    @Volatile private var resolverSecondary: String? = null
    @Volatile private var pool = Executors.newCachedThreadPool()
    private var tun: ParcelFileDescriptor? = null
    private var tunnel: bridge.Tunnel? = null
    private val stopped = AtomicBoolean(false)

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopTunnel()
            stopSelf()
        } else if (intent?.action == ACTION_START || !running) {
            val nextType = intent?.getStringExtra("resolverType") ?: resolverType
            val nextPrimary = intent?.getStringExtra("primaryAddress") ?: resolverPrimary
            val nextSecondary = intent?.getStringExtra("secondaryAddress")
            val changed = nextType != resolverType || nextPrimary != resolverPrimary || nextSecondary != resolverSecondary
            resolverType = nextType
            resolverPrimary = nextPrimary
            resolverSecondary = nextSecondary
            if (running && changed) stopTunnel()
            if (!running) {
                startForeground(7301, notification())
                startTunnel()
            }
        }
        return START_STICKY
    }

    private fun startTunnel() {
        if (pool.isShutdown) pool = Executors.newCachedThreadPool()
        stopped.set(false)
        lastError = null
        val network = upstreamNetwork()
        setUnderlyingNetworks(network?.let { arrayOf(it) })
        val pfd = try {
            Builder()
                .setSession("SafeNet Local VPN")
                .setMtu(1500)
                .addAddress("10.111.0.2", 32)
                .addAddress("fd00:6e76:6376::2", 128)
                .addDnsServer("10.111.0.1")
                .addRoute("0.0.0.0", 0)
                .addRoute("::", 0)
                .establish()
        } catch (error: Exception) {
            lastError = error.message ?: "Android could not establish the local VPN."
            stopSelf()
            return
        } ?: run {
            lastError = "Android did not grant the VPN interface."
            stopSelf()
            return
        }
        tun = pfd
        try {
            tunnel = Bridge.newTunnel(pfd.detachFd().toLong(), 1500L, "RELAY", FlowHandler())
            running = true
        } catch (error: Exception) {
            lastError = error.message ?: "The local packet engine could not start."
            stopTunnel()
            stopSelf()
        }
    }

    private inner class FlowHandler : Handler {
        override fun handleTCP(srcIp: String, srcPort: Long, dstIp: String, dstPort: Long, conn: TCPConn) {
            pool.execute {
                try {
                    if (dstPort.toInt() == 53) {
                        relayTcpDns(conn, srcIp, dstIp)
                        return@execute
                    }
                    val upstream = Socket().also {
                        if (!protect(it)) throw IllegalStateException("Could not protect upstream socket")
                        it.connect(InetSocketAddress(InetAddress.getByName(dstIp), dstPort.toInt()), 12000)
                    }
                    pump(conn, upstream)
                } catch (_: Exception) { runCatching { conn.close() } }
            }
        }

        override fun handleUDP(srcIp: String, srcPort: Long, dstIp: String, dstPort: Long, conn: UDPConn) {
            pool.execute {
                if (dstPort.toInt() == 53) {
                    try {
                        while (!stopped.get()) conn.send(resolveDns(conn.receive(), srcIp, dstIp))
                    } catch (_: Exception) { runCatching { conn.close() } }
                } else {
                    val socket = DatagramSocket()
                    try {
                        if (!protect(socket)) throw IllegalStateException("Could not protect upstream socket")
                        socket.connect(InetAddress.getByName(dstIp), dstPort.toInt())
                        val reader = pool.submit {
                            val data = ByteArray(65507)
                            while (!stopped.get()) {
                                val packet = DatagramPacket(data, data.size)
                                socket.receive(packet)
                                conn.send(packet.data.copyOf(packet.length))
                            }
                        }
                        while (!stopped.get()) {
                            val data = conn.receive()
                            socket.send(DatagramPacket(data, data.size))
                        }
                        reader.cancel(true)
                    } catch (_: Exception) { runCatching { conn.close() } }
                    finally { socket.close() }
                }
            }
        }

        override fun log(level: Long, msg: String) {}
    }

    private fun dotSocket(address: String): SSLSocket {
        val (host, port) = parseHostPort(address, 853)
        val network = upstreamNetwork()
            ?: throw IllegalStateException("No validated internet network is available for DNS-over-TLS.")
        val resolved = network.getAllByName(host).firstOrNull()
            ?: throw IllegalStateException("The selected DNS-over-TLS host did not resolve.")
        val raw = network.socketFactory.createSocket()
        if (!protect(raw)) throw IllegalStateException("Could not protect DNS socket")
        raw.connect(InetSocketAddress(resolved, port), 10000)
        val factory = SSLSocketFactory.getDefault() as SSLSocketFactory
        val tls = factory.createSocket(raw, host, port, true) as SSLSocket
        tls.sslParameters = tls.sslParameters.apply {
            endpointIdentificationAlgorithm = "HTTPS"
            runCatching { SNIHostName(host) }.getOrNull()?.let { serverNames = listOf(it) }
        }
        tls.startHandshake()
        return tls
    }

    private fun dotQuery(query: ByteArray, address: String): ByteArray {
        val socket = dotSocket(address)
        socket.use {
            val out = it.outputStream
            out.write((query.size shr 8) and 0xff)
            out.write(query.size and 0xff)
            out.write(query)
            out.flush()
            val input = it.inputStream
            val size = (input.read() shl 8) or input.read()
            require(size in 12..65535) { "Invalid DNS response length" }
            val response = ByteArray(size)
            var offset = 0
            while (offset < size) {
                val read = input.read(response, offset, size - offset)
                if (read < 0) throw IllegalStateException("Truncated DNS response")
                offset += read
            }
            return response
        }
    }

    private fun resolveDns(query: ByteArray, source: String, destination: String): ByteArray {
        val decision = FirewallConfigStore.load(this).evaluate(query, source, destination)
        if (decision == DnsFirewall.Decision.BLOCK) return nxdomain(query)
        return try {
            querySelectedResolver(query, resolverPrimary)
        } catch (primaryFailure: Exception) {
            val secondary = resolverSecondary?.takeIf { it.isNotBlank() } ?: throw primaryFailure
            querySelectedResolver(query, secondary)
        }
    }

    private fun querySelectedResolver(query: ByteArray, address: String): ByteArray =
        when (resolverType) {
            "plain" -> plainQuery(query, address)
            "dot" -> dotQuery(query, address)
            "doh" -> dohQuery(query, address)
            "sdns" -> tunnel?.dnscryptQuery(address, query)
                ?: throw IllegalStateException("The local DNSCrypt tunnel is not ready.")
            else -> throw IllegalStateException("The active DNS server uses an unsupported protocol.")
        }

    private fun plainQuery(query: ByteArray, address: String): ByteArray {
        val target = InetAddress.getByName(address.trim())
        val network = upstreamNetwork()
        val socket = DatagramSocket()
        try {
            network?.bindSocket(socket)
            if (!protect(socket)) throw IllegalStateException("Could not protect DNS socket")
            socket.soTimeout = 8000
            socket.connect(target, 53)
            socket.send(DatagramPacket(query, query.size))
            val response = ByteArray(65535)
            val packet = DatagramPacket(response, response.size)
            socket.receive(packet)
            return packet.data.copyOf(packet.length)
        } finally {
            socket.close()
        }
    }

    private fun dohQuery(query: ByteArray, endpoint: String): ByteArray {
        val url = URL(endpoint)
        require(url.protocol == "https") { "DNS-over-HTTPS requires an https:// resolver URL." }
        val network = upstreamNetwork()
            ?: throw IllegalStateException("No validated internet network is available for DNS-over-HTTPS.")
        val connection = network.openConnection(url) as HttpsURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 10000
            connection.readTimeout = 10000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/dns-message")
            connection.setRequestProperty("Accept", "application/dns-message")
            connection.outputStream.use { it.write(query) }
            require(connection.responseCode in 200..299) { "DNS-over-HTTPS returned HTTP ${connection.responseCode}." }
            return connection.inputStream.use { it.readBytes() }
        } finally {
            connection.disconnect()
        }
    }

    private fun parseHostPort(address: String, defaultPort: Int): Pair<String, Int> {
        val value = address.trim()
        if (value.startsWith("[")) {
            val end = value.indexOf(']')
            require(end > 0) { "Invalid DNS-over-TLS address." }
            val port = value.substring(end + 1).removePrefix(":").toIntOrNull() ?: defaultPort
            return value.substring(1, end) to port
        }
        val colon = value.lastIndexOf(':')
        if (colon > 0 && value.indexOf(':') == colon) {
            val port = value.substring(colon + 1).toIntOrNull()
            if (port != null) return value.substring(0, colon) to port
        }
        return value to defaultPort
    }

    private fun upstreamNetwork(): Network? {
        val connectivity = getSystemService(ConnectivityManager::class.java)
        val network = connectivity.allNetworks.firstOrNull { candidate ->
            val caps = connectivity.getNetworkCapabilities(candidate) ?: return@firstOrNull false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                && !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
        }
        return network
    }

    private fun nxdomain(query: ByteArray): ByteArray {
        require(query.size >= 12) { "Invalid DNS query" }
        val response = query.copyOf()
        val flags = (((response[2].toInt() and 0xff) shl 8) or (response[3].toInt() and 0xff))
        val responseFlags = (flags or 0x8083) and 0xffef
        response[2] = (responseFlags shr 8).toByte()
        response[3] = responseFlags.toByte()
        response[6] = 0; response[7] = 0
        response[8] = 0; response[9] = 0
        response[10] = 0; response[11] = 0
        return response
    }

    private fun relayTcpDns(app: TCPConn, source: String, destination: String) {
        try {
            while (!stopped.get()) {
                val prefix = readAppBytes(app, 2) ?: break
                val size = ((prefix[0].toInt() and 0xff) shl 8) or (prefix[1].toInt() and 0xff)
                require(size in 12..65535) { "Invalid TCP DNS message length" }
                val response = resolveDns(readAppBytes(app, size) ?: break, source, destination)
                app.write(byteArrayOf((response.size shr 8).toByte(), response.size.toByte()))
                app.write(response)
            }
        } finally { runCatching { app.close() } }
    }

    private fun readAppBytes(conn: TCPConn, size: Int): ByteArray? {
        val bytes = ByteArray(size)
        var offset = 0
        while (offset < size && !stopped.get()) {
            val chunk = ByteArray(size - offset)
            val read = conn.read(chunk).toInt()
            if (read <= 0) return null
            System.arraycopy(chunk, 0, bytes, offset, read)
            offset += read
        }
        return if (offset == size) bytes else null
    }

    private fun pump(app: TCPConn, upstream: Socket) {
        val reader = pool.submit {
            val buffer = ByteArray(16384)
            try {
                while (!stopped.get()) {
                    val n = upstream.getInputStream().read(buffer)
                    if (n < 0) break
                app.write(buffer.copyOfRange(0, n))
                }
            } finally { runCatching { app.close() } }
        }
        val buffer = ByteArray(16384)
        try {
            while (!stopped.get()) {
                val n = app.read(buffer)
                if (n <= 0) break
                upstream.getOutputStream().write(buffer, 0, n.toInt())
                upstream.getOutputStream().flush()
            }
        } finally {
            reader.cancel(true)
            runCatching { upstream.close() }
            runCatching { app.close() }
        }
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "SafeNet local VPN", NotificationManager.IMPORTANCE_LOW)
        )
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val pending = launch?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle("SafeNet protection is active")
            .setContentText("DNS requests are filtered on this phone.")
            .setOngoing(true)
            .setContentIntent(pending)
            .build()
    }

    private fun stopTunnel() {
        if (!stopped.compareAndSet(false, true)) return
        running = false
        runCatching { tunnel?.stop() }
        tunnel = null
        runCatching { tun?.close() }
        tun = null
        pool.shutdownNow()
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onRevoke() { stopTunnel(); stopSelf(); super.onRevoke() }
    override fun onDestroy() { stopTunnel(); super.onDestroy() }
}
