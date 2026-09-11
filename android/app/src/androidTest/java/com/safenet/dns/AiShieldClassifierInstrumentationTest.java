package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AiShieldClassifierInstrumentationTest {
    @Test
    public void bundledTfliteModelIsAvailableOnlyAfterExplicitLoad() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AiShieldClassifier classifier = new AiShieldClassifier(context);

        assertTrue(classifier.isMetadataAvailable());
        assertFalse(classifier.isAvailable());
        assertTrue(classifier.load(context));
        assertTrue(classifier.isAvailable());
        classifier.release();
    }

    @Test
    public void cameraCaptureUsesLoadedModelWithoutUploadingFrames() {
        AiShieldClassifier classifier = loadedClassifier();
        Bitmap fixture = solidFixture(Color.rgb(20, 40, 180));

        AiShieldClassifier.Analysis result = classifier.analyze(fixture, "camera");

        assertEquals("camera", result.source);
        assertNotEquals(AiShieldClassifier.STATE_MODEL_UNAVAILABLE, result.state);
        assertTrue(result.modelVersion.startsWith("safenet-nudity-tflite-"));
        fixture.recycle();
        classifier.release();
    }

    @Test
    public void screenCaptureUsesLoadedModelWithoutUploadingFrames() {
        AiShieldClassifier classifier = loadedClassifier();
        Bitmap fixture = solidFixture(Color.rgb(20, 40, 180));

        AiShieldClassifier.Analysis result = classifier.analyze(fixture, "screen");

        assertEquals("screen", result.source);
        assertNotEquals(AiShieldClassifier.STATE_MODEL_UNAVAILABLE, result.state);
        assertTrue(result.confidence != null);
        fixture.recycle();
        classifier.release();
    }

    @Test
    public void malformedMetadataNeverReportsSafe() {
        AiShieldClassifier classifier = new AiShieldClassifier("{malformed");

        assertFalse(classifier.isMetadataAvailable());
        AiShieldClassifier.Analysis result = classifier.analyze(null, "camera");

        assertEquals(AiShieldClassifier.STATE_MODEL_UNAVAILABLE, result.state);
        assertFalse(AiShieldClassifier.STATE_SAFE.equals(result.state));
    }

    @Test
    public void invalidFrameNeverReportsSafe() {
        AiShieldClassifier classifier = loadedClassifier();

        AiShieldClassifier.Analysis result = classifier.analyze(null, "screen");

        assertEquals(AiShieldClassifier.STATE_CAPTURE_UNAVAILABLE, result.state);
        assertFalse(AiShieldClassifier.STATE_SAFE.equals(result.state));
        classifier.release();
    }

    @Test
    public void deniedAndUnavailableStatesContainNoFrameData() {
        AiShieldClassifier.Analysis denied = AiShieldClassifier.permissionDenied(
            "camera",
            "Camera permission was denied."
        );
        AiShieldClassifier.Analysis unavailable = AiShieldClassifier.captureUnavailable(
            "screen",
            "Projection revoked."
        );

        assertEquals(AiShieldClassifier.STATE_PERMISSION_DENIED, denied.state);
        assertEquals(AiShieldClassifier.STATE_CAPTURE_UNAVAILABLE, unavailable.state);
        assertEquals(null, denied.confidence);
        assertEquals(null, unavailable.confidence);
    }

    private static AiShieldClassifier loadedClassifier() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AiShieldClassifier classifier = new AiShieldClassifier(context);
        assertTrue("The bundled TFLite model failed to load: " + classifier.getUnavailableReason(),
            classifier.load(context));
        return classifier;
    }

    private static Bitmap solidFixture(int color) {
        Bitmap fixture = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
        fixture.eraseColor(color);
        return fixture;
    }
}