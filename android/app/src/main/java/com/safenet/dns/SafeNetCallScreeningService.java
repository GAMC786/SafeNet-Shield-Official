package com.safenet.dns;

import android.content.Context;
import android.content.SharedPreferences;
import android.telecom.Call;
import android.telecom.CallScreeningService;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public class SafeNetCallScreeningService extends CallScreeningService {
    static final String PREFS_NAME = "safenet_call_screening";
    static final String PREF_API_ORIGIN = "api_origin";
    static final String PREF_AUTH_COOKIE = "auth_cookie";
    static final String PREF_BLOCKED_NUMBERS = "blocked_numbers";
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
        if (readBlockedNumbers(preferences).contains(normalized)) {
            // An explicit user block is a local SafeNet blocklist decision and
            // does not depend on a network lookup.
            respond(details, "block");
            return;
        }
        String apiOrigin = preferences.getString(PREF_API_ORIGIN, "");
        if (apiOrigin == null || apiOrigin.trim().isEmpty()) {
            respondAllow(details);
            return;
        }
        LOOKUP_EXECUTOR.execute(() -> {
            String action = decideAction(preferences, normalized);
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
        if (number == null) {
            return "allow";
        }
        if (readBlockedNumbers(preferences).contains(number)) {
            // An explicit user block is a local SafeNet blocklist decision and
            // does not depend on a network lookup.
            return "block";
        }

        String apiOrigin = preferences.getString(PREF_API_ORIGIN, "");
        if (apiOrigin == null || apiOrigin.trim().isEmpty()) {
            return "allow";
        }
        return lookup(apiOrigin, preferences.getString(PREF_AUTH_COOKIE, ""), number);
    }

    static String lookup(String apiOrigin, String authCookie, String number) {
        HttpURLConnection connection = null;
        try {
            URI origin = URI.create(apiOrigin.trim());
            if (!"https".equalsIgnoreCase(origin.getScheme()) || origin.getHost() == null ||
                (origin.getRawPath() != null && !origin.getRawPath().isEmpty() &&
                    !"/".equals(origin.getRawPath())) ||
                origin.getRawQuery() != null || origin.getRawFragment() != null) {
                return "allow";
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
            if (connection.getResponseCode() / 100 != 2) return "allow";
            InputStream stream = connection.getInputStream();
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
            }
            JSONObject result = new JSONObject(body.toString());
            if (!result.optBoolean("available", false)) return "allow";
            String action = result.optString("action", "allow").toLowerCase(Locale.US);
            return "block".equals(action) || "silence".equals(action) ? action : "allow";
        } catch (Exception ignored) {
            // Caller safety takes precedence: unavailable reputation means allow.
            return "allow";
        } finally {
            if (connection != null) connection.disconnect();
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