---
name: Android startup loader first paint
description: Packaged WebViews need a synchronous startup render before async Clerk configuration to guarantee the loader is visible.
---

Render the startup loader before fetching runtime authentication configuration, and keep a plain HTML/CSS copy in index.html so the first paint does not depend on React, Tailwind, or a remote image.

**Why:** A native WebView can finish its platform splash and resolve a fast configuration request before a loader that is only mounted after async initialization becomes visually observable. A JavaScript or asset-loading failure otherwise falls back to the WebView's white default background.

**How to apply:** Keep the initial root render as the loader, mirror its critical dots/text in the static HTML, avoid network-dependent loader backgrounds, use runtime configuration loading afterward, and make the mounted loader duration explicit when changing startup UX.