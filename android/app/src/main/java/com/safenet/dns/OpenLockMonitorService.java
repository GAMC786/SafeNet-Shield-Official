package com.safenet.dns;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * OpenLock-style foreground monitor.
 *
 * OpenLock uses Usage Access plus an overlay instead of an Accessibility
 * service. This native monitor follows the same boundary while keeping
 * SafeNet's existing local PIN and recovery storage.
 */
public final class OpenLockMonitorService extends Service {
    private static final String CHANNEL_ID = "safenet_openlock_monitor";
    private static final int NOTIFICATION_ID = 4711;
    private static final long POLL_INTERVAL_MS = 300L;
    private static final long LOOKBACK_MS = 10_000L;
    private static final long RELAUNCH_GUARD_MS = 1_500L;
    private static final long TEMPORARY_UNLOCK_MS = 15_000L;

    private static volatile String temporarilyUnlockedPackage = "";
    private static volatile long temporarilyUnlockedUntil;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private UsageStatsManager usageStatsManager;
    private String lastForegroundPackage;
    private String lastLaunchedPackage;
    private long lastLaunchAt;
    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                temporarilyUnlockedUntil = 0L;
                AppLockManager.clearSession();
            }
        }
    };

    private final Runnable poller = new Runnable() {
        @Override
        public void run() {
            try {
                tick();
            } catch (RuntimeException ignored) {
                // A transient Usage Access failure must not kill protection.
            }
            handler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    public static boolean isUnlockTemporarilyAllowed(String packageName) {
        return packageName != null
                && packageName.equals(temporarilyUnlockedPackage)
                && System.currentTimeMillis() < temporarilyUnlockedUntil;
    }

    public static void allowTemporaryUnlock(String packageName) {
        temporarilyUnlockedPackage = packageName == null ? "" : packageName;
        temporarilyUnlockedUntil = System.currentTimeMillis() + TEMPORARY_UNLOCK_MS;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        usageStatsManager = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF),
                    Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(screenReceiver, new IntentFilter(Intent.ACTION_SCREEN_OFF));
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, buildNotification());
        handler.removeCallbacks(poller);
        handler.post(poller);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(poller);
        try {
            unregisterReceiver(screenReceiver);
        } catch (IllegalArgumentException ignored) {
            // The receiver may not have completed registration.
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void tick() {
        String current = foregroundPackage();
        if (current == null || current.equals(getPackageName())) {
            return;
        }

        if (current.equals(lastForegroundPackage)) {
            // Keep the OpenLock-style debounce stable while the same app stays
            // in the foreground.
        }
        lastForegroundPackage = current;
        if (!AppLockManager.shouldLockPackage(this, current)) {
            return;
        }

        long now = System.currentTimeMillis();
        if (current.equals(lastLaunchedPackage)
                && now - lastLaunchAt < RELAUNCH_GUARD_MS) {
            return;
        }
        lastLaunchedPackage = current;
        lastLaunchAt = now;

        Intent lockIntent = new Intent(this, LockLockActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_NO_ANIMATION
                        | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
                .putExtra(AppLockManager.EXTRA_LOCKED_PACKAGE, current);
        try {
            startActivity(lockIntent);
        } catch (RuntimeException ignored) {
            // The next poll retries after Android allows background launches.
        }
    }

    private String foregroundPackage() {
        if (usageStatsManager == null) {
            return null;
        }
        long end = System.currentTimeMillis();
        UsageEvents events = usageStatsManager.queryEvents(end - LOOKBACK_MS, end);
        if (events == null) {
            return null;
        }
        String packageName = null;
        UsageEvents.Event event = new UsageEvents.Event();
        while (events.hasNextEvent()) {
            events.getNextEvent(event);
            if (event.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                packageName = event.getPackageName();
            }
        }
        return packageName;
    }

    private Notification buildNotification() {
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "App lock protection",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shown while OpenLock protects selected apps.");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }

        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = launchIntent == null
                ? null
                : PendingIntent.getActivity(
                        this,
                        0,
                        launchIntent,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                );
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        builder.setContentTitle("OpenLock is protecting your apps")
                .setContentText("Locked apps stay behind your SafeNet passcode.")
                .setSmallIcon(android.R.drawable.ic_lock_lock)
                .setOngoing(true);
        if (pendingIntent != null) {
            builder.setContentIntent(pendingIntent);
        }
        return builder.build();
    }
}