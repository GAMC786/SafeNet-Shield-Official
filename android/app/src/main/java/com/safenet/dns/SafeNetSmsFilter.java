package com.safenet.dns;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * On-device SMS rules adapted from the MIT-licensed Junkboy SMS Filter project.
 * This intentionally uses transparent rules; Junkboy's bundled TFLite model
 * is documented by its author as a placeholder, not a trained classifier.
 */
final class SafeNetSmsFilter {
    static final String PREFS_NAME = "safenet_sms_filter";
    static final String PREF_ENABLED = "filter_enabled";
    static final String PREF_KEYWORDS = "keywords";
    static final String PREF_REGEXES = "regexes";
    static final String PREF_ALLOWED_SENDERS = "allowed_senders";
    static final String PREF_QUARANTINE = "quarantined_messages";
    static final int MAX_QUARANTINED_MESSAGES = 100;

    private static final String[] BUILT_IN_JUNK_PHRASES = {
        "click to win",
        "you have won",
        "congratulations winner",
        "claim your prize",
        "free money",
        "cash prize",
        "tıklayınız",
        "tıkla ve kazan",
        "hediye kazan",
        "ödül kazan",
        "ücretsiz para",
        "kazandın"
    };

    private SafeNetSmsFilter() {}

    static final class Result {
        final boolean blocked;
        final String reason;

        Result(boolean blocked, String reason) {
            this.blocked = blocked;
            this.reason = reason;
        }
    }

