package com.safenet.dns;

import android.content.Context;
import android.graphics.Bitmap;

import org.json.JSONObject;
import org.tensorflow.lite.DataType;
import org.tensorflow.lite.Interpreter;
import org.tensorflow.lite.Tensor;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.channels.FileChannel;

/**
 * Offline TensorFlow Lite classifier used by AI Shield.
 *
 * The classifier intentionally retains only aggregate values. It never writes
 * or uploads a Bitmap. The interpreter is created lazily after a capture
 * toggle is enabled and is released when monitoring stops.
 */
public final class AiShieldClassifier {
    public static final String MODEL_VERSION = "safenet-nudity-tflite-1.0.0";
    public static final String MODEL_ASSET = "ai_shield/model.json";
    public static final String MODEL_BINARY_ASSET = "ai_shield/safenet-nudity-v1.tflite";
    public static final String STATE_SAFE = "safe";
    public static final String STATE_NUDITY_DETECTED = "nudity_detected";
    public static final String STATE_UNCERTAIN = "uncertain";
    public static final String STATE_PERMISSION_DENIED = "permission_denied";
    public static final String STATE_CAPTURE_UNAVAILABLE = "capture_unavailable";
    public static final String STATE_MODEL_UNAVAILABLE = "model_unavailable";

    private static final float SAFE_THRESHOLD = 0.18f;
    private static final float NUDITY_THRESHOLD = 0.64f;

