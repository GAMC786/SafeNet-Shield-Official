package com.safenet.dns;

import android.content.Intent;
import android.net.VpnService;
import android.os.ParcelFileDescriptor;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.os.Build;
import java.util.UUID;
import libtailscale.Libtailscale;

public final class SafeNetTailscaleVpnService extends VpnService implements libtailscale.IPNService {
    private static volatile SafeNetTailscaleVpnService activeService;
    private final String id = UUID.randomUUID().toString();
    private boolean closed;

    static void updateUnderlyingNetworks(android.net.Network[] networks) {
        SafeNetTailscaleVpnService service = activeService;
        if (service != null) service.setUnderlyingNetworks(networks);
    }

    @Override public String id() { return id; }
    @Override public boolean protect(int fd) { return super.protect(fd); }
    @Override public void onCreate() {
        super.onCreate();
        activeService = this;
        setUnderlyingNetworks(SafeNetTailscaleApp.get(this).underlyingNetworks());
    }
    @Override public libtailscale.VPNServiceBuilder newBuilder() {
        Builder builder = new Builder()
            .setSession("SafeNet Tailscale")
            .allowFamily(android.system.OsConstants.AF_INET)
            .allowFamily(android.system.OsConstants.AF_INET6)
            .setUnderlyingNetworks(SafeNetTailscaleApp.get(this).underlyingNetworks());
        if (Build.VERSION.SDK_INT >= 29) builder.setMetered(false);
        Intent configure = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, configure, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        builder.setConfigureIntent(pendingIntent);
        return new BuilderBridge(builder);
    }
    @Override public void close() {
        if (closed) return;
        closed = true;
        stopSelf();
        Libtailscale.serviceDisconnect(this);
    }
    @Override public void disconnectVPN() { stopSelf(); }
    @Override public void updateVpnStatus(boolean connected) { SafeNetTailscalePlugin.setConnected(connected); }
    @Override public void onDestroy() {
        close();
        SafeNetTailscalePlugin.setConnected(false);
        if (activeService == this) activeService = null;
        super.onDestroy();
    }
    @Override public void onRevoke() {
        try { SafeNetTailscaleApp.get(this).setWantRunning(false); } catch (Exception ignored) {}
        close();
        SafeNetTailscalePlugin.setConnected(false);
        super.onRevoke();
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "STOP".equals(intent.getAction())) { close(); return START_NOT_STICKY; }
        boolean startedBySystem = intent != null && "android.net.VpnService".equals(intent.getAction());
        if (intent == null) {
            try {
                if (!SafeNetTailscaleApp.get(this).api("GET", "/localapi/v0/prefs", null)
                    .optBoolean("WantRunning", false)) return START_NOT_STICKY;
            } catch (Exception e) {
                return START_NOT_STICKY;
            }
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(
                "tailscale", "Tailscale VPN", NotificationManager.IMPORTANCE_LOW));
            startForeground(42, new Notification.Builder(this, "tailscale")
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setContentTitle("Tailscale VPN")
                .setContentText("Connecting")
                .setOngoing(true)
                .build());
        }
        if (startedBySystem) {
            try { SafeNetTailscaleApp.get(this).setWantRunning(true); } catch (Exception ignored) {}
        }
        if (intent == null || "START".equals(intent.getAction()) || startedBySystem) {
            closed = false;
            Libtailscale.requestVPN(this);
            return START_STICKY;
        }
        return START_STICKY;
    }
    private static final class BuilderBridge implements libtailscale.VPNServiceBuilder {
        private final Builder b; BuilderBridge(Builder b) { this.b = b; }
        @Override public void setMTU(int mtu) { b.setMtu(mtu); }
        @Override public void addDNSServer(String s) { b.addDnsServer(s); }
        @Override public void addSearchDomain(String s) { b.addSearchDomain(s); }
        @Override public void addRoute(String s, int p) { b.addRoute(s, p); }
        @Override public void excludeRoute(String s, int p) {
            if (android.os.Build.VERSION.SDK_INT >= 33) b.excludeRoute(new android.net.IpPrefix(s, p));
        }
        @Override public void addAddress(String s, int p) { b.addAddress(s, p); }
        @Override public libtailscale.ParcelFileDescriptor establish() {
            ParcelFileDescriptor fd = b.establish();
            return fd == null ? null : new Pfd(fd);
        }
    }
    private static final class Pfd implements libtailscale.ParcelFileDescriptor {
        private final ParcelFileDescriptor fd; Pfd(ParcelFileDescriptor fd) { this.fd = fd; }
        @Override public int detach() { return fd.detachFd(); }
    }
}