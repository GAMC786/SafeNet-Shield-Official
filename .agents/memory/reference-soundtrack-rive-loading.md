---
name: Reference soundtrack and Rive loading
description: Cross-origin behavior for the external 2Advanced soundtrack and Rive companion used by SafeNet
---

The reference soundtrack can be streamed by an HTML audio element. SafeNet places one persistent audio element in the static HTML shell so it can start while the loader is visible; Android WebView explicitly permits media playback, while browser autoplay rejection is handled with a tap-to-enable control. The reference site's mainstage Rive asset does not expose cross-origin headers.

**Why:** The first preview attempt used the reference Rive URL directly, which caused the app workflow to fail even though the server itself was healthy. Mounting audio only after React finished loading meant the soundtrack could never start during the startup loader.

**How to apply:** Keep the audio element outside the React root, use `loop` and a persisted mute preference, configure Android WebView startup playback explicitly, and retain a clear tap fallback for browsers. Do not point `useRive` at the reference mainstage file unless a licensed, same-origin or CORS-enabled copy is provided; use a CORS-enabled Rive asset or a user-supplied local asset for the visual companion.