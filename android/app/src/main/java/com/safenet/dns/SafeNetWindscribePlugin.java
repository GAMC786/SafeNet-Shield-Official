package com.safenet.dns;

import android.app.Activity;
import android.content.Intent;
import android.net.VpnService;
import android.net.Uri;
import android.os.Build;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.wireguard.android.backend.GoBackend;
import com.wireguard.android.backend.Tunnel;
import com.wireguard.config.Config;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "SafeNetWindscribe")
public final class SafeNetWindscribePlugin extends Plugin {
    private static final int MAX_PROFILE_BYTES = 64 * 1024;
    private static final String TUNNEL_NAME = "windscribe";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "safenet-windscribe-vpn");
        thread.setDaemon(true);
        return thread;
    });
    private static volatile boolean connected;
    private static volatile android.content.Context applicationContext;

    private volatile GoBackend backend;
    private volatile WindscribeProfileStore profileStore;
    private final Tunnel tunnel = new Tunnel() {
        @Override
        public String getName() {
            return TUNNEL_NAME;
        }

        @Override
        public void onStateChange(State state) {
            publishConnectionState(state == State.UP);
        }
    };

    static boolean isConnected() {
        return connected;
    }

    private static void publishConnectionState(boolean isConnected) {
        connected = isConnected;
        android.content.Context context = applicationContext;
        if (context != null) {
            SafeNetWindscribeTileService.requestTileRefresh(context);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        runStatus(call, this::currentStatus, "Windscribe VPN status is unavailable.");
    }

    @PluginMethod
    public void importProfile(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("Windscribe VPN requires Android 8.0 or later.");
            return;
        }
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        picker.addCategory(Intent.CATEGORY_OPENABLE);
        picker.setType("*/*");
        picker.putExtra(Intent.EXTRA_MIME_TYPES,
                new String[]{"text/plain", "application/octet-stream"});
        startActivityForResult(call, picker, "wireGuardProfileSelected");
    }

    @ActivityCallback
    private void wireGuardProfileSelected(PluginCall call, ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null || result.getData().getData() == null) {
            runStatus(call, this::currentStatus, "Windscribe VPN status is unavailable.");
            return;
        }
        Uri selectedFile = result.getData().getData();
        EXECUTOR.execute(() -> {
            try {
                String profileText = readProfile(selectedFile);
                WindscribeProfileStore.parseProfile(profileText);
                if (getBackend().getState(tunnel) == Tunnel.State.UP) {
                    getBackend().setState(tunnel, Tunnel.State.DOWN, null);
                }
                profileStore().saveProfile(profileText);
                publishConnectionState(false);
                call.resolve(currentStatus());
            } catch (Exception e) {
                call.reject("Choose a valid Windscribe WireGuard configuration file.");
            }
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("Windscribe VPN requires Android 8.0 or later.");
            return;
        }
        try {
            if (!profileStore().hasProfile()) {
                call.reject("Import a Windscribe WireGuard profile first.");
                return;
            }
            Intent consentIntent = VpnService.prepare(getActivity());
            if (consentIntent != null) {
                startActivityForResult(call, consentIntent, "vpnConsentResult");
                return;
            }
            connectWithProfile(call);
        } catch (Exception e) {
            call.reject("The encrypted Windscribe profile could not be opened.");
        }
    }

    @ActivityCallback
    private void vpnConsentResult(PluginCall call, ActivityResult result) {
        if (result == null || result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Android VPN permission was not granted.");
            return;
        }
        connectWithProfile(call);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        EXECUTOR.execute(() -> {
            try {
                GoBackend activeBackend = backend;
                if (activeBackend != null
                        && activeBackend.getState(tunnel) == Tunnel.State.UP) {
                    activeBackend.setState(tunnel, Tunnel.State.DOWN, null);
                }
                publishConnectionState(false);
                call.resolve(currentStatus());
            } catch (Exception e) {
                call.reject("Windscribe VPN could not disconnect.");
            }
        });
    }

    @PluginMethod
    public void removeProfile(PluginCall call) {
        EXECUTOR.execute(() -> {
            try {
                GoBackend activeBackend = backend;
                if (activeBackend != null
                        && activeBackend.getState(tunnel) == Tunnel.State.UP) {
                    activeBackend.setState(tunnel, Tunnel.State.DOWN, null);
                }
                profileStore().clearProfile();
                publishConnectionState(false);
                call.resolve(currentStatus());
            } catch (Exception e) {
                call.reject("Windscribe profile could not be removed.");
            }
        });
    }

    private void connectWithProfile(PluginCall call) {
        EXECUTOR.execute(() -> {
            try {
                String profileText = profileStore().readProfile();
                Config config = WindscribeProfileStore.parseProfile(profileText);
                getBackend().setState(tunnel, Tunnel.State.UP, config);
                call.resolve(currentStatus());
            } catch (Exception e) {
                call.reject("Windscribe could not connect. Check the profile and internet connection.");
            }
        });
    }

    private void runStatus(PluginCall call, StatusWork work, String errorMessage) {
        EXECUTOR.execute(() -> {
            try {
                call.resolve(work.run());
            } catch (Exception e) {
                call.reject(errorMessage);
            }
        });
    }

    private JSObject currentStatus() throws Exception {
        WindscribeProfileStore store = profileStore();
        boolean imported = store.hasProfile();
        boolean active = false;
        if (imported && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            active = getBackend().getState(tunnel) == Tunnel.State.UP;
        }
        publishConnectionState(active);
        JSObject status = new JSObject();
        status.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O);
        status.put("profileImported", imported);
        status.put("connected", active);
        return status;
    }

    private GoBackend getBackend() {
        applicationContext = getContext().getApplicationContext();
        GoBackend activeBackend = backend;
        if (activeBackend == null) {
            synchronized (this) {
                activeBackend = backend;
                if (activeBackend == null) {
                    activeBackend = new GoBackend(applicationContext);
                    backend = activeBackend;
                }
            }
        }
        return activeBackend;
    }

    private WindscribeProfileStore profileStore() {
        WindscribeProfileStore activeStore = profileStore;
        if (activeStore == null) {
            synchronized (this) {
                activeStore = profileStore;
                if (activeStore == null) {
                    activeStore = new WindscribeProfileStore(getContext());
                    profileStore = activeStore;
                }
            }
        }
        return activeStore;
    }

    private String readProfile(Uri uri) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) {
                throw new IllegalArgumentException("The selected file could not be read.");
            }
            byte[] buffer = new byte[4096];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_PROFILE_BYTES) {
                    throw new IllegalArgumentException("The selected profile is too large.");
                }
                output.write(buffer, 0, read);
            }
            String text = output.toString(StandardCharsets.UTF_8.name());
            return text.startsWith("\uFEFF") ? text.substring(1) : text;
        }
    }

    private interface StatusWork {
        JSObject run() throws Exception;
    }
}