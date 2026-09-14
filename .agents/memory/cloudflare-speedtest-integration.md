---
name: Cloudflare speed test integration
description: The supported way to provide an in-app Cloudflare Internet speed test without framing the public site.
---

Cloudflare’s public Internet Speed Test page sends `X-Frame-Options: DENY`, so it cannot be embedded in an iframe. The supported in-app route is Cloudflare’s `@cloudflare/speedtest` browser engine, which measures against Cloudflare’s edge endpoints and exposes live callbacks plus latency, bandwidth, packet-loss, and AIM score results.

**Why:** Direct iframe embedding fails by design, while proxying or copying the public page would be brittle and inappropriate. The published engine is the official reusable surface and keeps the UI under SafeNet’s control.

**How to apply:** Keep the Cloudflare engine behind the app’s own page shell. Disable result logging only when the product intentionally does not want to submit the test’s final AIM result; the engine’s documentation notes that Cloudflare may still collect measurement results for aggregated connection insights.

SafeNet uses the engine directly in the browser with a bounded measurement plan: upload probes stay small enough for Android/WebView, final AIM/result logging is disabled for this product flow, and upload or TURN failures remain non-fatal partial results while latency/download data is preserved.

**Why:** The browser engine measures the user device rather than the server, but mobile WebViews can fail on large uploads and the public TURN dependency can be unavailable. A completed partial result is more useful than a stuck test or a raw endpoint error.

**How to apply:** Keep `__down` and `__up` on Cloudflare’s public endpoints, but obtain TURN credentials through a same-origin SafeNet proxy. Cloudflare’s credential endpoint can reject server requests without an `Origin` header, and its current response returns full `turn:` URLs; normalize the first TURN URL to the SDK’s host-and-port input before returning it. Convert bps to Mbps and packet-loss ratios to percentages only at the SafeNet UI boundary. Treat upload-only and packet-loss errors as bounded warnings.

For browser regression tests, keep the engine's default phase sequence intact but stub the TURN data channel, cap only large generated upload bodies, and compress the loaded-latency timer in the page test setup. This avoids multi-megabyte uploads and long throttle waits without changing production configuration.

**Why:** A happy-path completion check must exercise latency, download, upload, and packet-loss callbacks, while the real payload sizes and TURN dependency make a local browser test slow and environment-dependent.

**How to apply:** Keep Cloudflare request URLs and byte parameters unchanged so the engine computes real formatted values; use deterministic response delays only for the pause checkpoint and short measurable bandwidth responses afterward.

The browser cannot request Cloudflare TURN credentials directly from a Replit Domain because the credential endpoint does not allow that origin through CORS. The server proxy must redact returned usernames and credentials from response logging.

**Why:** Without the proxy, HTTP speed phases complete but the WebRTC packet-loss phase is skipped, leaving packet loss pending even though the rest of the test succeeds.

**How to apply:** Keep the proxy response shape compatible with the installed SDK (`username`, `credential`, `server`) and keep test fixtures on the same-origin route.