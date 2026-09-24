---
name: Tailscale hosted control plane
description: Architecture and evidence boundaries for SafeNet's Tailscale integration.
---

SafeNet integrates with Tailscale's hosted control plane using a server-side OAuth client with the read-only `devices:core:read` permission. Exchange client credentials by POSTing `client_id` and `client_secret` as form fields to `/api/v2/oauth/token`; the OAuth client's configured permissions determine token scope, so don't send credentials with HTTP Basic auth or request scope dynamically. The official Tailscale client repository is not a self-hostable control-plane deployment. SafeNet can report API reachability and device control-plane status, but neither proves that an Android device is routing traffic through Tailscale.

**Why:** Tailscale's documented token request uses form fields, and a healthy dashboard or API can coexist with a disconnected client or unusable peer route; claiming mesh connectivity from control-plane status alone would be misleading.

**How to apply:** Keep credentials server-side and narrowly scoped. Treat physical Android route plus an approved-peer probe as separate evidence, and report missing device or runner prerequisites as blocked rather than as a pass.