---
name: Caller reputation provider boundary
description: Approved caller-reputation configuration must be supplied by the workspace owner; SafeNet must not select or impersonate a provider.
---

The caller-reputation endpoint and any bearer credential must come from workspace configuration. There is no safe default vendor or generic public endpoint to substitute.

**Why:** A reputation decision can block or silence a real incoming call, so an unapproved or guessed provider would create an unsafe source-of-truth.

**How to apply:** Keep missing, malformed, unavailable, or invalid provider responses fail-open. Request the HTTPS endpoint through environment configuration and the credential through the secrets flow before claiming live-provider verification.