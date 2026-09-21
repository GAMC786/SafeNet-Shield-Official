package com.safenet.dns;

import android.content.Context;
import android.net.wifi.p2p.WifiP2pConfig;
import android.net.wifi.p2p.WifiP2pDevice;
import android.net.wifi.p2p.WifiP2pGroup;
import android.net.wifi.p2p.WifiP2pManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import java.io.IOException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Owns the Wi-Fi Direct group and the explicit proxy used by Internet Share.
 *
 * <p>Internet Share does not depend on SafeNet Private DNS and is not a
 * general packet router for devices connected to a Wi-Fi Direct group.</p>
 */
final class TetherShareManager {
    static final int PROXY_PORT = TetherShareProxy.HTTP_PORT;
    static final int SOCKS_PROXY_PORT = TetherShareProxy.SOCKS_PORT;
    static final String PROXY_HOST = TetherShareProxy.PROXY_HOST;

    static final class DeviceSnapshot {
        final String name;
        final String address;

        DeviceSnapshot(String name, String address) {
            this.name = name;
            this.address = address;
        }
    }

    static final class Snapshot {
        final boolean running;
        final boolean starting;
        final String networkName;
        final String passphrase;
        final String credentialSource;
        final String proxyHost;
        final int proxyPort;
        final int httpProxyPort;
        final int socksProxyPort;
        final boolean groupOwner;
        final String lastError;
        final List<DeviceSnapshot> devices;

        Snapshot(
            boolean running,
            boolean starting,
            String networkName,
            String passphrase,
            String credentialSource,
            String proxyHost,
            int proxyPort,
            int httpProxyPort,
            int socksProxyPort,
            boolean groupOwner,
            String lastError,
            List<DeviceSnapshot> devices
        ) {
            this.running = running;
            this.starting = starting;
            this.networkName = networkName;
            this.passphrase = passphrase;
            this.credentialSource = credentialSource;
            this.proxyHost = proxyHost;
            this.proxyPort = proxyPort;
            this.httpProxyPort = httpProxyPort;
            this.socksProxyPort = socksProxyPort;
            this.groupOwner = groupOwner;
            this.lastError = lastError;
            this.devices = devices;
        }
    }

    private static TetherShareManager instance;
    private static final String CREDENTIAL_SOURCE_APP_DEFINED = "APP_DEFINED";
    private static final String CREDENTIAL_SOURCE_ANDROID_API = "ANDROID_API";
    private static final String CREDENTIAL_SOURCE_ANDROID_SETTINGS = "ANDROID_SETTINGS";
    private static final char[] CREDENTIAL_ALPHABET =
        "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789".toCharArray();
    private static final int MAX_BUSY_RETRIES = 3;
    private static final long BUSY_RETRY_DELAY_MS = 500L;
    private static final long GROUP_INFO_RETRY_DELAY_MS = 400L;
    private static final long STATUS_REFRESH_DELAY_MS = 1_500L;

    static synchronized TetherShareManager get(Context context) {
        if (instance == null) {
            instance = new TetherShareManager(context.getApplicationContext());
        }
        return instance;
    }

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final TetherShareProxy proxy;
    private WifiP2pManager wifiP2pManager;
    private WifiP2pManager.Channel wifiChannel;
    private volatile boolean running;
    private volatile boolean starting;
    private volatile int lifecycleGeneration;
    private volatile String networkName;
    private volatile String passphrase;
    private volatile String appDefinedNetworkName;
    private volatile String credentialSource;
    private volatile boolean groupOwner;
    private volatile String lastError;
    private volatile List<DeviceSnapshot> devices = Collections.emptyList();

    private TetherShareManager(Context context) {
        this.context = context;
        this.proxy = new TetherShareProxy(context, message -> lastError = message);
    }

    synchronized void start() {
        if (running || starting) {
            return;
        }
        final int generation = ++lifecycleGeneration;
        clearConnectionState();
        lastError = null;
        starting = true;
        try {
            wifiP2pManager = (WifiP2pManager) context.getSystemService(Context.WIFI_P2P_SERVICE);
            if (wifiP2pManager == null) {
                fail("Wi-Fi Direct is not available on this device.");
                return;
            }
            wifiChannel = wifiP2pManager.initialize(context, context.getMainLooper(), null);
            if (wifiChannel == null) {
                fail("Android could not initialize Wi-Fi Direct.");
                return;
            }
            prepareGroup(generation, 0);
        } catch (SecurityException error) {
            fail("Nearby Wi-Fi permission is required to create the sharing network.");
        } catch (RuntimeException error) {
            fail("Android could not start the SafeNet sharing network.");
        }
    }

