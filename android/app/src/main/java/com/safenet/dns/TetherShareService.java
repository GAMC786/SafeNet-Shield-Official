package com.safenet.dns;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public final class TetherShareService extends Service {
    static final String ACTION_START = "com.safenet.dns.action.START_TETHER_SHARE";
    static final String ACTION_STOP = "com.safenet.dns.action.STOP_TETHER_SHARE";
    private static final String CHANNEL_ID = "safenet_internet_share";
    private static final int NOTIFICATION_ID = 6101;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (ACTION_STOP.equals(intent == null ? null : intent.getAction())) {
            TetherShareManager.get(this).stop();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        createChannel();
        startForeground(NOTIFICATION_ID, notification());
        TetherShareManager.get(this).start();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        TetherShareManager.get(this).stop();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification notification() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = launchIntent == null
            ? null
            : PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(com.safenet.dns.R.mipmap.ic_launcher)
            .setContentTitle("SafeNet Internet Share")
            .setContentText("Wi-Fi Direct network and proxy are running")
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL_ID,
                "Internet Share",
                NotificationManager.IMPORTANCE_LOW
            ));
        }
    }
}