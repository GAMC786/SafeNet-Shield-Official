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
behavior, and both camera and MediaProjection source paths. The Android device
smoke suite also drives camera consent, waits for a real camera inference,
checks pause/stop cleanup, drives MediaProjection consent, and revokes the
active projection to verify a visible `capture_unavailable` result without a
safe verdict. These tests are not a claim of real-world precision or recall.
Before release, evaluate a
consent-cleared, representative fixture set and report precision, recall,
false-positive rate, and false-negative rate for this exact engine version.

## Physical-device source-switch validation

The hosted emulator smoke lane is not physical-device evidence. To exercise the
camera-driver and MediaProjection callback ordering on a real phone, connect
exactly one Android device with USB debugging enabled and run the focused lane
from the repository root:

```sh
./scripts/android-ai-shield-device-test.sh \
  --apk android/app/build/outputs/apk/release/app-release.apk \
  --test-apk android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk \
  --serial <adb-serial> \
  --output android/app/build/reports/android-ai-shield-device/latest
```

The APKs must be signed release APKs built for the same revision. The lane
rejects an emulator, requires one online physical target, installs both APKs,
and runs both rapid directions:

- camera → MediaProjection screen
- MediaProjection screen → camera

It records `device-details.txt`, `instrumentation.log`, `consent-events.log`,
and `callback-order.txt` in the evidence directory. The consent log must show
camera permission and MediaProjection approval. The callback log contains
generation-numbered `AI_SHIELD_CALLBACK` records, including callbacks ignored
after a source replacement when the device delivers one late. `result.txt`
reports each direction separately and keeps `generation_guards=UNCHANGED`; a
failure or missing event is not converted to a pass.

The same check is available as the opt-in
`android_ai_shield_physical_validation` workflow-dispatch input on a
self-hosted runner labeled `android-physical-device`. This workspace cannot
access a phone attached to the user's local computer, so no physical-device
pass should be inferred from local or hosted-emulator runs. OEM permission
wording, revoked screen-capture surfaces, secure/DRM windows, and
device-specific camera driver failures remain limitations and are preserved in
the evidence rather than bypassed.

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