    synchronized void stop() {
        ++lifecycleGeneration;
        starting = false;
        running = false;
        proxy.stop();
        clearConnectionState();
        cleanupWifiGroup(wifiP2pManager, wifiChannel);
        wifiChannel = null;
    }

    Snapshot snapshot() {
        return new Snapshot(
            running,
            starting,
            networkName,
            passphrase,
            credentialSource,
            PROXY_HOST,
            PROXY_PORT,
            TetherShareProxy.HTTP_PORT,
            TetherShareProxy.SOCKS_PORT,
            groupOwner,
            lastError,
            new ArrayList<>(devices)
        );
    }

    private void prepareGroup(int generation, int attempt) {
        if (!isCurrent(generation)) {
            return;
        }
        WifiP2pManager manager = wifiP2pManager;
        WifiP2pManager.Channel channel = wifiChannel;
        if (manager == null || channel == null) {
            fail("Android could not initialize Wi-Fi Direct.");
            return;
        }
        try {
            // Remove a stale group first. Android can retain a group created
            // by an earlier app process, and createGroup then reports BUSY.
            manager.removeGroup(channel, new WifiP2pManager.ActionListener() {
                @Override
                public void onSuccess() {
                    scheduleCreateGroup(generation, attempt);
                }

                @Override
                public void onFailure(int reason) {
                    if (reason == WifiP2pManager.BUSY && attempt < MAX_BUSY_RETRIES) {
                        schedulePrepareGroup(generation, attempt + 1);
                    } else {
                        scheduleCreateGroup(generation, attempt);
                    }
                }
            });
        } catch (RuntimeException error) {
            scheduleCreateGroup(generation, attempt);
        }
    }

    private void schedulePrepareGroup(int generation, int attempt) {
        mainHandler.postDelayed(() -> prepareGroup(generation, attempt), retryDelay(attempt));
    }

    private void scheduleCreateGroup(int generation, int attempt) {
        mainHandler.postDelayed(() -> createGroup(generation, attempt), retryDelay(attempt));
    }

    private long retryDelay(int attempt) {
        return BUSY_RETRY_DELAY_MS << Math.min(attempt, 2);
    }