    private final boolean metadataAvailable;
    private final String metadataUnavailableReason;
    private String loadFailureReason;
    private volatile Interpreter interpreter;
    private int inputWidth;
    private int inputHeight;
    private DataType inputType;
    private DataType outputType;
    private int outputElements;

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
            String modelFile = model.optString("modelFile", "");
            String engine = model.optString("engine", "");
            double safeThreshold = model.optDouble("safeThreshold", -1);
            double nudityThreshold = model.optDouble("nudityThreshold", -1);
            valid = MODEL_VERSION.equals(version)
                && !license.trim().isEmpty()
                && MODEL_BINARY_ASSET.equals(modelFile)
                && "tensorflow-lite-image-classification".equals(engine)
                && safeThreshold >= 0.0
                && safeThreshold < nudityThreshold
                && nudityThreshold <= 1.0
                && model.optInt("inputWidth", 0) > 0
                && model.optInt("inputHeight", 0) > 0
                && model.optJSONArray("labels") != null
                && model.optJSONArray("labels").length() >= 2
                && "nude".equals(model.optJSONArray("labels").optString(1));
            if (!valid) {
                reason = "The bundled AI Shield engine metadata failed validation.";
            }
        } catch (Exception error) {
            reason = "The bundled AI Shield engine could not be loaded.";
        }
        metadataAvailable = valid;
        metadataUnavailableReason = reason;
    }

    /**
     * Loads and validates the bundled interpreter. Merely opening Settings
     * does not map the model into memory.
     */
    public synchronized boolean load(Context context) {
        if (!metadataAvailable) {
            return false;
        }
        if (interpreter != null) {
            return true;
        }
        try {
            Interpreter candidate = new Interpreter(loadModelFile(context), new Interpreter.Options());
            Tensor input = candidate.getInputTensor(0);
            Tensor output = candidate.getOutputTensor(0);
            int[] inputShape = input.shape();
            int[] outputShape = output.shape();
            if (candidate.getInputTensorCount() != 1
                || candidate.getOutputTensorCount() != 1
                || inputShape.length != 4
                || inputShape[0] != 1
                || inputShape[3] != 3
                || (input.dataType() != DataType.FLOAT32 && input.dataType() != DataType.UINT8)
                || outputShape.length < 2
                || output.numElements() < 2
                || (output.dataType() != DataType.FLOAT32 && output.dataType() != DataType.UINT8)) {
                candidate.close();
                loadFailureReason = "The bundled AI Shield model has an unsupported tensor contract.";
                return false;
            }
            inputWidth = inputShape[2];
            inputHeight = inputShape[1];
            inputType = input.dataType();
            outputType = output.dataType();
            outputElements = output.numElements();
            interpreter = candidate;
            loadFailureReason = null;
            return true;
        } catch (Exception error) {
            loadFailureReason = "The bundled AI Shield model could not be loaded: " + safeMessage(error);
            return false;
        }
    }

    public synchronized boolean isAvailable() {
        return metadataAvailable && interpreter != null;
    }

    public boolean isMetadataAvailable() {
        return metadataAvailable;
    }

    public synchronized String getUnavailableReason() {
        if (!metadataAvailable) {
            return metadataUnavailableReason;
        }
        return loadFailureReason == null
            ? "The AI Shield model has not been loaded."
            : loadFailureReason;
    }

    public synchronized void release() {
        if (interpreter != null) {
            interpreter.close();
            interpreter = null;
        }
    }

    public Analysis analyze(Bitmap frame, String source) {
        long timestamp = System.currentTimeMillis();
        if (!metadataAvailable || interpreter == null) {
            return Analysis.of(
                STATE_MODEL_UNAVAILABLE,
                source,
                null,
                MODEL_VERSION,
                timestamp,
                getUnavailableReason()
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

        Bitmap scaled = null;
        try {
            scaled = Bitmap.createScaledBitmap(frame, inputWidth, inputHeight, true);
            ByteBuffer input = ByteBuffer.allocateDirect(
                inputWidth * inputHeight * 3 * (inputType == DataType.FLOAT32 ? 4 : 1)
            ).order(ByteOrder.nativeOrder());
            int[] pixels = new int[inputWidth * inputHeight];
            scaled.getPixels(pixels, 0, inputWidth, 0, 0, inputWidth, inputHeight);
            for (int pixel : pixels) {
                int red = (pixel >> 16) & 0xff;
                int green = (pixel >> 8) & 0xff;
                int blue = pixel & 0xff;
                if (inputType == DataType.FLOAT32) {
                    input.putFloat(red / 255.0f);
                    input.putFloat(green / 255.0f);
                    input.putFloat(blue / 255.0f);
                } else {
                    input.put((byte) red);
                    input.put((byte) green);
                    input.put((byte) blue);
                }
            }
            input.rewind();

            ByteBuffer output = ByteBuffer.allocateDirect(
                outputElements * (outputType == DataType.FLOAT32 ? 4 : 1)
            ).order(ByteOrder.nativeOrder());
            synchronized (this) {
                if (interpreter == null) {
                    return modelUnavailable(source, "The AI Shield model was released before inference completed.");
                }
                interpreter.run(input, output);
            }
            output.rewind();
            float[] scores = new float[outputElements];
            for (int index = 0; index < outputElements; index++) {
                scores[index] = outputType == DataType.FLOAT32
                    ? output.getFloat()
                    : (output.get() & 0xff) / 255.0f;
            }
            float nudityScore = clamp(scores[1]);
            String state;
            float confidence;
            String message;
            if (nudityScore < SAFE_THRESHOLD) {
                state = STATE_SAFE;
                confidence = clamp(1.0f - nudityScore);
                message = "The validated on-device model found no high-confidence nudity signal.";
            } else if (nudityScore >= NUDITY_THRESHOLD) {
                state = STATE_NUDITY_DETECTED;
                confidence = nudityScore;
                message = "The validated on-device model detected a high-confidence nudity signal.";
            } else {
                state = STATE_UNCERTAIN;
                confidence = clamp(Math.max(nudityScore, 1.0f - nudityScore));
                message = "The validated on-device model returned an ambiguous result; it was not treated as safe.";
            }
            return Analysis.of(state, source, confidence, MODEL_VERSION, timestamp, message);
        } catch (Exception error) {
            return modelUnavailable(
                source,
                "The bundled AI Shield model could not analyze this frame: " + safeMessage(error)
            );
        } finally {
            if (scaled != null && scaled != frame && !scaled.isRecycled()) {
                scaled.recycle();
            }
        }
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

    private static float clamp(float value) {
        return Math.max(0.0f, Math.min(0.99f, value));
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty()
            ? error.getClass().getSimpleName()
            : message;
    }

    private static MappedByteBuffer loadModelFile(Context context) throws Exception {
        try (android.content.res.AssetFileDescriptor descriptor =
                 context.getAssets().openFd(MODEL_BINARY_ASSET);
             FileInputStream input = new FileInputStream(descriptor.getFileDescriptor())) {
            FileChannel channel = input.getChannel();
            return channel.map(
                FileChannel.MapMode.READ_ONLY,
                descriptor.getStartOffset(),
                descriptor.getDeclaredLength()
            );
        }
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