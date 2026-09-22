---
name: Cloudflare mobile upload probes
description: Android WebViews may fail on large Cloudflare upload probes even when latency and download measurements work.
---

Keep mobile Cloudflare upload probes small and treat an upload-only failure as a bounded partial result instead of surfacing the raw endpoint error or leaving the test stuck.

**Why:** A real Android/WebView run reached the 1 MB upload endpoint and stopped at the upload phase while earlier measurements were usable.

**How to apply:** Prefer small upload measurements for the Android/WebView speed-test profile, use a bounded same-origin SafeNet upload relay when direct Cloudflare POSTs fail under protection, and measure relay requests with client wall-clock time rather than relying only on Resource Timing. Keep completed latency/download results visible and give the user a clear retryable limitation.

**Additional constraint:** A hosted reverse proxy may buffer the request before the Node handler runs, making the relay's server-side duration appear near-zero even when the client did send the payload. A normal `200` response body also behaves more consistently than an empty `204` response in Android WebViews.