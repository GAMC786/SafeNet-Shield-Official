---
name: Cloudflare mobile upload probes
description: Android WebViews may fail on large Cloudflare upload probes even when latency and download measurements work.
---

Keep mobile Cloudflare upload probes small and treat an upload-only failure as a bounded partial result instead of surfacing the raw endpoint error or leaving the test stuck.

**Why:** A real Android/WebView run reached the 1 MB upload endpoint and stopped at the upload phase while earlier measurements were usable.

**How to apply:** Prefer small upload measurements for the Android/WebView speed-test profile, keep completed latency/download results visible, and give the user a clear retryable limitation.