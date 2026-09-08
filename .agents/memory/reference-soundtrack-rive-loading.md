---
name: Reference soundtrack and Rive loading
description: Cross-origin behavior for the external 2Advanced soundtrack and Rive companion used by SafeNet
---

The reference soundtrack can be streamed by an HTML audio element. SafeNet places one persistent, initially paused audio element in the static HTML shell; playback is released only after the startup loader is removed and the Dashboard is reachable. Android WebView explicitly permits media playback then, while browser autoplay rejection is handled with a tap-to-enable control. The reference site's mainstage Rive asset does not expose cross-origin headers.

**Why:** The first preview attempt used the reference Rive URL directly, which caused the app workflow to fail even though the server itself was healthy. Starting audio from the static shell or Android lifecycle made it audible during the required loader, so playback must wait for the explicit loader-complete signal.

**How to apply:** Keep the audio element outside the React root, use `loop` and a persisted mute preference, do not set static autoplay, release playback only after the loader-complete event or when the loader is already absent, stop and reset it on browser page close and native WebView pause/destroy, and retain a clear tap fallback for browsers. Do not point `useRive` at the reference mainstage file unless a licensed, same-origin or CORS-enabled copy is provided; use a CORS-enabled Rive asset or a user-supplied local asset for the visual companion.