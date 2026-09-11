# Android AI Shield

AI Shield's camera and screen features are Android APK features. The bundled
`safenet-nudity-tflite-1.0.0` is a versioned, MIT-licensed TensorFlow Lite
image-classification model. It returns `safe`, `nudity_detected`, or
`uncertain` from local inference and never stores or uploads source frames.

## Consent and coverage

- Camera monitoring starts only after Android runtime camera permission.
- Screen monitoring starts only after Android MediaProjection consent.
- Monitoring stops when the user presses Stop, when the app pauses, when the
  camera becomes unavailable, or when Android revokes the projection.
- MediaProjection covers only pixels Android exposes. Secure windows, DRM video,
  revoked projections, and hidden/off-screen content may be unavailable.
- The feature is not unrestricted device surveillance and does not replace
  Play Protect, browser controls, or network interception.

## Model validation

The Android classifier validates the bundled metadata and TensorFlow Lite tensor
contract before it reports the model as available. It requires one RGB image
input and two or more output scores, then uses the pinned `nude` score with
conservative thresholds from the bundled metadata:

- `score < 0.18`: high-confidence safe signal
- `score >= 0.64`: high-confidence nudity signal
- `0.18 <= score < 0.64`: uncertain; never silently treated as safe

Instrumentation verifies explicit model loading, model-unavailable fail-closed
behavior, and both camera and MediaProjection source paths. These tests are
not a claim of real-world precision or recall. Before release, evaluate a
consent-cleared, representative fixture set and report precision, recall,
false-positive rate, and false-negative rate for this exact engine version.

## Offline benchmark

The repository includes a bounded benchmark for the bundled model:

```sh
./scripts/run-android-ai-shield-benchmark.sh
adb logcat -d -s AiShieldBenchmark:I '*:S' | grep AI_SHIELD_BENCHMARK
```

Run it with a connected Android device or emulator. The benchmark uses nine
deterministic, synthetic fixtures: three safe, three nudity, and three
ambiguous cases. The fixture patterns are created in the test process, are
consent-cleared by construction, and are recycled after each inference. No
camera or MediaProjection frames are read, stored, or uploaded.

The machine-readable line is grouped by `modelVersion` and includes the
confusion counts plus:

- `precision = truePositive / (truePositive + falsePositive)`
- `recall = truePositive / (truePositive + falseNegative)`
- `falsePositiveRate = falsePositive / (falsePositive + trueNegative)`
- `falseNegativeRate = falseNegative / (falseNegative + truePositive)`

For those binary metrics, `nudity_detected` is the positive action and
`uncertain` counts as not detected. Ambiguous fixtures are excluded from the
binary denominators and are reported separately through
`ambiguousUncertainRate` and `stateCounts`. The output also includes
`framesStoredOrUploaded: false` as an audit signal. This is a repeatable
threshold and regression check, not a claim that synthetic fixtures measure
real-world prevalence or replace a separately consented evaluation set.
