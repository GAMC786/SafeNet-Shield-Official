---
name: NetBird external control plane
description: SafeNet's boundary for NetBird self-hosting, app status, and Android mesh evidence.
---

SafeNet uses a separately hosted NetBird deployment for mesh control, signaling, relay, and dashboard. SafeNet may read bounded peer status with a server-side read-only token, but it does not host the mesh data plane or enroll peers.

**Why:** NetBird self-hosting requires a public Linux/Docker host, stable DNS and TLS, inbound TCP 80/443, UDP 3478, and persistent deployment state. Replit's web app is not a substitute for those network and storage requirements.

**How to apply:** Use the official NetBird self-host quickstart on an external VM; use only the read-only `/api/peers` API for SafeNet status, and keep tokens server-side.

Android mesh connectivity is provided by the official NetBird Android client as a separate peer, not by SafeNet's DNS VPN. A successful management API check is not proof of an encrypted route; require a physical device, connected peer, VPN route, and real approved-peer probe for end-to-end evidence.

**Why:** Control-plane reachability cannot establish that Android joined the mesh or that peer traffic works.

**How to apply:** Treat API status as bounded observability only. Preserve peer identity evidence and fail closed when the physical client or approved peer is unavailable.