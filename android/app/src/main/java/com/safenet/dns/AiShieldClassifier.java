package com.safenet.dns;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Small, offline, value-only classifier used by AI Shield.
 *
 * The engine intentionally retains only aggregate values. It never writes or
 * uploads a Bitmap. The bundled metadata is validated before a result can be
 * reported as available.
 */
public final class AiShieldClassifier {
    public static final String MODEL_VERSION = "safenet-nudity-engine-1.0.0";
    public static final String MODEL_ASSET = "ai_shield/model.json";
    public static final String STATE_SAFE = "safe";
    public static final String STATE_NUDITY_DETECTED = "nudity_detected";
    public static final String STATE_UNCERTAIN = "uncertain";
    public static final String STATE_PERMISSION_DENIED = "permission_denied";
    public static final String STATE_CAPTURE_UNAVAILABLE = "capture_unavailable";
    public static final String STATE_MODEL_UNAVAILABLE = "model_unavailable";

    private static final float SAFE_THRESHOLD = 0.18f;
    private static final float NUDITY_THRESHOLD = 0.64f;
    private static final int MAX_FRAME_DIMENSION = 256;

    private final boolean available;
    private final String unavailableReason;

    public AiShieldClassifier(Context context) {
        this(readMetadata(context));
    }

    AiShieldClassifier(String metadata) {
        boolean valid = false;
        String reason = "The bundled AI Shield engine metadata is invalid.";
        try {
            JSONObject model = new JSONObject(metadata);
            String version = model.optString("modelVersion", "");
            String license = model.optString("license", "");
            double safeThreshold = model.optDouble("safeThreshold", -1);
            double nudityThreshold = model.optDouble("nudityThreshold", -1);
            valid = MODEL_VERSION.equals(version)
                && !license.trim().isEmpty()
                && safeThreshold >= 0.0
                && safeThreshold < nudityThreshold
                && nudityThreshold <= 1.0
                && model.optInt("maxFrameDimension", 0) > 0;
            if (!valid) {
                reason = "The bundled AI Shield engine metadata failed validation.";
            }
        } catch (Exception error) {
            reason = "The bundled AI Shield engine could not be loaded.";
        }
        available = valid;
        unavailableReason = reason;
    }

    public boolean isAvailable() {
        return available;
    }

    public String getUnavailableReason() {
        return unavailableReason;
    }

    public Analysis analyze(Bitmap frame, String source) {
        long timestamp = System.currentTimeMillis();
        if (!available) {
            return Analysis.of(
                STATE_MODEL_UNAVAILABLE,
                source,
                null,
                MODEL_VERSION,
                timestamp,
                unavailableReason
            );
        }
        if (frame == null || frame.isRecycled() || frame.getWidth() <= 0 || frame.getHeight() <= 0) {
            return Analysis.of(
                STATE_CAPTURE_UNAVAILABLE,
                source,
                null,
                MODEL_VERSION,
                timestamp,
                "Android did not provide a usable frame."
            );
        }

        int width = frame.getWidth();
        int height = frame.getHeight();
        int stride = Math.max(1, Math.max(width, height) / MAX_FRAME_DIMENSION);
        long totalPixels = 0;
        long skinPixels = 0;
        long centerSkinPixels = 0;
        int centerLeft = width / 5;
        int centerRight = width - centerLeft;
        int centerTop = height / 8;
        int centerBottom = height - centerTop;

        for (int y = 0; y < height; y += stride) {
            for (int x = 0; x < width; x += stride) {
                int color = frame.getPixel(x, y);
                int red = Color.red(color);
                int green = Color.green(color);
                int blue = Color.blue(color);
                totalPixels++;
                if (looksLikeSkin(red, green, blue)) {
                    skinPixels++;
                    if (x >= centerLeft && x < centerRight && y >= centerTop && y < centerBottom) {
                        centerSkinPixels++;
                    }
                }
            }
        }

        if (totalPixels == 0) {
            return Analysis.of(
                STATE_CAPTURE_UNAVAILABLE,
                source,
                null,
                MODEL_VERSION,
                timestamp,
                "Android did not provide any pixels to classify."
            );
        }

        float skinRatio = (float) skinPixels / totalPixels;
        float centerRatio = (float) centerSkinPixels / Math.max(1, totalPixels * 0.6f);
        float score = clamp((skinRatio * 0.72f) + (Math.min(1.0f, centerRatio) * 0.28f));
        String state;
        float confidence;
        String message;

        if (score < SAFE_THRESHOLD) {
            state = STATE_SAFE;
            confidence = clamp(0.96f - score * 0.65f);
            message = "No high-confidence nudity signal was found in the available frame.";
        } else if (score >= NUDITY_THRESHOLD) {
            state = STATE_NUDITY_DETECTED;
            confidence = clamp(0.72f + ((score - NUDITY_THRESHOLD) * 0.75f));
            message = "High-confidence nudity signal detected in the available frame.";
        } else {
            state = STATE_UNCERTAIN;
            confidence = clamp(0.50f + Math.abs(score - 0.41f) * 0.25f);
            message = "The available frame is ambiguous; it was not treated as safe.";
        }

        return Analysis.of(state, source, confidence, MODEL_VERSION, timestamp, message);
    }

