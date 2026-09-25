package com.safenet.dns;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.util.Log;

/**
 * The SMS filter does not inspect or download MMS media. Keep this receiver
 * explicit so the default-handler limitation can be surfaced to the user.
 */
public final class SafeNetMmsDeliveryReceiver extends BroadcastReceiver {
    private static final String TAG = "SafeNetSms";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.WAP_PUSH_DELIVER_ACTION.equals(intent.getAction())) return;
        Log.w(TAG, "Received an MMS notification; MMS filtering and media download are not supported.");
        SafeNetSmsStore.notifyUser(
            context,
            "MMS not processed by SafeNet",
            "SafeNet filters SMS only. Change your default messaging app to receive MMS normally.",
            0x534d4d53
        );
    }
}