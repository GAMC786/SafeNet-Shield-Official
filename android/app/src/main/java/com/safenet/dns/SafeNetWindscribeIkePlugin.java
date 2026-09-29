package com.safenet.dns;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.net.VpnService;
import android.os.Build;
import android.os.IBinder;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.wireguard.android.backend.GoBackend;
import com.wireguard.android.backend.Tunnel;

import org.strongswan.android.data.VpnProfile;
import org.strongswan.android.data.VpnType;
import org.strongswan.android.logic.CharonVpnService;
import org.strongswan.android.logic.VpnStateService;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "SafeNetWindscribeIke")
public final class SafeNetWindscribeIkePlugin extends Plugin {
    private static final Pattern SDNS_STAMP_PATTERN =
            Pattern.compile("^sdns://[A-Za-z0-9_-]{1,8184}$");
    private static final String LEGACY_WIREGUARD_TUNNEL_NAME = "windscribe";
    private static final String SDNS_DNS_SERVERS = "198.18.0.1 fd42:5341:4645::53";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "safenet-windscribe-ikev2");
        thread.setDaemon(true);
        return thread;
    });
    private static final Object STATE_SERVICE_LOCK = new Object();
    private static volatile VpnStateService stateService;
    private static CompletableFuture<VpnStateService> stateServiceReady;
    private static boolean stateServiceBound;
    private static volatile boolean connected;
    private static volatile Context applicationContext;
    private volatile String lastError;

    private static final VpnStateService.VpnStateListener STATE_LISTENER = () -> {
        VpnStateService service = stateService;
        publishConnectionState(service != null
                && service.getState() == VpnStateService.State.CONNECTED);
    };

    private static final ServiceConnection STATE_SERVICE_CONNECTION = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            VpnStateService service =
                    ((VpnStateService.LocalBinder) binder).getService();
            CompletableFuture<VpnStateService> ready;
            synchronized (STATE_SERVICE_LOCK) {
                stateService = service;
                ready = stateServiceReady;
            }
            service.registerListener(STATE_LISTENER);
            if (ready != null) {
                ready.complete(service);
            }
            publishConnectionState(service.getState() == VpnStateService.State.CONNECTED);
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            synchronized (STATE_SERVICE_LOCK) {
                stateService = null;
                stateServiceBound = false;
                stateServiceReady = null;
            }
            publishConnectionState(false);
        }
    };

    static boolean isConnected() {
        return connected;
    }

    /**
     * Keep the Go filter's policy synchronized with the snapshot used by the
     * legacy WireGuard path and the next IKEv2 connection.
     */
    public static boolean updateFirewallPolicy(Context context, String serializedPolicy) {
        try {
            Context appContext = context.getApplicationContext();
            String stamp = new WindscribeProfileStore(appContext).readResolverStamp();
            return CharonVpnService.setSafeNetPacketFilter(
                    stamp,
                    serializedPolicy == null ? "" : serializedPolicy
            );
        } catch (Exception | LinkageError error) {
            return false;
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        runStatus(call, () -> currentStatus(resolverStampForCall(call)),
                "Windscribe IKEv2 status is unavailable.");
    }

    @PluginMethod
    public void saveCredentials(PluginCall call) {
        if (!isSupported()) {
            call.reject("Windscribe IKEv2 requires Android 8.0 or later.");
            return;
        }
        String serverHost = call.getString("serverHost");
        String username = call.getString("username");
        String password = call.getString("password");
        EXECUTOR.execute(() -> {
            try {
                VpnStateService service = bindStateService(getContext());
                if (service.getState() != VpnStateService.State.DISABLED) {
                    call.reject("Disconnect Windscribe IKEv2 before replacing its credentials.");
                    return;
                }
                credentialStore().save(serverHost, username, password);
                lastError = null;
                call.resolve(currentStatus());
            } catch (IllegalArgumentException error) {
                call.reject(error.getMessage() == null
                        ? "Enter the generated Windscribe IKEv2 credentials."
                        : error.getMessage());
            } catch (Exception error) {
                call.reject("Windscribe IKEv2 credentials could not be saved securely.");
            }
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (!isSupported()) {
            call.reject("Windscribe IKEv2 requires Android 8.0 or later.");
            return;
        }
        try {
            if (!credentialStore().hasCredentials()) {
                call.reject("Save your generated Windscribe IKEv2 credentials first.");
                return;
            }
            resolverStampForCall(call);
            Intent consentIntent = VpnService.prepare(getActivity());
            if (consentIntent != null) {
                startActivityForResult(call, consentIntent, "vpnConsentResult");
                return;
            }
            connectWithCredentials(call);
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage() == null
                    ? "Enter a valid bounded sdns:// stamp."
                    : error.getMessage());
        } catch (Exception error) {
            call.reject("The encrypted Windscribe IKEv2 credentials could not be opened.");
        }
    }

    @ActivityCallback
    private void vpnConsentResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Android VPN permission was not granted.");
            return;
        }
        connectWithCredentials(call);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        EXECUTOR.execute(() -> {
            try {
                VpnStateService service = bindStateService(getContext());
                disconnectAndWait(service);
                lastError = null;
                call.resolve(currentStatus(resolverStampForCall(call)));
            } catch (Exception error) {
                lastError = "Windscribe IKEv2 could not disconnect cleanly.";
                call.reject(lastError);
            }
        });
    }

    @PluginMethod
    public void removeProfile(PluginCall call) {
        EXECUTOR.execute(() -> {
            try {
                VpnStateService service = bindStateService(getContext());
                disconnectAndWait(service);
                credentialStore().clear();
                profileStore().saveResolverStamp(null);
                lastError = null;
                call.resolve(currentStatus(null));
            } catch (Exception error) {
                call.reject("Windscribe IKEv2 credentials could not be removed.");
            }
        });
    }

    private void connectWithCredentials(PluginCall call) {
        final String resolverStamp;
        try {
            resolverStamp = resolverStampForCall(call);
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage() == null
                    ? "Enter a valid bounded sdns:// stamp."
                    : error.getMessage());
            return;
        }

        EXECUTOR.execute(() -> {
            try {
                Context context = getContext().getApplicationContext();
                VpnStateService state = bindStateService(context);
                if (state.getState() != VpnStateService.State.DISABLED) {
                    throw new IllegalStateException(
                            "Disconnect the current VPN before starting Windscribe IKEv2.");
                }

                stopLegacyVpnEngines(context);
                WindscribeIkeCredentialStore.Credentials credentials = credentialStore().read();
                String policy = FirewallConfigStore.loadSerialized(context);
                if (policy == null) {
                    policy = "";
                }

                VpnProfile profile = new VpnProfile();
                profile.setName("SafeNet Windscribe IKEv2");
                profile.setGateway(credentials.serverHost);
                profile.setRemoteId(credentials.serverHost);
                profile.setVpnType(VpnType.IKEV2_EAP);
                profile.setUsername(credentials.username);
                profile.setPassword(credentials.password);
                if (resolverStamp != null) {
                    profile.setDnsServers(SDNS_DNS_SERVERS);
                }

                CharonVpnService.startSafeNetProfile(
                        context, profile, resolverStamp, policy);
                if (call.getData().has("resolverStamp")) {
                    profileStore().saveResolverStamp(resolverStamp);
                }
                lastError = null;
                call.resolve(currentStatus(resolverStamp));
            } catch (Exception | LinkageError error) {
                lastError = "Windscribe IKEv2 could not connect. Check the generated credentials and internet connection.";
                call.reject(lastError);
            }
        });
    }

    private void stopLegacyVpnEngines(Context context) throws Exception {
        GoBackend wireGuard = new GoBackend(context);
        Tunnel legacyTunnel = new Tunnel() {
            @Override
            public String getName() {
                return LEGACY_WIREGUARD_TUNNEL_NAME;
            }

            @Override
            public void onStateChange(State state) {
                // The legacy plugin owns its own visible connection state.
            }
        };
        if (wireGuard.getState(legacyTunnel) == Tunnel.State.UP) {
            wireGuard.setState(legacyTunnel, Tunnel.State.DOWN, null);
        }

        SafeNetTailscaleApp.get(context).setWantRunning(false);
    }

    private void disconnectAndWait(VpnStateService service) throws InterruptedException {
        if (service.getState() == VpnStateService.State.DISABLED) {
            return;
        }
        service.disconnect();
        for (int attempt = 0; attempt < 100; attempt++) {
            if (service.getState() == VpnStateService.State.DISABLED) {
                return;
            }
            Thread.sleep(150);
        }
        throw new IllegalStateException("Windscribe IKEv2 did not disconnect in time.");
    }

    private void runStatus(PluginCall call, StatusWork work, String errorMessage) {
        EXECUTOR.execute(() -> {
            try {
                call.resolve(work.run());
            } catch (Exception error) {
                call.reject(errorMessage);
            }
        });
    }

    private JSObject currentStatus() throws Exception {
        return currentStatus(profileStore().readResolverStamp());
    }

    private JSObject currentStatus(String resolverStamp) throws Exception {
        boolean configured = credentialStore().hasCredentials();
        VpnStateService service = bindStateService(getContext());
        VpnStateService.State state = service.getState();
        boolean active = state == VpnStateService.State.CONNECTED;
        boolean transitioning = state == VpnStateService.State.CONNECTING
                || state == VpnStateService.State.DISCONNECTING;
        publishConnectionState(active);

        JSObject status = new JSObject();
        status.put("supported", isSupported());
        status.put("credentialsConfigured", configured);
        status.put("profileImported", configured);
        status.put("connected", active);
        status.put("connecting", transitioning);
        String appliedStamp = profileStore().readResolverStamp();
        boolean stampConfigured = appliedStamp != null && !appliedStamp.isEmpty();
        boolean selectedStampApplied = stampConfigured
                && resolverStamp != null
                && resolverStamp.equals(appliedStamp);
        String dnsError = null;
        if (active && resolverStamp != null && !selectedStampApplied) {
            dnsError = "Reconnect Windscribe IKEv2 to apply the selected SDNS resolver.";
        } else if (lastError != null) {
            dnsError = lastError;
        }
        status.put("resolverStampConfigured", stampConfigured);
        status.put("sdnsApplied", active && selectedStampApplied);
        status.put("sdnsError", resolverStamp != null ? dnsError : null);
        status.put("dnsError", dnsError);
        int errorText = service.getErrorText();
        status.put("error", lastError != null
                ? lastError
                : errorText == 0 ? null : getContext().getString(errorText));
        return status;
    }

    /**
     * An omitted option uses the stored resolver selection. Explicit null or
     * empty clears it for this operation.
     */
    private String resolverStampForCall(PluginCall call) {
        if (!call.getData().has("resolverStamp")) {
            return validateResolverStamp(profileStore().readResolverStamp());
        }
        String stamp = call.getString("resolverStamp");
        return stamp == null || stamp.isEmpty() ? null : validateResolverStamp(stamp);
    }

    private String validateResolverStamp(String stamp) {
        if (stamp == null || stamp.isEmpty()) {
            return null;
        }
        if (!SDNS_STAMP_PATTERN.matcher(stamp).matches()) {
            throw new IllegalArgumentException("Enter a valid bounded sdns:// stamp.");
        }
        return stamp;
    }

    private WindscribeIkeCredentialStore credentialStore() {
        return new WindscribeIkeCredentialStore(getContext());
    }

    private WindscribeProfileStore profileStore() {
        return new WindscribeProfileStore(getContext());
    }

    private static VpnStateService bindStateService(Context context) throws Exception {
        Context appContext = context.getApplicationContext();
        applicationContext = appContext;
        CompletableFuture<VpnStateService> ready;
        synchronized (STATE_SERVICE_LOCK) {
            if (stateService != null) {
                return stateService;
            }
            if (stateServiceReady == null) {
                stateServiceReady = new CompletableFuture<>();
            }
            ready = stateServiceReady;
            if (!stateServiceBound) {
                stateServiceBound = appContext.bindService(
                        new Intent(appContext, VpnStateService.class),
                        STATE_SERVICE_CONNECTION,
                        Context.BIND_AUTO_CREATE
                );
                if (!stateServiceBound) {
                    stateServiceReady = null;
                    ready.completeExceptionally(
                            new IllegalStateException("Could not bind to VPN status service."));
                }
            }
        }
        return ready.get(10, TimeUnit.SECONDS);
    }

    private static boolean isSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
    }

    private static void publishConnectionState(boolean isConnected) {
        connected = isConnected;
        Context context = applicationContext;
        if (context != null) {
            SafeNetWindscribeTileService.requestTileRefresh(context);
        }
    }

    private interface StatusWork {
        JSObject run() throws Exception;
    }
}