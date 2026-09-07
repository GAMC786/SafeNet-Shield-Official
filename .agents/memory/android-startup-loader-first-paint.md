---
name: Android startup loader first paint
description: Packaged WebViews need a synchronous startup render before async Clerk configuration to guarantee the loader is visible.
---

Render the startup loader before fetching runtime authentication configuration, then keep the loader timer in the mounted app.

**Why:** A native WebView can finish its platform splash and resolve a fast configuration request before a loader that is only mounted after async initialization becomes visually observable.

**How to apply:** Keep the initial root render as the loader, use runtime configuration loading afterward, and make the mounted loader duration explicit when changing startup UX.