    public static Analysis permissionDenied(String source, String message) {
        return Analysis.of(
            STATE_PERMISSION_DENIED,
            source,
            null,
            MODEL_VERSION,
            System.currentTimeMillis(),
            message
        );
    }

    public static Analysis captureUnavailable(String source, String message) {
        return Analysis.of(
            STATE_CAPTURE_UNAVAILABLE,
            source,
            null,
            MODEL_VERSION,
            System.currentTimeMillis(),
            message
        );
    }

    public static Analysis modelUnavailable(String source, String message) {
        return Analysis.of(
            STATE_MODEL_UNAVAILABLE,
            source,
            null,
            MODEL_VERSION,
            System.currentTimeMillis(),
            message
        );
    }

    private static boolean looksLikeSkin(int red, int green, int blue) {
        int max = Math.max(red, Math.max(green, blue));
        int min = Math.min(red, Math.min(green, blue));
        return red > 45
            && green > 25
            && blue > 15
            && red > green * 1.05f
            && green > blue * 1.05f
            && max - min > 18
            && red - blue > 25;
    }

    private static float clamp(float value) {
        return Math.max(0.0f, Math.min(0.99f, value));
    }

    private static String readMetadata(Context context) {
        try (InputStream input = context.getAssets().open(MODEL_ASSET);
             BufferedReader reader = new BufferedReader(
                 new InputStreamReader(input, StandardCharsets.UTF_8)
             )) {
            StringBuilder content = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                content.append(line);
            }
            return content.toString();
        } catch (Exception error) {
            return "{\"modelVersion\":\"\",\"error\":\"asset_unavailable\"}";
        }
    }

    public static final class Analysis {
        public final String state;
        public final String source;
        public final Float confidence;
        public final String modelVersion;
        public final long timestamp;
        public final String message;

        private Analysis(
            String state,
            String source,
            Float confidence,
            String modelVersion,
            long timestamp,
            String message
        ) {
            this.state = state;
            this.source = source;
            this.confidence = confidence;
            this.modelVersion = modelVersion;
            this.timestamp = timestamp;
            this.message = message;
        }

        static Analysis of(
            String state,
            String source,
            Float confidence,
            String modelVersion,
            long timestamp,
            String message
        ) {
            return new Analysis(
                state,
                source == null ? "none" : source,
                confidence,
                modelVersion,
                timestamp,
                message
            );
        }

        public JSONObject toJson() {
            JSONObject result = new JSONObject();
            try {
                result.put("state", state);
                result.put("source", source);
                result.put("confidence", confidence == null ? JSONObject.NULL : confidence);
                result.put("modelVersion", modelVersion);
                result.put("timestamp", timestamp);
                result.put("message", message);
            } catch (Exception ignored) {
                // All values above are primitive and cannot fail in practice.
            }
            return result;
        }
    }
}