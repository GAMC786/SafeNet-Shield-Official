package com.safenet.dns;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageFormat;
import android.graphics.PixelFormat;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Surface;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;

import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

/**
 * Consent-gated Android capture sessions for the AI Shield classifier.
 *
 * Frames are decoded, analyzed, and immediately released. No frame is
 * persisted, copied to app storage, or sent over the network.
 */
public final class AiShieldManager {
    private static final String TAG = "AiShieldManager";

    public interface ResultListener {
        void onResult(AiShieldClassifier.Analysis analysis);
    }

    private static final long SAMPLE_INTERVAL_MS = 750L;
    private static final int CAMERA_WIDTH = 640;
    private static final int CAMERA_HEIGHT = 480;

    private final Context context;
    private final AiShieldClassifier classifier;
    private final ResultListener listener;
    private final Object lock = new Object();

    private HandlerThread captureThread;
    private Handler captureHandler;
    private CameraDevice camera;
    private CameraCaptureSession cameraSession;
    private ImageReader cameraReader;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader screenReader;
    private boolean monitoring;
    private String source = "none";
    private long lastAnalysisAt;
    private AiShieldClassifier.Analysis lastAnalysis;
    private long captureGeneration;
    private MediaProjection.Callback projectionCallback;

    public AiShieldManager(Context context, ResultListener listener) {
        this.context = context.getApplicationContext();
        this.classifier = new AiShieldClassifier(context);
        this.listener = listener;
        this.lastAnalysis = classifier.isMetadataAvailable()
            ? AiShieldClassifier.captureUnavailable("none", "AI Shield monitoring is idle.")
            : AiShieldClassifier.modelUnavailable("none", classifier.getUnavailableReason());
    }

    public boolean isModelAvailable() {
        synchronized (lock) {
            if (classifier.load(context)) {
                return true;
            }
            emitLocked(AiShieldClassifier.modelUnavailable("none", classifier.getUnavailableReason()));
            return false;
        }
    }

    public JSONObject getStatus() {
        synchronized (lock) {
            JSONObject result = lastAnalysis.toJson();
            try {
                result.put("monitoring", monitoring);
                result.put("privacy", "Frames are analyzed on-device and released immediately.");
                result.put(
                    "limitations",
                    "Only consented camera frames or MediaProjection-visible pixels are covered. "
                        + "Secure/DRM and revoked surfaces are unavailable."
                );
            } catch (Exception ignored) {
                // Primitive status fields are safe to omit only if JSON itself fails.
            }
            return result;
        }
    }

