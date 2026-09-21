package com.safenet.dns;

import android.content.Context;
import android.content.SharedPreferences;
import android.telecom.Call;
import android.telecom.CallScreeningService;
import java.io.ByteArrayOutputStream;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.security.MessageDigest;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public class SafeNetCallScreeningService extends CallScreeningService {
    static final String PREFS_NAME = "safenet_call_screening";
    static final String PREF_API_ORIGIN = "api_origin";
    static final String PREF_AUTH_COOKIE = "auth_cookie";
    static final String PREF_BLOCKED_NUMBERS = "blocked_numbers";
    static final String PREF_ENABLED = "enabled";
    static final String PREF_CALLSHIELD_FEED_VERSION = "callshield_feed_version";
    static final String PREF_CALLSHIELD_FEED_HASH = "callshield_feed_hash";
    private static final String CALLSHIELD_FEED_ASSET = "callshield/spam_numbers.json";
    private static final String CALLSHIELD_MANIFEST_ASSET = "callshield/manifest.json";
    private static final ExecutorService LOOKUP_EXECUTOR = Executors.newCachedThreadPool();

    @Override
    public void onScreenCall(Call.Details details) {
        if (details == null) {
            respondAllow(details);
            return;
        }
        String number = details == null || details.getHandle() == null
            ? ""
            : details.getHandle().getSchemeSpecificPart();
        String normalized = normalizeNumber(number);
        if (normalized == null) {
            respondAllow(details);
            return;
        }

        SharedPreferences preferences = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!preferences.getBoolean(PREF_ENABLED, true)) {
            respondAllow(details);
            return;
        }
        if (readBlockedNumbers(preferences).contains(normalized)) {
            // An explicit user block is a local SafeNet blocklist decision and
            // does not depend on a network lookup.
            respond(details, "block");
            return;
        }
        String apiOrigin = preferences.getString(PREF_API_ORIGIN, "");
        if (apiOrigin == null || apiOrigin.trim().isEmpty()) {
            LOOKUP_EXECUTOR.execute(() -> {
                String action = decideAction(getApplicationContext(), preferences, normalized);
                respond(details, action);
            });
            return;
        }
        LOOKUP_EXECUTOR.execute(() -> {
            String action = decideAction(getApplicationContext(), preferences, normalized);
            respond(details, action);
        });
    }

    private void respondAllow(Call.Details details) {
        respond(details, "allow");
    }

    private void respond(Call.Details details, String action) {
        if (details == null) return;
        respondToCall(details, buildResponse(action));
    }

    static CallResponse buildResponse(String action) {
        CallResponse.Builder response = new CallResponse.Builder();
        if ("block".equals(action)) {
            response.setDisallowCall(true)
                .setRejectCall(true)
                .setSkipNotification(true);
        } else if ("silence".equals(action)) {
            // skipNotification is only valid for a disallowed call. A
            // silenced call remains visible to the user in the dialer.
            response.setSilenceCall(true);
        }
        return response.build();
    }

    static String decideAction(SharedPreferences preferences, String number) {
        return decideAction(null, preferences, number);
    }

    static String decideAction(
        Context context,
        SharedPreferences preferences,
        String number
    ) {
        if (number == null) {
            return "allow";
        }
        if (!preferences.getBoolean(PREF_ENABLED, true)) {
            return "allow";
        }
        if (readBlockedNumbers(preferences).contains(number)) {
            // An explicit user block is a local SafeNet blocklist decision and
            // does not depend on a network lookup.
            return "block";
        }

        String apiOrigin = preferences.getString(PREF_API_ORIGIN, "");
        if (apiOrigin == null || apiOrigin.trim().isEmpty()) {
            String offlineAction = offlineAction(context, preferences, number);
            return offlineAction == null ? "allow" : offlineAction;
        }

        String liveAction = lookupLive(
            apiOrigin,
            preferences.getString(PREF_AUTH_COOKIE, ""),
            number
        );
        if (liveAction != null) {
            return liveAction;
        }
        String offlineAction = offlineAction(context, preferences, number);
        return offlineAction == null ? "allow" : offlineAction;
    }

    static String lookup(String apiOrigin, String authCookie, String number) {
        String action = lookupLive(apiOrigin, authCookie, number);
        return action == null ? "allow" : action;
    }

    private static String lookupLive(String apiOrigin, String authCookie, String number) {
        HttpURLConnection connection = null;
        try {
            URI origin = URI.create(apiOrigin.trim());
            if (!"https".equalsIgnoreCase(origin.getScheme()) || origin.getHost() == null ||
                (origin.getRawPath() != null && !origin.getRawPath().isEmpty() &&
                    !"/".equals(origin.getRawPath())) ||
                origin.getRawQuery() != null || origin.getRawFragment() != null) {
                return null;
            }
            String encoded = URLEncoder.encode(number, StandardCharsets.UTF_8.name());
            URL endpoint = new URL(origin.toString().replaceAll("/+$", "")
                + "/api/spam-call-blocker/reputation?number=" + encoded);
            connection = (HttpURLConnection) endpoint.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(2200);
            connection.setReadTimeout(2200);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Origin", "https://localhost");
            if (authCookie != null && !authCookie.trim().isEmpty()) {
                connection.setRequestProperty("Cookie", authCookie);
            }
            if (connection.getResponseCode() / 100 != 2) return null;
            InputStream stream = connection.getInputStream();
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
            JSONObject result = new JSONObject(body.toString());
            if (!result.optBoolean("available", false)) return null;
            String action = result.optString("action", "allow").toLowerCase(Locale.US);
            return "block".equals(action) || "silence".equals(action) || "allow".equals(action)
                ? action
                : null;
        } catch (Exception ignored) {
            // Caller safety takes precedence: an unavailable live source falls
            // through to the verified offline snapshot, then to allow.
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static boolean hasBundledCallShieldFeed(Context context) {
        if (context == null) return false;
        SharedPreferences preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return loadBundledCallShieldFeed(context, preferences) != null;
    }

    private static String offlineAction(
        Context context,
        SharedPreferences preferences,
        String number
    ) {
        if (context == null) return null;
        OfflineFeed feed = loadBundledCallShieldFeed(context, preferences);
        if (feed == null) return null;

        String digits = phoneDigits(number);
        for (FeedNumber entry : feed.numbers) {
            if (phoneDigits(entry.number).equals(digits)) {
                return "block";
            }
        }
        for (FeedPrefix entry : feed.prefixes) {
            if (digits.startsWith(phoneDigits(entry.prefix))) {
                return "block";
            }
        }
        return "allow";
    }

    static OfflineFeed loadBundledCallShieldFeed(
        Context context,
        SharedPreferences preferences
    ) {
        if (context == null) return null;
        try (
            InputStream feedInput = context.getAssets().open(CALLSHIELD_FEED_ASSET);
            InputStream manifestInput = context.getAssets().open(CALLSHIELD_MANIFEST_ASSET)
        ) {
            byte[] feedBytes = readBytes(feedInput);
            JSONObject manifest = new JSONObject(
                new String(readBytes(manifestInput), StandardCharsets.UTF_8)
            );
            if (manifest.optInt("formatVersion", -1) != 1 ||
                !manifest.optBoolean("redistributable", false) ||
                manifest.optString("license", "").trim().isEmpty() ||
                manifest.optString("attribution", "").trim().isEmpty()) {
                return null;
            }

            int manifestVersion = manifest.optInt("feedVersion", -1);
            int acceptedVersion = preferences.getInt(PREF_CALLSHIELD_FEED_VERSION, -1);
            if (manifestVersion < acceptedVersion) return null;

            String manifestHash = manifest.optString("sha256", "").toLowerCase(Locale.US);
            if (!manifestHash.matches("[0-9a-f]{64}") ||
                !manifestHash.equals(sha256(feedBytes))) {
                return null;
            }
            String acceptedHash = preferences.getString(PREF_CALLSHIELD_FEED_HASH, "");
            if (manifestVersion == acceptedVersion &&
                !acceptedHash.isEmpty() &&
                !acceptedHash.equalsIgnoreCase(manifestHash)) {
                return null;
            }

            JSONObject feed = new JSONObject(new String(feedBytes, StandardCharsets.UTF_8));
            if (feed.optInt("version", -1) != manifestVersion ||
                !manifest.optString("updated", "").equals(feed.optString("updated", ""))) {
                return null;
            }
            JSONArray feedSources = feed.optJSONArray("sources");
            JSONArray includedSources = manifest.optJSONArray("includedSources");
            if (feedSources == null || includedSources == null || includedSources.length() == 0) {
                return null;
            }
            for (int index = 0; index < includedSources.length(); index++) {
                if (!containsValue(feedSources, includedSources.optString(index))) {
                    return null;
                }
            }
            for (int index = 0; index < feedSources.length(); index++) {
                if (!containsValue(includedSources, feedSources.optString(index))) {
                    return null;
                }
            }

            List<FeedNumber> numbers = new ArrayList<>();
            JSONArray numberRows = feed.optJSONArray("numbers");
            if (numberRows == null) return null;
            for (int index = 0; index < numberRows.length(); index++) {
                JSONObject row = numberRows.optJSONObject(index);
                if (row == null) return null;
                String normalized = normalizeNumber(row.optString("number", ""));
                JSONArray rowSources = row.optJSONArray("sources");
                if (normalized == null || rowSources == null ||
                    !containsValue(rowSources, "community")) {
                    return null;
                }
                numbers.add(new FeedNumber(normalized, row.optInt("reports", 0)));
            }

            List<FeedPrefix> prefixes = new ArrayList<>();
            JSONArray prefixRows = feed.optJSONArray("prefixes");
            if (prefixRows == null) return null;
            for (int index = 0; index < prefixRows.length(); index++) {
                JSONObject row = prefixRows.optJSONObject(index);
                if (row == null) return null;
                String normalized = normalizeNumber(row.optString("prefix", ""));
                if (normalized == null) return null;
                prefixes.add(new FeedPrefix(normalized));
            }

            if (manifestVersion > acceptedVersion ||
                !manifestHash.equalsIgnoreCase(acceptedHash)) {
                preferences.edit()
                    .putInt(PREF_CALLSHIELD_FEED_VERSION, manifestVersion)
                    .putString(PREF_CALLSHIELD_FEED_HASH, manifestHash)
                    .apply();
            }
            return new OfflineFeed(numbers, prefixes);
        } catch (Exception ignored) {
            // A missing, malformed, unapproved, or mutated snapshot must fail open.
            return null;
        }
    }

    private static byte[] readBytes(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int length;
        while ((length = input.read(buffer)) != -1) {
            output.write(buffer, 0, length);
        }
        return output.toByteArray();
    }

    private static String sha256(byte[] value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value);
        StringBuilder result = new StringBuilder(digest.length * 2);
        for (byte item : digest) {
            result.append(String.format(Locale.US, "%02x", item & 0xff));
        }
        return result.toString();
    }

    private static boolean containsValue(JSONArray values, String expected) {
        for (int index = 0; index < values.length(); index++) {
            if (expected.equals(values.optString(index))) return true;
        }
        return false;
    }

    private static String phoneDigits(String value) {
        return value.replaceAll("\\D", "");
    }

    static final class OfflineFeed {
        final List<FeedNumber> numbers;
        final List<FeedPrefix> prefixes;

        OfflineFeed(List<FeedNumber> numbers, List<FeedPrefix> prefixes) {
            this.numbers = numbers;
            this.prefixes = prefixes;
        }
    }

    private static final class FeedNumber {
        final String number;
        final int reports;

        FeedNumber(String number, int reports) {
            this.number = number;
            this.reports = reports;
        }
    }

    private static final class FeedPrefix {
        final String prefix;

        FeedPrefix(String prefix) {
            this.prefix = prefix;
        }
    }

    static String normalizeNumber(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return null;
        boolean hasPlus = trimmed.startsWith("+");
        String digits = trimmed.replaceAll("\\D", "");
        if (digits.length() < 7 || digits.length() > 15) return null;
        return (hasPlus ? "+" : "") + digits;
    }

    static Set<String> readBlockedNumbers(SharedPreferences preferences) {
        Set<String> values = preferences.getStringSet(PREF_BLOCKED_NUMBERS, null);
        Set<String> normalized = new HashSet<>();
        if (values != null) {
            for (String value : values) {
                String number = normalizeNumber(value);
                if (number != null) normalized.add(number);
            }
        }
        return normalized;
    }
}