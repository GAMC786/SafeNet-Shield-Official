---
name: OpenSpeedTest integration
description: How SafeNet embeds the official OpenSpeedTest engine without depending on an invented JSON API.
---

Use the official OpenSpeedTest page in an embedded browser panel, with a link to the same page as a full-page fallback. Do not build against an assumed public JSON endpoint; the official engine is browser-based.

**Why:** OpenSpeedTest provides a vanilla browser engine rather than a stable public measurement API, and the browser panel loaded successfully during preview verification.

**How to apply:** Keep the embedded URL and fallback URL aligned, and validate the packaged Android WebView separately because iframe and autoplay policies can differ from desktop preview.