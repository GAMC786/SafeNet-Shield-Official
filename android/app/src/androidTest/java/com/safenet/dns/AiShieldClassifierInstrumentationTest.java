package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AiShieldClassifierInstrumentationTest {
    @Test
    public void packagedEngineMetadataIsAvailable() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

        AiShieldClassifier classifier = new AiShieldClassifier(context);

        assertTrue(classifier.isAvailable());
    }

    @Test
    public void bundledEngineMetadataIsVersionedAndLicensed() {
        AiShieldClassifier classifier = new AiShieldClassifier(
            "{\"modelVersion\":\"safenet-nudity-engine-1.0.0\","
                + "\"engine\":\"calibrated_skin_region\","
                + "\"license\":\"Apache-2.0\","
                + "\"safeThreshold\":0.18,"
                + "\"nudityThreshold\":0.64,"
                + "\"maxFrameDimension\":256}"
        );

        assertTrue(classifier.isAvailable());
        assertEquals("safenet-nudity-engine-1.0.0", AiShieldClassifier.MODEL_VERSION);
    }

    @Test
    public void nonSkinFixtureIsSafe() {
        AiShieldClassifier classifier = availableClassifier();
        Bitmap fixture = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
        fixture.eraseColor(Color.rgb(20, 40, 180));

        AiShieldClassifier.Analysis result = classifier.analyze(fixture, "screen");

        assertEquals(AiShieldClassifier.STATE_SAFE, result.state);
        assertEquals("screen", result.source);
        assertTrue(result.confidence >= 0.90f);
        fixture.recycle();
    }

    @Test
    public void skinDominantFixtureProducesHighConfidenceFinding() {
        AiShieldClassifier classifier = availableClassifier();
        Bitmap fixture = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
        fixture.eraseColor(Color.rgb(214, 146, 105));

        AiShieldClassifier.Analysis result = classifier.analyze(fixture, "camera");

        assertEquals(AiShieldClassifier.STATE_NUDITY_DETECTED, result.state);
        assertEquals("camera", result.source);
        assertTrue(result.confidence >= 0.72f);
        fixture.recycle();
    }

    @Test
    public void mixedFixtureIsUncertainRatherThanSafe() {
        AiShieldClassifier classifier = availableClassifier();
        Bitmap fixture = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
        for (int y = 0; y < 64; y++) {
            for (int x = 0; x < 64; x++) {
                fixture.setPixel(
                    x,
                    y,
                    x < 27 ? Color.rgb(214, 146, 105) : Color.rgb(20, 40, 180)
                );
            }
        }

        AiShieldClassifier.Analysis result = classifier.analyze(fixture, "screen");

        assertEquals(AiShieldClassifier.STATE_UNCERTAIN, result.state);
        fixture.recycle();
    }

    @Test
    public void malformedMetadataIsModelUnavailable() {
        AiShieldClassifier classifier = new AiShieldClassifier("{malformed");

        assertTrue(!classifier.isAvailable());
        AiShieldClassifier.Analysis result = classifier.analyze(null, "camera");
        assertEquals(AiShieldClassifier.STATE_MODEL_UNAVAILABLE, result.state);
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
        assertTrue(!denied.toJson().has("frame"));
        assertTrue(!unavailable.toJson().has("frame"));
    }

    private AiShieldClassifier availableClassifier() {
        return new AiShieldClassifier(
            "{\"modelVersion\":\"safenet-nudity-engine-1.0.0\","
                + "\"license\":\"Apache-2.0\","
                + "\"safeThreshold\":0.18,"
                + "\"nudityThreshold\":0.64,"
                + "\"maxFrameDimension\":256}"
        );
    }
}