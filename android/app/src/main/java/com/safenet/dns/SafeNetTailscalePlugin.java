package com.safenet.dns;

import android.app.Activity;
import android.content.Intent;
import android.net.VpnService;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "SafeNetTailscale")
public final class SafeNetTailscalePlugin extends Plugin {
    private static volatile boolean connected;
    private static final String CONSENT = "tailscaleVpnConsent";
    static void setConnected(boolean value) { connected = value; }

    @PluginMethod public void getStatus(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26) { call.resolve(status(false, "unsupported")); return; }
        try {
            SafeNetTailscaleApp app = SafeNetTailscaleApp.get(getContext());
            JSONObject json = app.api("GET", "/localapi/v0/status", null);
            JSONObject prefs = app.api("GET", "/localapi/v0/prefs", null);
            String backendState = json.optString("BackendState", "Unknown");
            JSObject out = status(
                connected || "Running".equalsIgnoreCase(backendState),
                backendState
            );
            JSONObject self = json.optJSONObject("Self");
            if (self != null) {
                put(out, "selfName", self.optString("DNSName", self.optString("HostName", null)));
                JSONArray addresses = self.optJSONArray("TailscaleIPs");
                if (addresses != null) out.put("addresses", addresses);
            }
            JSONObject tailnet = json.optJSONObject("CurrentTailnet");
            put(out, "tailnetName", tailnet == null ? null : tailnet.optString("Name", null));
            out.put("loginRequired", "NeedsLogin".equalsIgnoreCase(json.optString("BackendState")));
            put(out, "authUrl", json.optString("AuthURL", null));
            out.put("acceptRoutes", prefs.optBoolean("RouteAll", false));
            out.put("useTailscaleDNS", prefs.optBoolean("CorpDNS", false));
            out.put("allowLanAccess", prefs.optBoolean("ExitNodeAllowLANAccess", false));
            if (!prefs.isNull("ExitNodeID")) put(out, "selectedExitNodeId", prefs.optString("ExitNodeID", null));
            JSONArray exits = new JSONArray();
            JSONObject peers = json.optJSONObject("Peer");
            if (peers != null) for (String key : peers.keySet()) {
                JSONObject peer = peers.optJSONObject(key);
                if (peer != null && peer.optBoolean("ExitNodeOption", false)) {
                    JSONObject exit = new JSONObject();
                    exit.put("id", peer.optString("ID", key));
                    put(exit, "name", peer.optString("DNSName", peer.optString("HostName", null)));
                    exit.put("online", peer.optBoolean("Online", false));
                    exits.put(exit);
                }
            }
            out.put("exitNodes", exits);
            call.resolve(out);
        } catch (Exception e) {
            JSObject out = status(connected, "Unavailable"); out.put("error", e.getMessage());
            call.resolve(out);
        }
    }
    @PluginMethod public void connect(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26) { call.reject("Tailscale requires Android 8.0 or newer.", "TAILSCALE_UNSUPPORTED"); return; }
        Intent consent = VpnService.prepare(getActivity());
        if (consent != null) { startActivityForResult(call, consent, CONSENT); return; }
        startEngine(call);
    }
    @ActivityCallback private void tailscaleVpnConsent(PluginCall call, com.getcapacitor.ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Android VPN consent was denied.", "TAILSCALE_CONSENT_DENIED"); return;
        }
        startEngine(call);
    }
    private void startEngine(PluginCall call) {
        try {
            SafeNetTailscaleApp app = SafeNetTailscaleApp.get(getContext());
            app.api("POST", "/localapi/v0/start", new JSONObject());
            app.setWantRunning(true);
            getContext().startForegroundService(new Intent(getContext(), SafeNetTailscaleVpnService.class).setAction("START"));
            getStatus(call);
        } catch (Exception e) { call.reject("Tailscale could not start.", "TAILSCALE_START_FAILED", e); }
    }
    @PluginMethod public void disconnect(PluginCall call) {
        try {
            SafeNetTailscaleApp.get(getContext()).setWantRunning(false);
            getContext().startService(new Intent(getContext(), SafeNetTailscaleVpnService.class).setAction("STOP"));
            connected = false;
            getStatus(call);
        } catch (Exception e) {
            call.reject("Tailscale could not disconnect.", "TAILSCALE_DISCONNECT_FAILED", e);
        }
    }
    @PluginMethod public void setOptions(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26) { call.reject("Tailscale requires Android 8.0 or newer.", "TAILSCALE_UNSUPPORTED"); return; }
        try {
            JSONObject body = new JSONObject();
            if (call.getData().has("acceptRoutes")) {
                body.put("RouteAllSet", true);
                body.put("RouteAll", call.getBoolean("acceptRoutes"));
            }
            if (call.getData().has("useTailscaleDNS")) {
                body.put("CorpDNSSet", true);
                body.put("CorpDNS", call.getBoolean("useTailscaleDNS"));
            }
            if (call.getData().has("allowLanAccess")) {
                body.put("ExitNodeAllowLANAccessSet", true);
                body.put("ExitNodeAllowLANAccess", call.getBoolean("allowLanAccess"));
            }
            if (call.getData().has("exitNodeId")) {
                String exit = call.getString("exitNodeId", null);
                body.put("ExitNodeIDSet", true);
                body.put("ExitNodeID", exit == null ? JSONObject.NULL : exit);
            }
            SafeNetTailscaleApp app = SafeNetTailscaleApp.get(getContext());
            app.api("PATCH", "/localapi/v0/prefs", body);
            getStatus(call);
        } catch (Exception e) { call.reject("Tailscale options could not be saved.", "TAILSCALE_OPTIONS_FAILED", e); }
    }
    @PluginMethod public void openLoginUrl(PluginCall call) {
        String value = call.getString("url", null);
        if (value == null) { call.reject("A Tailscale login URL is required.", "TAILSCALE_URL_REQUIRED"); return; }
        Uri uri = Uri.parse(value);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null ||
            !(uri.getHost().equals("login.tailscale.com") || uri.getHost().endsWith(".tailscale.com"))) {
            call.reject("Only HTTPS Tailscale authentication URLs are allowed.", "TAILSCALE_URL_INVALID"); return;
        }
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri));
            call.resolve();
        } catch (Exception e) {
            call.reject("No browser could open the Tailscale sign-in page.", "TAILSCALE_BROWSER_UNAVAILABLE", e);
        }
    }
    private static JSObject status(boolean running, String state) {
        JSObject out = new JSObject(); out.put("supported", Build.VERSION.SDK_INT >= 26);
        out.put("backendState", state); out.put("connected", running);
        out.put("loginRequired", false); out.put("acceptRoutes", false);
        out.put("useTailscaleDNS", false); out.put("allowLanAccess", false); return out;
    }
    private static void put(JSObject o, String key, String value) { if (value != null && !value.isEmpty()) o.put(key, value); }
    static final class BytesInput implements libtailscale.InputStream {
        private final byte[] data; private boolean read;
        BytesInput(byte[] data) { this.data = data; }
        @Override public byte[] read() { if (read) return null; read = true; return data; }
        @Override public void close() {}
    }
}