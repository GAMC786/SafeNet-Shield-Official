---
name: Reference soundtrack and Rive loading
description: Cross-origin behavior for the external 2Advanced soundtrack and Rive companion used by SafeNet
---

The reference soundtrack can be streamed by an HTML audio element after an explicit user gesture, but the reference site's mainstage Rive asset does not expose cross-origin headers. Loading that `.riv` file through a React Rive runtime from SafeNet's origin produces a browser `Failed to fetch` error.

**Why:** The first preview attempt used the reference Rive URL directly, which caused the app workflow to fail even though the server itself was healthy.

**How to apply:** Keep playback user-gesture gated and use `loop` on the audio element. Do not point `useRive` at the reference mainstage file unless a licensed, same-origin or CORS-enabled copy is provided; use a CORS-enabled Rive asset or a user-supplied local asset for the visual companion.