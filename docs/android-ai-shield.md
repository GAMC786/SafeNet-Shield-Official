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