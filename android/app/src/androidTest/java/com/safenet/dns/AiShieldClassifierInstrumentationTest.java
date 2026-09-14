package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AiShieldClassifierInstrumentationTest {
    private static final String BENCHMARK_TAG = "AiShieldBenchmark";

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

    /**
     * Runs a bounded, offline quality check against deterministic synthetic
     * fixtures. The fixtures are generated in memory and are never written,
     * uploaded, or derived from a user capture.
     *
     * Binary metrics treat nudity_detected as the positive action and count
     * uncertain as not detected. Ambiguous fixtures are reported separately
     * so abstention quality is visible without inventing a binary ground truth.
     */
    @Test
    public void bundledModelBenchmarkReportsMetricsPerVersion() {
        AiShieldClassifier classifier = loadedClassifier();
        Map<String, BenchmarkMetrics> metricsByVersion = new LinkedHashMap<>();
        int safeFixtureCount = 0;
        int nudityFixtureCount = 0;
        int ambiguousFixtureCount = 0;

        try {
            List<BenchmarkFixture> fixtures = Arrays.asList(
                new BenchmarkFixture("safe_sky_landscape", Truth.SAFE, 0),
                new BenchmarkFixture("safe_geometric_illustration", Truth.SAFE, 1),
                new BenchmarkFixture("safe_textured_food", Truth.SAFE, 2),
                new BenchmarkFixture("nudity_abstract_silhouette", Truth.NUDITY, 3),
                new BenchmarkFixture("nudity_warm_tone_figure", Truth.NUDITY, 4),
                new BenchmarkFixture("nudity_abstract_body_study", Truth.NUDITY, 5),
                new BenchmarkFixture("ambiguous_occluded_figure", Truth.AMBIGUOUS, 6),
                new BenchmarkFixture("ambiguous_low_light_scene", Truth.AMBIGUOUS, 7),
                new BenchmarkFixture("ambiguous_partial_warm_gradient", Truth.AMBIGUOUS, 8)
            );

            for (BenchmarkFixture fixture : fixtures) {
                Bitmap frame = fixture.createBitmap();
                AiShieldClassifier.Analysis result;
                try {
                    result = classifier.analyze(frame, "benchmark_fixture");
                } finally {
                    // Only aggregate state is retained. The source pixels are
                    // eligible for collection as soon as each case completes.
                    frame.recycle();
                }

                assertEquals(AiShieldClassifier.MODEL_VERSION, result.modelVersion);
                assertNotEquals(AiShieldClassifier.STATE_MODEL_UNAVAILABLE, result.state);
                assertNotEquals(AiShieldClassifier.STATE_CAPTURE_UNAVAILABLE, result.state);

                BenchmarkMetrics metrics = metricsByVersion.get(result.modelVersion);
                if (metrics == null) {
                    metrics = new BenchmarkMetrics(result.modelVersion);
                    metricsByVersion.put(result.modelVersion, metrics);
                }
                metrics.record(fixture.truth, result.state);
                if (fixture.truth == Truth.SAFE) {
                    safeFixtureCount++;
                } else if (fixture.truth == Truth.NUDITY) {
                    nudityFixtureCount++;
                } else {
                    ambiguousFixtureCount++;
                }
            }

            assertEquals(3, safeFixtureCount);
            assertEquals(3, nudityFixtureCount);
            assertEquals(3, ambiguousFixtureCount);
            assertEquals(1, metricsByVersion.size());
            for (BenchmarkMetrics metrics : metricsByVersion.values()) {
                String report = metrics.toJson(
                    safeFixtureCount,
                    nudityFixtureCount,
                    ambiguousFixtureCount
                ).toString();
                Log.i(BENCHMARK_TAG, "AI_SHIELD_BENCHMARK " + report);
                System.out.println("AI_SHIELD_BENCHMARK " + report);
            }
        } finally {
            classifier.release();
        }
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

    private enum Truth {
        SAFE,
        NUDITY,
        AMBIGUOUS
    }

    private static final class BenchmarkFixture {
        private final String name;
        private final Truth truth;
        private final int pattern;

        private BenchmarkFixture(String name, Truth truth, int pattern) {
            this.name = name;
            this.truth = truth;
            this.pattern = pattern;
        }

        private Bitmap createBitmap() {
            final int size = 224;
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            for (int y = 0; y < size; y++) {
                for (int x = 0; x < size; x++) {
                    bitmap.setPixel(x, y, colorFor(x, y, size));
                }
            }
            return bitmap;
        }

        private int colorFor(int x, int y, int size) {
            float nx = (x - size / 2.0f) / (size / 2.0f);
            float ny = (y - size / 2.0f) / (size / 2.0f);
            float distance = nx * nx + ny * ny;
            switch (pattern) {
                case 0: // Blue sky, green ground, and a sun.
                    return y < size * 0.58f
                        ? Color.rgb(70 + y / 8, 155 + y / 12, 225)
                        : Color.rgb(45, 125 + (x % 24), 75);
                case 1: // High-contrast geometric illustration.
                    return ((x / 28 + y / 28) % 2 == 0)
                        ? Color.rgb(235, 245, 250)
                        : Color.rgb(40, 105, 175);
                case 2: // Warm food-like blocks with no human form.
                    return ((x / 18 + y / 14) % 3 == 0)
                        ? Color.rgb(225, 90, 45)
                        : Color.rgb(80 + (x % 40), 55 + (y % 35), 35);
                case 3: // Non-photographic warm-tone silhouette.
                    return silhouettePixel(nx, ny, distance, Color.rgb(30, 55, 68));
                case 4: // Stylized figure made from overlapping simple shapes.
                    return figurePixel(nx, ny, Color.rgb(205, 220, 226));
                case 5: // Abstract body-study palette and central form.
                    return abstractFigurePixel(nx, ny, distance);
                case 6: // Occluded figure: large neutral mask over a warm form.
                    if (x > size * 0.27f && x < size * 0.73f && y > size * 0.34f) {
                        return Color.rgb(110, 120, 128);
                    }
                    return silhouettePixel(nx, ny, distance, Color.rgb(35, 45, 55));
                case 7: // Low-light scene with deliberately weak structure.
                    int shade = 28 + ((x + y) % 18);
                    return Color.rgb(shade, shade + 3, shade + 8);
                case 8: // Partial warm gradient without a complete figure.
                    return x < size * 0.48f
                        ? Color.rgb(170 + (x % 25), 105 + (y % 22), 85)
                        : Color.rgb(72, 84, 105);
                default:
                    return Color.BLACK;
            }
        }

        private static int silhouettePixel(
            float nx,
            float ny,
            float distance,
            int background
        ) {
            boolean head = (nx * nx) + ((ny + 0.52f) * (ny + 0.52f)) < 0.035f;
            boolean torso = (nx * nx * 1.8f) + (ny * ny * 0.75f) < 0.24f && ny > -0.35f;
            boolean leftArm = (nx + 0.36f) * (nx + 0.36f) + (ny + 0.02f) * (ny + 0.02f) < 0.06f;
            boolean rightArm = (nx - 0.36f) * (nx - 0.36f) + (ny + 0.02f) * (ny + 0.02f) < 0.06f;
            if (head || torso || leftArm || rightArm) {
                return Color.rgb(190, 118, 92);
            }
            return background;
        }

        private static int figurePixel(float nx, float ny, int background) {
            boolean head = nx * nx + (ny + 0.55f) * (ny + 0.55f) < 0.04f;
            boolean body = nx * nx * 2.0f + ny * ny < 0.26f && ny > -0.36f;
            boolean arm = Math.abs(nx) < 0.14f && ny > 0.25f;
            if (head || body || arm) {
                return Color.rgb(198, 132, 105);
            }
            return background;
        }

        private static int abstractFigurePixel(float nx, float ny, float distance) {
            if (distance < 0.46f && ny > -0.1f) {
                return Color.rgb(205, 145, 122);
            }
            if (nx * nx + (ny + 0.47f) * (ny + 0.47f) < 0.05f) {
                return Color.rgb(216, 155, 130);
            }
            return Color.rgb(76, 62, 92);
        }
    }

    private static final class BenchmarkMetrics {
        private final String modelVersion;
        private int truePositive;
        private int trueNegative;
        private int falsePositive;
        private int falseNegative;
        private int safeCount;
        private int nudityCount;
        private int ambiguousCount;
        private int ambiguousUncertainCount;
        private int safeStateCount;
        private int nudityStateCount;
        private int uncertainStateCount;

        private BenchmarkMetrics(String modelVersion) {
            this.modelVersion = modelVersion;
        }

        private void record(Truth truth, String state) {
            boolean detected = AiShieldClassifier.STATE_NUDITY_DETECTED.equals(state);
            if (AiShieldClassifier.STATE_SAFE.equals(state)) {
                safeStateCount++;
            } else if (detected) {
                nudityStateCount++;
            } else if (AiShieldClassifier.STATE_UNCERTAIN.equals(state)) {
                uncertainStateCount++;
            }

            if (truth == Truth.SAFE) {
                safeCount++;
                if (detected) {
                    falsePositive++;
                } else {
                    trueNegative++;
                }
            } else if (truth == Truth.NUDITY) {
                nudityCount++;
                if (detected) {
                    truePositive++;
                } else {
                    falseNegative++;
                }
            } else {
                ambiguousCount++;
                if (AiShieldClassifier.STATE_UNCERTAIN.equals(state)) {
                    ambiguousUncertainCount++;
                }
            }
        }

        private JSONObject toJson(
            int safeFixtureCount,
            int nudityFixtureCount,
            int ambiguousFixtureCount
        ) {
            JSONObject report = new JSONObject();
            try {
                report.put("modelVersion", modelVersion);
                report.put("fixtureSet", "synthetic-consent-cleared-v1");
                report.put("framesStoredOrUploaded", false);
                report.put("safeFixtures", safeFixtureCount);
                report.put("nudityFixtures", nudityFixtureCount);
                report.put("ambiguousFixtures", ambiguousFixtureCount);
                report.put("positiveAction", AiShieldClassifier.STATE_NUDITY_DETECTED);
                report.put("truePositive", truePositive);
                report.put("trueNegative", trueNegative);
                report.put("falsePositive", falsePositive);
                report.put("falseNegative", falseNegative);
                report.put("precision", ratio(truePositive, truePositive + falsePositive));
                report.put("recall", ratio(truePositive, truePositive + falseNegative));
                report.put(
                    "falsePositiveRate",
                    ratio(falsePositive, falsePositive + trueNegative)
                );
                report.put(
                    "falseNegativeRate",
                    ratio(falseNegative, falseNegative + truePositive)
                );
                report.put("stateCounts", new JSONObject()
                    .put("safe", safeStateCount)
                    .put("nudity_detected", nudityStateCount)
                    .put("uncertain", uncertainStateCount));
                report.put("ambiguousUncertainRate", ratio(
                    ambiguousUncertainCount,
                    ambiguousCount
                ));
                report.put("binaryFixtureCount", safeCount + nudityCount);
                report.put("ambiguousFixtureCount", ambiguousCount);
            } catch (Exception error) {
                throw new AssertionError("Could not build benchmark report", error);
            }
            return report;
        }

        private static double ratio(int numerator, int denominator) {
            return denominator == 0 ? 0.0 : (double) numerator / denominator;
        }
    }

}