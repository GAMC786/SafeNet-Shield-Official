---
name: Reference soundtrack and Rive loading
description: Cross-origin behavior for the external 2Advanced soundtrack and Rive companion used by SafeNet
---

The reference soundtrack can be streamed by an HTML audio element. SafeNet places one persistent audio element in the static HTML shell and starts it during the startup loader when the persisted Soundtrack toggle is enabled. The toggle pauses and resets playback when disabled; page visibility, browser pagehide, and Android activity pause stop and reset it, while returning to visibility or Android resume starts it again when enabled. Every playback promise is caught so autoplay policy differences do not create unhandled browser/WebView errors. The reference site's mainstage Rive asset does not expose cross-origin headers.

**Why:** The first preview attempt used the reference Rive URL directly, which caused the app workflow to fail even though the server itself was healthy. The product requirement later changed to audible soundtrack during the loader and controlled playback when the app opens or closes, so the static audio shell and lifecycle handlers now own playback while the toggle remains authoritative.

**How to apply:** Keep the audio element outside the React root, use `loop` and a persisted mute preference, start only when the preference is enabled, catch every `play()` promise, stop/reset on browser pagehide and native pause/destroy, and resume on visibility/native resume. Retain the tap fallback for browsers. Do not point `useRive` at the reference mainstage file unless a licensed, same-origin or CORS-enabled copy is provided; use a CORS-enabled Rive asset or a user-supplied local asset for the visual companion.