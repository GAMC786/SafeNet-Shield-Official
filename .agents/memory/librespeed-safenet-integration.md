---
name: LibreSpeed SafeNet integration
description: SafeNet’s custom Measure Your Network UI uses same-origin LibreSpeed-compatible transport endpoints.
---

Keep the SafeNet measurement UI as the presentation layer and use same-origin LibreSpeed-compatible timed multi-stream transfers for the data plane. Accuracy depends on warm-up windows, overhead compensation, post-warmup latency selection, jitter, and packet-loss reporting. The upstream project’s browser source is not reliably available through the workspace npm registry, so avoid making the app depend on an unresolvable package.

**Why:** A separate embedded LibreSpeed page would replace SafeNet’s controls, while a registry-only dependency can fail during build setup.

**How to apply:** Preserve the existing result shape and controls, keep the transport endpoints same-origin, and treat download/upload/ping endpoint behavior as a compatibility contract. Do not shorten the transfer windows or remove the warm-up period without revalidating accuracy.