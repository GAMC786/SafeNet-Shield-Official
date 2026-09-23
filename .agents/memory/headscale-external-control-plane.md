---
name: Headscale external control plane
description: SafeNet's Headscale and Headplane integration boundary for external mesh administration.
---

SafeNet treats Headscale and Headplane as external services. Headscale provides the control plane and Headplane provides the community administration UI; SafeNet exposes only bounded status and a user-triggered Headplane link.

**Why:** Headscale does not ship a built-in web UI, and the SafeNet web deployment is not the appropriate place to host the WireGuard/Tailscale mesh data plane.

**How to apply:** Keep the Headscale API key server-side, use `HEADSCALE_URL`, `HEADPLANE_URL`, and `HEADSCALE_API_KEY` for status checks, and do not promise WG-Easy-style QR/profile provisioning from this integration.

For an Android mesh PASS, require evidence from a separate Tailscale-compatible
client: an authenticated online node record with an owner, explicit
Headplane and custom-login-server confirmation, reachable DERP service, a
physical client build, a VPN route, and a real approved-peer probe. Missing
external host or device prerequisites must be recorded as `BLOCKED`, never
inferred from SafeNet's own dashboard status.

**Why:** SafeNet can report the external control plane but cannot prove that a
client joined the tailnet or that encrypted peer traffic works. Treating API
reachability as end-to-end proof would create a false release signal.

**How to apply:** Use the bounded Android mesh evidence probe and preserve its
endpoint, node ownership, client build, route, and peer-probe fields with the
run evidence.