    public void startCamera() {
        synchronized (lock) {
            stopLocked(false);
            final long generation = captureGeneration;
            logCallback("start_requested", "camera", generation, true);
            if (!classifier.load(context)) {
                emitLocked(AiShieldClassifier.modelUnavailable("camera", classifier.getUnavailableReason()));
                return;
            }
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
                emitLocked(AiShieldClassifier.permissionDenied(
                    "camera",
                    "Camera permission is required before monitoring can start."
                ));
                return;
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
                emitLocked(AiShieldClassifier.captureUnavailable(
                    "camera",
                    "Camera monitoring requires Android 5.0 or newer."
                ));
                return;
            }

            source = "camera";
            monitoring = true;
            startCaptureThreadLocked();
            try {
                CameraManager manager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
                String cameraId = chooseCamera(manager);
                if (cameraId == null) {
                    throw new IllegalStateException("No camera is available on this device.");
                }
                cameraReader = ImageReader.newInstance(
                    CAMERA_WIDTH,
                    CAMERA_HEIGHT,
                    ImageFormat.JPEG,
                    2
                );
                cameraReader.setOnImageAvailableListener(
                    reader -> analyzeCameraImage(reader, generation),
                    captureHandler
                );
                manager.openCamera(cameraId, createCameraStateCallback(generation), captureHandler);
            } catch (Exception error) {
                emitLocked(AiShieldClassifier.captureUnavailable(
                    "camera",
                    "Camera monitoring could not start: " + safeMessage(error)
                ));
                stopLocked(false);
            }
        }
    }

    public void startScreen(int resultCode, Intent resultData) {
        synchronized (lock) {
            stopLocked(false);
            final long generation = captureGeneration;
            logCallback("projection_result_received", "screen", generation, true);
            if (!classifier.load(context)) {
                emitLocked(AiShieldClassifier.modelUnavailable("screen", classifier.getUnavailableReason()));
                return;
            }
            if (resultCode != Activity.RESULT_OK || resultData == null) {
                classifier.release();
                emitLocked(AiShieldClassifier.captureUnavailable(
                    "screen",
                    "Screen-capture consent was canceled; no screen pixels were analyzed."
                ));
                return;
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
                classifier.release();
                emitLocked(AiShieldClassifier.captureUnavailable(
                    "screen",
                    "Screen monitoring requires Android 5.0 or newer."
                ));
                return;
            }

            try {
                MediaProjectionManager manager =
                    (MediaProjectionManager) context.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
                mediaProjection = manager.getMediaProjection(resultCode, resultData);
                if (mediaProjection == null) {
                    throw new IllegalStateException("Android did not return a MediaProjection.");
                }
                source = "screen";
                monitoring = true;
                startCaptureThreadLocked();
                projectionCallback = createProjectionCallback(generation);
                mediaProjection.registerCallback(projectionCallback, captureHandler);

                DisplayMetrics metrics = context.getResources().getDisplayMetrics();
                int width = Math.max(1, Math.min(metrics.widthPixels, 720));
                int height = Math.max(1, Math.min(metrics.heightPixels, 1280));
                screenReader = ImageReader.newInstance(
                    width,
                    height,
                    PixelFormat.RGBA_8888,
                    2
                );
                screenReader.setOnImageAvailableListener(
                    reader -> analyzeScreenImage(reader, generation),
                    captureHandler
                );
                virtualDisplay = mediaProjection.createVirtualDisplay(
                    "SafeNet AI Shield",
                    width,
                    height,
                    metrics.densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    screenReader.getSurface(),
                    null,
                    captureHandler
                );
                if (virtualDisplay == null) {
                    throw new IllegalStateException("Android could not create a screen capture surface.");
                }
                emitLocked(AiShieldClassifier.captureUnavailable(
                    "screen",
                    "Screen monitoring is active; waiting for the first available frame."
                ));
            } catch (Exception error) {
                emitLocked(AiShieldClassifier.captureUnavailable(
                    "screen",
                    "Screen monitoring is unavailable: " + safeMessage(error)
                ));
                stopLocked(false);
            }
        }
    }

    /**
     * End the current source before Android opens the MediaProjection consent
     * surface. The user may cancel that surface, so the replacement must not
     * leave the previous capture alive while its result is pending.
     */
    public void prepareForScreenConsent() {
        synchronized (lock) {
            stopLocked(true);
        }
    }

    public void stop() {
        synchronized (lock) {
            stopLocked(true);
        }
    }

    public void handlePause() {
        synchronized (lock) {
            stopLocked(true);
        }
    }

    public void handleDestroy() {
        synchronized (lock) {
            stopLocked(false);
        }
    }

    public AiShieldClassifier.Analysis permissionDenied(String source, String message) {
        synchronized (lock) {
            classifier.release();
            AiShieldClassifier.Analysis analysis = AiShieldClassifier.permissionDenied(source, message);
            monitoring = false;
            this.source = source;
            emitLocked(analysis);
            return analysis;
        }
    }

    private void analyzeCameraImage(ImageReader reader, long generation) {
        Image image = null;
        Bitmap bitmap = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) {
                return;
            }
            synchronized (lock) {
                if (!isCaptureActiveLocked(generation, "camera") || !canAnalyzeNowLocked()) {
                    return;
                }
            }
            ByteBuffer buffer = image.getPlanes()[0].getBuffer();
            byte[] bytes = new byte[buffer.remaining()];
            buffer.get(bytes);
            bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            analyzeAndEmit(bitmap, "camera", generation);
        } catch (Exception error) {
            synchronized (lock) {
                if (isCaptureActiveLocked(generation, "camera")) {
                    emitLocked(AiShieldClassifier.captureUnavailable(
                        "camera",
                        "A camera frame could not be analyzed: " + safeMessage(error)
                    ));
                }
            }
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) {
                bitmap.recycle();
            }
            if (image != null) {
                image.close();
            }
        }
    }

    private void analyzeScreenImage(ImageReader reader, long generation) {
        Image image = null;
        Bitmap fullBitmap = null;
        Bitmap bitmap = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) {
                return;
            }
            synchronized (lock) {
                if (!isCaptureActiveLocked(generation, "screen") || !canAnalyzeNowLocked()) {
                    return;
                }
            }
            Image.Plane plane = image.getPlanes()[0];
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int rowPadding = rowStride - pixelStride * image.getWidth();
            int paddedWidth = image.getWidth() + Math.max(0, rowPadding / Math.max(1, pixelStride));
            fullBitmap = Bitmap.createBitmap(
                paddedWidth,
                image.getHeight(),
                Bitmap.Config.ARGB_8888
            );
            ByteBuffer buffer = plane.getBuffer();
            buffer.rewind();
            fullBitmap.copyPixelsFromBuffer(buffer);
            bitmap = Bitmap.createBitmap(
                fullBitmap,
                0,
                0,
                image.getWidth(),
                image.getHeight()
            );
            analyzeAndEmit(bitmap, "screen", generation);
        } catch (Exception error) {
            synchronized (lock) {
                if (isCaptureActiveLocked(generation, "screen")) {
                    emitLocked(AiShieldClassifier.captureUnavailable(
                        "screen",
                        "The screen surface is unavailable: " + safeMessage(error)
                    ));
                }
            }
        } finally {
            if (bitmap != null && bitmap != fullBitmap && !bitmap.isRecycled()) {
                bitmap.recycle();
            }
            if (fullBitmap != null && !fullBitmap.isRecycled()) {
                fullBitmap.recycle();
            }
            if (image != null) {
                image.close();
            }
        }
    }

    private void analyzeAndEmit(Bitmap bitmap, String frameSource, long generation) {
        AiShieldClassifier.Analysis analysis = classifier.analyze(bitmap, frameSource);
        synchronized (lock) {
            if (isCaptureActiveLocked(generation, frameSource)) {
                emitLocked(analysis);
            }
        }
    }

    private boolean canAnalyzeNowLocked() {
        long now = System.currentTimeMillis();
        if (now - lastAnalysisAt < SAMPLE_INTERVAL_MS) {
            return false;
        }
        lastAnalysisAt = now;
        return true;
    }

    private void startCaptureThreadLocked() {
        captureThread = new HandlerThread("safenet-ai-shield-capture");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());
    }

    private String chooseCamera(CameraManager manager) throws Exception {
        String fallback = null;
        for (String id : manager.getCameraIdList()) {
            CameraCharacteristics characteristics = manager.getCameraCharacteristics(id);
            Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                return id;
            }
            if (fallback == null) {
                fallback = id;
            }
        }
        return fallback;
    }

    private CameraDevice.StateCallback createCameraStateCallback(final long generation) {
        return new CameraDevice.StateCallback() {
            @Override
            public void onOpened(CameraDevice openedCamera) {
                synchronized (lock) {
                    boolean active = isCaptureActiveLocked(generation, "camera") && cameraReader != null;
                    logCallback("camera_opened", "camera", generation, active);
                    if (!active) {
                        logCallback("stale_camera_opened_ignored", "camera", generation, false);
                        if (camera != openedCamera) {
                            openedCamera.close();
                        }
                        return;
                    }
                    camera = openedCamera;
                    try {
                        openedCamera.createCaptureSession(
                            java.util.Collections.singletonList(cameraReader.getSurface()),
                            new CameraCaptureSession.StateCallback() {
                                @Override
                                public void onConfigured(CameraCaptureSession session) {
                                    synchronized (lock) {
                                        boolean active = isCaptureActiveLocked(generation, "camera")
                                            && camera == openedCamera;
                                        logCallback("camera_configured", "camera", generation, active);
                                        if (!active) {
                                            logCallback(
                                                "stale_camera_configured_ignored",
                                                "camera",
                                                generation,
                                                false
                                            );
                                            if (cameraSession != session) {
                                                session.close();
                                            }
                                            return;
                                        }
                                        cameraSession = session;
                                        try {
                                            CaptureRequest.Builder request =
                                                openedCamera.createCaptureRequest(
                                                    CameraDevice.TEMPLATE_PREVIEW
                                                );
                                            request.addTarget(cameraReader.getSurface());
                                            request.set(
                                                CaptureRequest.CONTROL_AF_MODE,
                                                CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
                                            );
                                            session.setRepeatingRequest(
                                                request.build(),
                                                null,
                                                captureHandler
                                            );
                                        } catch (Exception error) {
                                            emitLocked(AiShieldClassifier.captureUnavailable(
                                                "camera",
                                                "Camera preview could not start: "
                                                    + safeMessage(error)
                                            ));
                                        }
                                    }
                                }

                                @Override
                                public void onConfigureFailed(CameraCaptureSession session) {
                                    synchronized (lock) {
                                        if (isCaptureActiveLocked(generation, "camera")) {
                                            emitCameraUnavailableAfterStopLocked(
                                                "Android could not configure the camera capture surface."
                                            );
                                        } else if (cameraSession != session) {
                                            session.close();
                                        }
                                    }
                                }
                            },
                            captureHandler
                        );
                    } catch (Exception error) {
                        if (isCaptureActiveLocked(generation, "camera")) {
                            emitCameraUnavailableAfterStopLocked(
                                "Camera capture could not be configured: " + safeMessage(error)
                            );
                        } else if (camera != openedCamera) {
                            openedCamera.close();
                        }
                    }
                }
            }

            @Override
            public void onDisconnected(CameraDevice disconnectedCamera) {
                synchronized (lock) {
                    boolean active = isCaptureActiveLocked(generation, "camera");
                    logCallback("camera_disconnected", "camera", generation, active);
                    if (!active) {
                        logCallback("stale_camera_disconnected_ignored", "camera", generation, false);
                        if (camera != disconnectedCamera) {
                            disconnectedCamera.close();
                        }
                        return;
                    }
                    disconnectedCamera.close();
                    stopLocked(false);
                    source = "camera";
                    emitLocked(AiShieldClassifier.captureUnavailable(
                        "camera",
                        "The camera became unavailable."
                    ));
                }
            }

            @Override
            public void onError(CameraDevice erroredCamera, int error) {
                synchronized (lock) {
                    boolean active = isCaptureActiveLocked(generation, "camera");
                    logCallback("camera_error", "camera", generation, active);
                    if (!active) {
                        logCallback("stale_camera_error_ignored", "camera", generation, false);
                        if (camera != erroredCamera) {
                            erroredCamera.close();
                        }
                        return;
                    }
                    erroredCamera.close();
                    stopLocked(false);
                    source = "camera";
                    emitLocked(AiShieldClassifier.captureUnavailable(
                        "camera",
                        "Android reported a camera capture error."
                    ));
                }
            }
        };
    }

    private MediaProjection.Callback createProjectionCallback(final long generation) {
        return new MediaProjection.Callback() {
            @Override
            public void onStop() {
                synchronized (lock) {
                    boolean active = isCaptureActiveLocked(generation, "screen");
                    logCallback("projection_stopped", "screen", generation, active);
                    if (!active) {
                        logCallback("stale_projection_stop_ignored", "screen", generation, false);
                        return;
                    }
                    closeScreenLocked(false);
                    monitoring = false;
                    source = "screen";
                    lastAnalysisAt = 0L;
                    classifier.release();
                    emitLocked(AiShieldClassifier.captureUnavailable(
                        "screen",
                        "Screen-capture consent was revoked or the projection stopped."
                    ));
                }
            }
        };
    }

    private boolean isCaptureActiveLocked(long generation, String expectedSource) {
        return generation == captureGeneration && monitoring && expectedSource.equals(source);
    }

    private void stopLocked(boolean emitIdle) {
        captureGeneration++;
        logCallback("capture_stopped", source, captureGeneration, false);
        closeCameraLocked();
        closeScreenLocked(true);
        monitoring = false;
        source = "none";
        lastAnalysisAt = 0L;
        classifier.release();
        if (emitIdle) {
            emitLocked(
                classifier.isMetadataAvailable()
                    ? AiShieldClassifier.captureUnavailable("none", "AI Shield monitoring is idle.")
                    : AiShieldClassifier.modelUnavailable("none", classifier.getUnavailableReason())
            );
        }
    }

    private void emitCameraUnavailableAfterStopLocked(String message) {
        stopLocked(false);
        source = "camera";
        emitLocked(AiShieldClassifier.captureUnavailable("camera", message));
    }

    private void closeCameraLocked() {
        if (cameraSession != null) {
            try {
                cameraSession.close();
            } catch (Exception ignored) {
            }
            cameraSession = null;
        }
        if (camera != null) {
            try {
                camera.close();
            } catch (Exception ignored) {
            }
            camera = null;
        }
        if (cameraReader != null) {
            cameraReader.close();
            cameraReader = null;
        }
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
            captureHandler = null;
        }
    }

    private void closeScreenLocked(boolean stopProjection) {
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (screenReader != null) {
            screenReader.close();
            screenReader = null;
        }
        MediaProjection projection = mediaProjection;
        MediaProjection.Callback callback = projectionCallback;
        mediaProjection = null;
        projectionCallback = null;
        if (projection != null) {
            try {
                if (callback != null) {
                    projection.unregisterCallback(callback);
                }
                if (stopProjection) {
                    projection.stop();
                }
            } catch (Exception ignored) {
            }
        }
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
            captureHandler = null;
        }
    }

    private void emitLocked(AiShieldClassifier.Analysis analysis) {
        lastAnalysis = analysis;
        if (listener != null) {
            listener.onResult(analysis);
        }
    }

    private void logCallback(String event, String callbackSource, long generation, boolean active) {
        Log.i(
            TAG,
            "AI_SHIELD_CALLBACK event=" + event
                + " source=" + callbackSource
                + " generation=" + generation
                + " active=" + active
        );
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty()
            ? error.getClass().getSimpleName()
            : message;
    }
}