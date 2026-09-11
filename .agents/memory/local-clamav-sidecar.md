---
name: Local ClamAV sidecar
description: Replit can host ClamAV beside the app when a separate always-on service is unavailable.
---

The SafeNet deployment can run ClamAV locally when the `clamav` Nix package is present: refresh signatures into ephemeral state, start `clamd` on loopback, and expose only a token-protected internal REST bridge. SafeNet must continue to require health, clean-file, and full EICAR proof before scanning.

**Why:** A web deployment cannot provide a separate Railway-style service automatically, but it can run a local engine without exposing the scanner publicly. Autoscale instances still need fresh startup verification because local signature state is not durable.

**How to apply:** Treat this as a no-external-host fallback. Keep the WireGuard gateway separate because it needs persistent UDP, forwarding, NAT, and gateway-level network control.