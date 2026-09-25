package com.safenet.dns;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;

public final class SafeNetSmsDeliveryReceiver extends BroadcastReceiver {
    private static final String TAG = "SafeNetSms";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_DELIVER_ACTION.equals(intent.getAction())) return;
        if (!context.getPackageName().equals(Telephony.Sms.getDefaultSmsPackage(context))) {
            Log.w(TAG, "Ignoring SMS delivery because SafeNet is not the default SMS app");
            return;
        }
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;

        SmsMessage firstPart = null;
        StringBuilder body = new StringBuilder();
        for (SmsMessage part : parts) {
            if (part == null) continue;
            if (firstPart == null) firstPart = part;
            if (part.getMessageBody() != null) body.append(part.getMessageBody());
        }
        if (firstPart == null) return;

        String sender = firstPart.getOriginatingAddress();
        if (sender == null || sender.trim().isEmpty()) sender = "Unknown sender";
        long timestamp = firstPart.getTimestampMillis();
        SafeNetSmsFilter.Result result = SafeNetSmsFilter.classify(context, sender, body.toString());
        if (result.blocked) {
            SafeNetSmsFilter.saveQuarantined(context, sender, body.toString(), timestamp, result.reason);
            SafeNetSmsStore.notifyUser(
                context,
                "Potential spam SMS quarantined",
                "A message from " + sender + " was kept on this device for review.",
                (int) (timestamp & 0x7fffffff)
            );
            return;
        }

        try {
            Uri inserted = SafeNetSmsStore.insertInbox(context, sender, body.toString(), timestamp);
            if (inserted == null) throw new IllegalStateException("Android did not save the incoming SMS.");
            SafeNetSmsStore.notifyUser(
                context,
                "New SMS",
                "Message received from " + sender,
                (int) (timestamp & 0x7fffffff)
            );
        } catch (RuntimeException error) {
            Log.e(TAG, "Could not save incoming SMS to the Android inbox", error);
            SafeNetSmsFilter.saveQuarantined(
                context,
                sender,
                body.toString(),
                timestamp,
                "Could not add this message to the Android inbox"
            );
            SafeNetSmsStore.notifyUser(
                context,
                "SMS needs review",
                "SafeNet could not save a message from " + sender + " to the Android inbox.",
                (int) ((timestamp + 1) & 0x7fffffff)
            );
        }
    }
}