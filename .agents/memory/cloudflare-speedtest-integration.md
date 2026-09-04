---
name: Cloudflare speed test integration
description: The supported way to provide an in-app Cloudflare Internet speed test without framing the public site.
---

Cloudflare’s public Internet Speed Test page sends `X-Frame-Options: DENY`, so it cannot be embedded in an iframe. The supported in-app route is Cloudflare’s `@cloudflare/speedtest` browser engine, which measures against Cloudflare’s edge endpoints and exposes live callbacks plus latency, bandwidth, packet-loss, and AIM score results.

**Why:** Direct iframe embedding fails by design, while proxying or copying the public page would be brittle and inappropriate. The published engine is the official reusable surface and keeps the UI under SafeNet’s control.

**How to apply:** Keep the Cloudflare engine behind the app’s own page shell. Disable result logging only when the product intentionally does not want to submit the test’s final AIM result; the engine’s documentation notes that Cloudflare may still collect measurement results for aggregated connection insights.

For browser regression tests, keep the engine's default phase sequence intact but stub the TURN data channel, cap only large generated upload bodies, and compress the loaded-latency timer in the page test setup. This avoids multi-megabyte uploads and long throttle waits without changing production configuration.

**Why:** A happy-path completion check must exercise latency, download, upload, and packet-loss callbacks, while the real payload sizes and TURN dependency make a local browser test slow and environment-dependent.

**How to apply:** Keep Cloudflare request URLs and byte parameters unchanged so the engine computes real formatted values; use deterministic response delays only for the pause checkpoint and short measurable bandwidth responses afterward.