    static Result classify(Context context, String sender, String body) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return classifyText(
            sender,
            body,
            preferences.getBoolean(PREF_ENABLED, false),
            readStringList(preferences, PREF_KEYWORDS),
            readStringList(preferences, PREF_REGEXES),
            readStringList(preferences, PREF_ALLOWED_SENDERS)
        );
    }

    static Result classifyText(
        String sender,
        String body,
        boolean enabled,
        List<String> keywords,
        List<String> regexes,
        List<String> allowedSenders
    ) {
        if (!enabled || body == null || body.isEmpty()) return new Result(false, "");

        String normalizedSender = normalizeSender(sender);
        for (String allowedSender : allowedSenders) {
            if (!normalizedSender.isEmpty() &&
                normalizedSender.equals(normalizeSender(allowedSender))) {
                return new Result(false, "");
            }
        }

        String normalizedBody = body.length() > 5000 ? body.substring(0, 5000) : body;
        String lowerBody = normalizedBody.toLowerCase(Locale.ROOT);
        for (String phrase : BUILT_IN_JUNK_PHRASES) {
            if (lowerBody.contains(phrase)) {
                return new Result(true, "Built-in spam phrase");
            }
        }

        for (String keyword : keywords) {
            if (keyword != null && !keyword.trim().isEmpty() &&
                lowerBody.contains(keyword.trim().toLowerCase(Locale.ROOT))) {
                return new Result(true, "Keyword rule");
            }
        }

        for (String expression : regexes) {
            if (!isSafeRegex(expression)) continue;
            try {
                if (Pattern.compile(expression, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE)
                    .matcher(normalizedBody)
                    .find()) {
                    return new Result(true, "Regular-expression rule");
                }
            } catch (RuntimeException ignored) {
                // A stale or invalid rule must not prevent an SMS from arriving.
            }
        }
        return new Result(false, "");
    }

    static boolean isSafeRegex(String expression) {
        if (expression == null || expression.trim().isEmpty() || expression.length() > 100) {
            return false;
        }
        if (Pattern.compile("[()|]").matcher(expression).find() ||
            Pattern.compile("\\\\[1-9]").matcher(expression).find()) {
            return false;
        }
        java.util.regex.Matcher quantifierMatcher = Pattern.compile("[+*?{]").matcher(expression);
        int quantifierCount = 0;
        while (quantifierMatcher.find()) {
            if (++quantifierCount > 1) return false;
        }
        try {
            Pattern.compile(expression, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
            return true;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    static String validateConfig(List<String> keywords, List<String> regexes, List<String> allowedSenders) {
        if (keywords.size() > 50 || regexes.size() > 20 || allowedSenders.size() > 50) {
            return "Use no more than 50 keywords, 20 patterns, and 50 allowed senders.";
        }
        for (String keyword : keywords) {
            if (keyword == null || keyword.trim().isEmpty() || keyword.length() > 80) {
                return "Keywords must contain 1 to 80 characters.";
            }
        }
        for (String expression : regexes) {
            if (!isSafeRegex(expression)) {
                return "Patterns must be under 100 characters, use no groups or alternation, and contain at most one repetition.";
            }
        }
        for (String sender : allowedSenders) {
            if (sender == null || sender.trim().isEmpty() || sender.length() > 80) {
                return "Allowed senders must contain 1 to 80 characters.";
            }
        }
        return null;
    }

    static List<String> parseConfigArray(JSONArray array, String label) throws JSONException {
        List<String> values = new ArrayList<>();
        if (array == null) return values;
        for (int index = 0; index < array.length(); index++) {
            Object value = array.get(index);
            if (!(value instanceof String)) {
                throw new JSONException(label + " entries must be text.");
            }
            String text = ((String) value).trim();
            if (!text.isEmpty() && !values.contains(text)) values.add(text);
        }
        return values;
    }

    static void saveConfig(
        Context context,
        List<String> keywords,
        List<String> regexes,
        List<String> allowedSenders
    ) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        preferences.edit()
            .putString(PREF_KEYWORDS, new JSONArray(keywords).toString())
            .putString(PREF_REGEXES, new JSONArray(regexes).toString())
            .putString(PREF_ALLOWED_SENDERS, new JSONArray(allowedSenders).toString())
            .apply();
    }

    static List<String> readStringList(SharedPreferences preferences, String key) {
        List<String> values = new ArrayList<>();
        String raw = preferences.getString(key, "[]");
        try {
            JSONArray array = new JSONArray(raw == null ? "[]" : raw);
            for (int index = 0; index < array.length(); index++) {
                String value = array.optString(index, "").trim();
                if (!value.isEmpty()) values.add(value);
            }
        } catch (JSONException ignored) {
            // Invalid saved rules are ignored so SMS delivery remains fail-open.
        }
        return values;
    }

    static String normalizeSender(String sender) {
        if (sender == null) return "";
        String trimmed = sender.trim().toLowerCase(Locale.ROOT);
        String digits = trimmed.replaceAll("[^0-9]", "");
        return digits.length() >= 7 ? digits : trimmed;
    }

    static JSONArray readQuarantine(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = preferences.getString(PREF_QUARANTINE, "[]");
        try {
            return new JSONArray(raw == null ? "[]" : raw);
        } catch (JSONException ignored) {
            return new JSONArray();
        }
    }

    static JSONObject findQuarantined(Context context, String id) {
        JSONArray messages = readQuarantine(context);
        for (int index = 0; index < messages.length(); index++) {
            JSONObject message = messages.optJSONObject(index);
            if (message != null && id.equals(message.optString("id"))) return message;
        }
        return null;
    }

    static void saveQuarantined(Context context, String sender, String body, long receivedAt, String reason) {
        JSONArray existing = readQuarantine(context);
        JSONArray updated = new JSONArray();
        try {
            updated.put(new JSONObject()
                .put("id", UUID.randomUUID().toString())
                .put("sender", sender == null ? "" : sender)
                .put("body", body == null ? "" : body)
                .put("receivedAt", receivedAt)
                .put("reason", reason == null ? "Filtered locally" : reason));
            for (int index = 0; index < existing.length() &&
                updated.length() < MAX_QUARANTINED_MESSAGES; index++) {
                JSONObject message = existing.optJSONObject(index);
                if (message != null) updated.put(message);
            }
        } catch (JSONException ignored) {
            return;
        }
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREF_QUARANTINE, updated.toString())
            .apply();
    }

    static boolean removeQuarantined(Context context, String id) {
        JSONArray existing = readQuarantine(context);
        JSONArray updated = new JSONArray();
        boolean removed = false;
        for (int index = 0; index < existing.length(); index++) {
            JSONObject message = existing.optJSONObject(index);
            if (message == null) continue;
            if (id.equals(message.optString("id"))) {
                removed = true;
            } else {
                updated.put(message);
            }
        }
        if (removed) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_QUARANTINE, updated.toString())
                .apply();
        }
        return removed;
    }

    static int quarantineCount(Context context) {
        return readQuarantine(context).length();
    }
}