---
name: Headscale external control plane
description: SafeNet's Headscale and Headplane integration boundary for external mesh administration.
---

SafeNet treats Headscale and Headplane as external services. Headscale provides the control plane and Headplane provides the community administration UI; SafeNet exposes only bounded status and a user-triggered Headplane link.

**Why:** Headscale does not ship a built-in web UI, and the SafeNet web deployment is not the appropriate place to host the WireGuard/Tailscale mesh data plane.

**How to apply:** Keep the Headscale API key server-side, use `HEADSCALE_URL`, `HEADPLANE_URL`, and `HEADSCALE_API_KEY` for status checks, and do not promise WG-Easy-style QR/profile provisioning from this integration.