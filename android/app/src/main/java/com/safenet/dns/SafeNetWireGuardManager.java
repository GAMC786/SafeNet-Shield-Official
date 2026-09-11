package com.safenet.dns;

import android.content.Context;
import android.net.VpnService;

import com.wireguard.android.backend.Backend;
import com.wireguard.android.backend.GoBackend;
import com.wireguard.android.backend.Tunnel;
import com.wireguard.config.Config;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Owns the single configured SafeNet WireGuard tunnel.
 *
 * GoBackend is the official WireGuard Android lifecycle implementation. It
 * creates and tears down its own VpnService and therefore must never be
 * started while SafeNetVpnService is active.
 */
final class SafeNetWireGuardManager {
    static final String TUNNEL_NAME = "safenet-wg";

    private static volatile SafeNetWireGuardManager instance;
    private static volatile String lastError;

    private final Context context;
    private final Backend backend;
    private final Tunnel tunnel = new Tunnel() {
        @Override
        public String getName() {
            return TUNNEL_NAME;
        }

        @Override
        public void onStateChange(State newState) {
            // GoBackend reports state transitions here; status is read from
            // the backend so a stale callback cannot claim the tunnel is up.
        }
    };

    private SafeNetWireGuardManager(Context context) {
        this.context = context.getApplicationContext();
        this.backend = new GoBackend(this.context);
    }

    static SafeNetWireGuardManager get(Context context) {
        SafeNetWireGuardManager current = instance;
        if (current == null) {
            synchronized (SafeNetWireGuardManager.class) {
                current = instance;
                if (current == null) {
                    current = new SafeNetWireGuardManager(context);
                    instance = current;
                }
            }
        }
        return current;
    }

    boolean isRunning() {
        try {
            return backend.getState(tunnel) == Tunnel.State.UP;
        } catch (Exception ignored) {
            return false;
        }
    }

    void start(String selectedDnsServers) throws Exception {
        try {
            if (SafeNetVpnService.isRunning()) {
                throw new IllegalStateException(
                    "SafeNet DNS protection already owns Android's VPN permission. Stop it before starting WireGuard."
                );
            }
            if (VpnService.prepare(context) != null) {
                throw new IllegalStateException(
                    "Android VPN permission belongs to another app. Grant SafeNet permission before starting WireGuard."
                );
            }
            Config config = SafeNetWireGuardConfig.load(selectedDnsServers);
            backend.setState(tunnel, Tunnel.State.UP, config);
            lastError = null;
        } catch (Exception error) {
            lastError = error.getMessage();
            throw error;
        }
    }

    void stop() throws Exception {
        try {
            backend.setState(tunnel, Tunnel.State.DOWN, null);
            lastError = null;
        } catch (Exception error) {
            lastError = error.getMessage();
            throw error;
        }
    }

    String getLastError() {
        return lastError;
    }

    void startAsync(
        final String selectedDnsServers,
        final Runnable onSuccess,
        final java.util.function.Consumer<Exception> onFailure
    ) {
        EXECUTOR.execute(() -> {
            try {
                start(selectedDnsServers);
                onSuccess.run();
            } catch (Exception error) {
                onFailure.accept(error);
            }
        });
    }

    void stopAsync(final Runnable onSuccess, final java.util.function.Consumer<Exception> onFailure) {
        EXECUTOR.execute(() -> {
            try {
                stop();
                onSuccess.run();
            } catch (Exception error) {
                onFailure.accept(error);
            }
        });
    }

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
}