    private void createGroup(int generation, int attempt) {
        if (!isCurrent(generation)) {
            return;
        }
        WifiP2pManager manager = wifiP2pManager;
        WifiP2pManager.Channel channel = wifiChannel;
        if (manager == null || channel == null) {
            fail("Android could not initialize Wi-Fi Direct.");
            return;
        }

        WifiP2pManager.ActionListener listener = new WifiP2pManager.ActionListener() {
            @Override
            public void onSuccess() {
                mainHandler.postDelayed(() -> refreshGroupInfo(generation, 0), GROUP_INFO_RETRY_DELAY_MS);
            }

            @Override
            public void onFailure(int reason) {
                if (reason == WifiP2pManager.BUSY && attempt < MAX_BUSY_RETRIES) {
                    schedulePrepareGroup(generation, attempt + 1);
                } else {
                    fail(wifiFailureMessage(reason));
                }
            }
        };

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                String requestedNetworkName = createNetworkName();
                String requestedPassphrase = createPassphrase();
                WifiP2pConfig config = new WifiP2pConfig.Builder()
                    .setNetworkName(requestedNetworkName)
                    .setPassphrase(requestedPassphrase)
                    .build();
                networkName = requestedNetworkName;
                passphrase = requestedPassphrase;
                appDefinedNetworkName = requestedNetworkName;
                credentialSource = CREDENTIAL_SOURCE_APP_DEFINED;
                manager.createGroup(channel, config, listener);
            } else {
                manager.createGroup(channel, listener);
            }
        } catch (SecurityException error) {
            fail("Nearby Wi-Fi permission is required to create the sharing network.");
        } catch (RuntimeException error) {
            if (attempt < MAX_BUSY_RETRIES) {
                schedulePrepareGroup(generation, attempt + 1);
            } else {
                fail("Android could not start the SafeNet sharing network.");
            }
        }
    }

    private void refreshGroupInfo(int generation, int attempt) {
        if (!isCurrent(generation)) {
            return;
        }
        try {
            wifiP2pManager.requestGroupInfo(wifiChannel, group -> {
                if (!isCurrent(generation)) {
                    return;
                }
                if (group == null) {
                    if (attempt < 8) {
                        mainHandler.postDelayed(
                            () -> refreshGroupInfo(generation, attempt + 1),
                            GROUP_INFO_RETRY_DELAY_MS
                        );
                    } else {
                        fail("Android created the Wi-Fi Direct group but did not return its connection details.");
                    }
                    return;
                }

                updateGroupSnapshot(group);
                try {
                    proxy.start();
                    synchronized (this) {
                        if (!isCurrent(generation)) {
                            proxy.stop();
                            return;
                        }
                        starting = false;
                        running = true;
                        lastError = null;
                    }
                } catch (IOException error) {
                    fail("SafeNet could not open the HTTP/SOCKS proxy ports " +
                        TetherShareProxy.HTTP_PORT + " and " + TetherShareProxy.SOCKS_PORT + ".");
                    return;
                }
                mainHandler.postDelayed(
                    () -> refreshGroupInfo(generation, 0),
                    STATUS_REFRESH_DELAY_MS
                );
            });
        } catch (SecurityException error) {
            fail("Nearby Wi-Fi permission is required to read the sharing network.");
        } catch (RuntimeException error) {
            fail("Android could not read the SafeNet sharing network.");
        }
    }

    private synchronized void updateGroupSnapshot(WifiP2pGroup group) {
        groupOwner = group.isGroupOwner();
        networkName = group.getNetworkName();
        String androidPassphrase =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? group.getPassphrase() : null;
        if (androidPassphrase != null && !androidPassphrase.trim().isEmpty()) {
            passphrase = androidPassphrase;
            credentialSource = CREDENTIAL_SOURCE_ANDROID_API;
        } else if (!CREDENTIAL_SOURCE_APP_DEFINED.equals(credentialSource) ||
            networkName == null || !networkName.equals(appDefinedNetworkName)) {
            passphrase = null;
            credentialSource = CREDENTIAL_SOURCE_ANDROID_SETTINGS;
        }

        List<DeviceSnapshot> nextDevices = new ArrayList<>();
        for (WifiP2pDevice device : group.getClientList()) {
            nextDevices.add(new DeviceSnapshot(device.deviceName, device.deviceAddress));
        }
        devices = nextDevices;
    }

    private boolean isCurrent(int generation) {
        return lifecycleGeneration == generation && (starting || running);
    }

    private synchronized void cleanupWifiGroup(
        WifiP2pManager manager,
        WifiP2pManager.Channel channel
    ) {
        if (manager == null || channel == null) {
            closeChannel(channel);
            return;
        }
        removeGroupWithRetry(manager, channel, 0);
    }

    private void removeGroupWithRetry(
        WifiP2pManager manager,
        WifiP2pManager.Channel channel,
        int attempt
    ) {
        try {
            manager.removeGroup(channel, new WifiP2pManager.ActionListener() {
                @Override
                public void onSuccess() {
                    closeChannel(channel);
                }

                @Override
                public void onFailure(int reason) {
                    if (reason == WifiP2pManager.BUSY && attempt < MAX_BUSY_RETRIES) {
                        mainHandler.postDelayed(
                            () -> removeGroupWithRetry(manager, channel, attempt + 1),
                            retryDelay(attempt)
                        );
                    } else {
                        closeChannel(channel);
                    }
                }
            });
        } catch (RuntimeException ignored) {
            closeChannel(channel);
        }
    }

    private void closeChannel(WifiP2pManager.Channel channel) {
        if (channel != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            try {
                channel.close();
            } catch (RuntimeException ignored) {
                // Android owns the final cleanup if channel close is unavailable.
            }
        }
    }

    private synchronized void clearConnectionState() {
        devices = Collections.emptyList();
        networkName = null;
        passphrase = null;
        appDefinedNetworkName = null;
        credentialSource = null;
        groupOwner = false;
    }

    synchronized void fail(String message) {
        ++lifecycleGeneration;
        starting = false;
        running = false;
        proxy.stop();
        clearConnectionState();
        lastError = message;
        cleanupWifiGroup(wifiP2pManager, wifiChannel);
        wifiChannel = null;
    }

    private String wifiFailureMessage(int reason) {
        switch (reason) {
            case WifiP2pManager.BUSY:
                return "Android Wi-Fi Direct is busy. Turn Wi-Fi on and try again.";
            case WifiP2pManager.ERROR:
                return "Android reported a Wi-Fi Direct error.";
            case WifiP2pManager.P2P_UNSUPPORTED:
                return "This device does not support Wi-Fi Direct.";
            default:
                return "Android could not create the SafeNet sharing network.";
        }
    }

    private String createNetworkName() {
        return "DIRECT-SN" + randomCredentialCharacters(6);
    }

    private String createPassphrase() {
        return randomCredentialCharacters(16);
    }

    private String randomCredentialCharacters(int length) {
        SecureRandom random = new SecureRandom();
        StringBuilder value = new StringBuilder(length);
        for (int index = 0; index < length; index++) {
            value.append(CREDENTIAL_ALPHABET[random.nextInt(CREDENTIAL_ALPHABET.length)]);
        }
        return value.toString();
    }
}