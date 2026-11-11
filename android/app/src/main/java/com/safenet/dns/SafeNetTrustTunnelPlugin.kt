package com.safenet.dns

import android.app.Activity
import android.net.VpnService
import com.adguard.trusttunnel.AppNotifier
import com.adguard.trusttunnel.DeepLink
import com.adguard.trusttunnel.VpnConfigStorage
import com.adguard.trusttunnel.VpnState
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

@CapacitorPlugin(name = "SafeNetTrustTunnel")
class SafeNetTrustTunnelPlugin : Plugin() {
    private val preferences by lazy {
        context.getSharedPreferences("safenet_trusttunnel", android.content.Context.MODE_PRIVATE)
    }

    override fun load() {
        com.adguard.trusttunnel.VpnService.initialize(context.applicationContext)
        com.adguard.trusttunnel.VpnService.setAppNotifier(
            File(context.filesDir, "trusttunnel-connection.log"),
            object : AppNotifier {
                override fun onStateChanged(state: Int) {
                    preferences.edit().putInt(KEY_STATE, state).apply()
                    notifyListeners("vpnStateChanged", status())
                }

                override fun onConnectionInfo(info: String) {
                    notifyListeners("vpnConnectionInfo", JSObject().apply { put("info", info) })
                }
            },
        )
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(status())
    }

    @PluginMethod
    fun importConfig(call: PluginCall) {
        val link = call.getString("deepLink")?.trim().orEmpty()
        if (!link.startsWith("tt://")) {
            call.reject("Paste a TrustTunnel tt:// configuration link.", "TRUSTTUNNEL_LINK_REQUIRED")
            return
        }
        try {
            val decodedEndpoint = DeepLink.decode(link)
            val endpoint = if (Regex("(?m)^\\s*dns_upstreams\\s*=").containsMatchIn(decodedEndpoint)) {
                decodedEndpoint
            } else {
                decodedEndpoint.replaceFirst(
                    "[endpoint]",
                    "[endpoint]\ndns_upstreams = [\"tls://family.adguard-dns.com\"]",
                )
            }
            val config = """
                [listener.tun]
                included_routes = ["0.0.0.0/0", "::/0"]
                excluded_routes = []
                mtu_size = 1500

                $endpoint
            """.trimIndent()
            if (com.adguard.trusttunnel.VpnServiceConfig.parseToml(config) == null) {
                call.reject("The TrustTunnel link did not produce a valid VPN configuration.", "TRUSTTUNNEL_CONFIG_INVALID")
                return
            }
            preferences.edit().putString(KEY_CONFIG, config).apply()
            call.resolve(status())
        } catch (error: Exception) {
            call.reject("The TrustTunnel configuration link is invalid.", "TRUSTTUNNEL_LINK_INVALID", error)
        }
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        if (preferences.getString(KEY_CONFIG, null).isNullOrBlank()) {
            call.reject("Import a TrustTunnel link before connecting.", "TRUSTTUNNEL_CONFIG_REQUIRED")
            return
        }
        val activity = activity
        if (activity == null) {
            call.reject("SafeNet must be open to request Android VPN permission.", "TRUSTTUNNEL_ACTIVITY_REQUIRED")
            return
        }
        val consent = VpnService.prepare(activity)
        if (consent != null) {
            startActivityForResult(call, consent, "vpnConsentResult")
            return
        }
        startTunnel(call)
    }

    @ActivityCallback
    private fun vpnConsentResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("Android VPN permission was not granted.", "TRUSTTUNNEL_PERMISSION_DENIED")
            return
        }
        startTunnel(call)
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        com.adguard.trusttunnel.VpnService.stop(context.applicationContext)
        preferences.edit().putInt(KEY_STATE, VpnState.DISCONNECTED.code).apply()
        call.resolve(status())
    }

    @PluginMethod
    fun removeConfig(call: PluginCall) {
        if (VpnState.getByCode(preferences.getInt(KEY_STATE, VpnState.DISCONNECTED.code)) != VpnState.DISCONNECTED) {
            call.reject("Disconnect the VPN before removing its configuration.", "TRUSTTUNNEL_DISCONNECT_REQUIRED")
            return
        }
        preferences.edit().remove(KEY_CONFIG).apply()
        VpnConfigStorage(context).clear()
        call.resolve(status())
    }

    private fun startTunnel(call: PluginCall) {
        val config = preferences.getString(KEY_CONFIG, null)
        if (config.isNullOrBlank()) {
            call.reject("Import a TrustTunnel link before connecting.", "TRUSTTUNNEL_CONFIG_REQUIRED")
            return
        }
        try {
            com.adguard.trusttunnel.VpnService.start(context.applicationContext, config, true)
            preferences.edit().putInt(KEY_STATE, VpnState.CONNECTING.code).apply()
            call.resolve(status())
        } catch (error: Exception) {
            call.reject("SafeNet could not start the TrustTunnel VPN.", "TRUSTTUNNEL_START_FAILED", error)
        }
    }

    private fun status(): JSObject {
        val state = VpnState.getByCode(
            preferences.getInt(KEY_STATE, VpnState.DISCONNECTED.code),
        )
        return JSObject().apply {
            put("supported", true)
            put("configured", !preferences.getString(KEY_CONFIG, null).isNullOrBlank())
            put("state", state.name.lowercase())
            put("connected", state == VpnState.CONNECTED)
            put("connecting", state == VpnState.CONNECTING || state == VpnState.RECOVERING)
        }
    }

    companion object {
        private const val KEY_CONFIG = "vpn_config"
        private const val KEY_STATE = "vpn_state"
    }
}
