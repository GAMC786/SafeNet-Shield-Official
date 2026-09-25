package com.safenet.dns;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.telephony.SmsManager;
import android.provider.Telephony;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class SafeNetSmsStore {
    private static final String SENT_RESULT_PREFIX = "sent_result_";
    private static final String NOTIFICATION_CHANNEL_ID = "safenet_sms";

    private SafeNetSmsStore() {}

    static Uri insertInbox(Context context, String sender, String body, long timestamp) {
        long threadId = Telephony.Threads.getOrCreateThreadId(context, sender);
        ContentValues values = new ContentValues();
        values.put(Telephony.Sms.ADDRESS, sender);
        values.put(Telephony.Sms.BODY, body);
        values.put(Telephony.Sms.DATE, timestamp);
        values.put(Telephony.Sms.DATE_SENT, 0L);
        values.put(Telephony.Sms.TYPE, Telephony.Sms.MESSAGE_TYPE_INBOX);
        values.put(Telephony.Sms.READ, 0);
        values.put(Telephony.Sms.SEEN, 0);
        values.put(Telephony.Sms.THREAD_ID, threadId);
        return context.getContentResolver().insert(Telephony.Sms.Inbox.CONTENT_URI, values);
    }

    static Uri sendText(Context context, String recipient, String body) {
        ArrayList<String> parts = SmsManager.getDefault().divideMessage(body);
        long timestamp = System.currentTimeMillis();
        long threadId = Telephony.Threads.getOrCreateThreadId(context, recipient);
        ContentValues values = new ContentValues();
        values.put(Telephony.Sms.ADDRESS, recipient);
        values.put(Telephony.Sms.BODY, body);
        values.put(Telephony.Sms.DATE, timestamp);
        values.put(Telephony.Sms.DATE_SENT, timestamp);
        values.put(Telephony.Sms.TYPE, Telephony.Sms.MESSAGE_TYPE_SENT);
        values.put(Telephony.Sms.STATUS, Telephony.Sms.STATUS_PENDING);
        values.put(Telephony.Sms.READ, 1);
        values.put(Telephony.Sms.SEEN, 1);
        values.put(Telephony.Sms.THREAD_ID, threadId);
        Uri sentUri = context.getContentResolver().insert(Telephony.Sms.Sent.CONTENT_URI, values);
        if (sentUri == null) throw new IllegalStateException("The SMS could not be saved to the sent folder.");

        try {
            ArrayList<PendingIntent> callbacks = new ArrayList<>();
            long messageId = ContentUris.parseId(sentUri);
            for (int index = 0; index < parts.size(); index++) {
                Intent callbackIntent = new Intent(context, SafeNetSmsSentReceiver.class)
                    .setAction(SafeNetSmsSentReceiver.ACTION_SMS_SENT)
                    .setData(Uri.parse("safenet-sms://sent/" + messageId + "/" + index))
                    .putExtra("messageId", messageId)
                    .putExtra("partIndex", index)
                    .putExtra("partCount", parts.size());
                int requestCode = (int) ((messageId * 31 + index) & 0x7fffffff);
                callbacks.add(PendingIntent.getBroadcast(
                    context,
                    requestCode,
                    callbackIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                ));
            }
            SmsManager smsManager = SmsManager.getDefault();
            if (parts.size() == 1) {
                smsManager.sendTextMessage(recipient, null, body, callbacks.get(0), null);
            } else {
                smsManager.sendMultipartTextMessage(recipient, null, parts, callbacks, null);
            }
            return sentUri;
        } catch (RuntimeException error) {
            context.getContentResolver().delete(sentUri, null, null);
            throw error;
        }
    }

    static void recordSentPart(Context context, long messageId, int partIndex, int partCount, boolean success) {
        synchronized (SafeNetSmsStore.class) {
            String key = SENT_RESULT_PREFIX + messageId;
            android.content.SharedPreferences preferences = context.getSharedPreferences(
                SafeNetSmsFilter.PREFS_NAME,
                Context.MODE_PRIVATE
            );
            JSONArray statuses;
            try {
                String stored = preferences.getString(key, "[]");
                statuses = new JSONArray(stored == null ? "[]" : stored);
            } catch (JSONException ignored) {
                statuses = new JSONArray();
            }
            while (statuses.length() < partCount) statuses.put(JSONObject.NULL);
            try {
                statuses.put(partIndex, success);
            } catch (JSONException ignored) {
                return;
            }
            int completed = 0;
            boolean anyFailure = false;
            for (int index = 0; index < statuses.length(); index++) {
                Object status = statuses.opt(index);
                if (status instanceof Boolean) {
                    completed++;
                    anyFailure |= !((Boolean) status);
                }
            }
            preferences.edit().putString(key, statuses.toString()).apply();
            if (completed < partCount) return;

            ContentValues update = new ContentValues();
            if (anyFailure) {
                update.put(Telephony.Sms.TYPE, Telephony.Sms.MESSAGE_TYPE_FAILED);
                update.put(Telephony.Sms.STATUS, Telephony.Sms.STATUS_FAILED);
            } else {
                update.put(Telephony.Sms.STATUS, Telephony.Sms.STATUS_COMPLETE);
            }
            Uri messageUri = ContentUris.withAppendedId(Telephony.Sms.CONTENT_URI, messageId);
            context.getContentResolver().update(messageUri, update, null, null);
            preferences.edit().remove(key).apply();
        }
    }

    static JSONArray readRecentInbox(Context context, int limit) throws JSONException {
        JSONArray messages = new JSONArray();
        try (Cursor cursor = context.getContentResolver().query(
            Telephony.Sms.Inbox.CONTENT_URI,
            new String[] {
                Telephony.Sms._ID,
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.DATE
            },
            null,
            null,
            Telephony.Sms.DATE + " DESC"
        )) {
            if (cursor == null) return messages;
            int count = 0;
            while (cursor.moveToNext() && count < limit) {
                messages.put(new JSONObject()
                    .put("id", cursor.getLong(0))
                    .put("sender", cursor.getString(1) == null ? "" : cursor.getString(1))
                    .put("body", cursor.getString(2) == null ? "" : cursor.getString(2))
                    .put("receivedAt", cursor.getLong(3)));
                count++;
            }
        }
        return messages;
    }

    static void notifyUser(Context context, String title, String message, int notificationId) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(new NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "SMS filtering",
                NotificationManager.IMPORTANCE_DEFAULT
            ));
        }
        Intent openApp = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            notificationId,
            openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        try {
            NotificationManagerCompat.from(context).notify(
                notificationId,
                new NotificationCompat.Builder(context, NOTIFICATION_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.sym_action_email)
                    .setContentTitle(title)
                    .setContentText(message)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                    .setContentIntent(contentIntent)
                    .setAutoCancel(true)
                    .build()
            );
        } catch (SecurityException ignored) {
            // Notifications are optional; SMS delivery and filtering stay local.
        }
    }
}