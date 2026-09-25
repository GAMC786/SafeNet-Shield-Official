package com.safenet.dns;

import android.app.Service;
import android.content.Intent;
import android.net.Uri;
import android.os.IBinder;

public final class SafeNetSmsRespondViaMessageService extends Service {
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Uri recipientUri = intent == null ? null : intent.getData();
        String body = intent == null ? null : intent.getStringExtra(Intent.EXTRA_TEXT);
        if (body == null && intent != null) body = intent.getStringExtra("sms_body");
        if (recipientUri != null && body != null && !body.trim().isEmpty()) {
            Intent compose = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_SENDTO)
                .setData(Uri.parse(recipientUri.toString()))
                .putExtra("sms_body", body)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(compose);
        }
        stopSelf(startId);
        return START_NOT_STICKY;
    }
}