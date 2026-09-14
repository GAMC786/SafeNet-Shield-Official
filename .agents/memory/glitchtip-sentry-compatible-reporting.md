---
name: GlitchTip Sentry-compatible reporting
description: SafeNet’s browser and Node error reporting boundary for GlitchTip.
---

GlitchTip uses the Sentry-compatible browser and Node SDKs. The server keeps the configured DSN in the environment and provides it to the browser through a small config endpoint; the API logger must redact that response field.

**Why:** Browser-side capture needs the DSN, while logging the response would expose configuration unnecessarily. This app intentionally disables tracing, so direct Express error middleware avoids the SDK’s performance-instrumentation warning.

**How to apply:** Keep initialization optional when the DSN is absent, tag events with the package release, use the React error boundary plus global capture hooks, and use the direct Express error handler when traces remain disabled.