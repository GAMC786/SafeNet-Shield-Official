# Android AI Shield

AI Shield's camera and screen features are Android APK features. The bundled
`safenet-nudity-engine-1.0.0` is a versioned, Apache-2.0 licensed, calibrated
on-device baseline engine. It returns `safe`, `nudity_detected`, or `uncertain`
from aggregate pixel features and never stores or uploads source frames.

## Consent and coverage

- Camera monitoring starts only after Android runtime camera permission.
- Screen monitoring starts only after Android MediaProjection consent.
- Monitoring stops when the user presses Stop, when the app pauses, when the
  camera becomes unavailable, or when Android revokes the projection.
- MediaProjection covers only pixels Android exposes. Secure windows, DRM video,
  revoked projections, and hidden/off-screen content may be unavailable.
- The feature is not unrestricted device surveillance and does not replace
  Play Protect, browser controls, or network interception.

## Calibration and validation

The engine uses conservative thresholds from the bundled metadata:

- `score < 0.18`: high-confidence safe signal
- `score >= 0.64`: high-confidence nudity signal
- `0.18 <= score < 0.64`: uncertain; never silently treated as safe

The instrumentation fixtures exercise uniform non-skin, representative
skin-region, and mixed/ambiguous frames. These fixtures verify threshold
behavior and lifecycle/privacy contracts; they are not a claim of real-world
precision or recall. Before release, evaluate a consent-cleared, representative
fixture set and report precision, recall, false-positive rate, and false-negative
rate for this exact engine version.