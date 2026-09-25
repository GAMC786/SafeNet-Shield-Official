package com.safenet.dns;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class SafeNetSmsSentReceiver extends BroadcastReceiver {
    static final String ACTION_SMS_SENT = "com.safenet.dns.SMS_SENT";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_SMS_SENT.equals(intent.getAction())) return;
        long messageId = intent.getLongExtra("messageId", -1L);
        int partIndex = intent.getIntExtra("partIndex", -1);
        int partCount = intent.getIntExtra("partCount", 0);
        if (messageId < 0 || partIndex < 0 || partCount < 1) return;
        SafeNetSmsStore.recordSentPart(
            context,
            messageId,
            partIndex,
            partCount,
            getResultCode() == Activity.RESULT_OK
        );
    }
}