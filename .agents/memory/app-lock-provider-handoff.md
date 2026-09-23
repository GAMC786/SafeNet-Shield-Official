---
name: App Lock provider handoff
description: The security boundary for returning hosted provider authentication to native App Lock recovery
---

Hosted Google, Microsoft, Yahoo, and Apple authentication must remain browser/provider-owned. Native recovery receives only a short-lived, single-use handoff token bound to a locally generated nonce and a fixed SafeNet custom URI.

**Why:** Browser cookies are not a reliable native authentication boundary, and account recovery must reset only the device-local App Lock passcode without directly unlocking a protected app.

**How to apply:** Keep the handoff purpose separate from email recovery, consume it atomically on the server, consume the matching local nonce only after exchange, then require the new local passcode through the normal native lock screen.