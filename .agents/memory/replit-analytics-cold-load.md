---
name: Replit analytics cold-load delivery
description: Replit's injected tracker may not exist when a SPA fires a return event during its first mount.
---

Return-path custom events should be queued until the injected `window.umami`
tracker is available. Optional chaining prevents an analytics error, but it
also silently drops the event when the tracker is still loading.

**Why:** A cold published Settings return reproduced the expected UI but sent
only the automatic pageview; the same documented custom payload was accepted
once the tracker was ready.

**How to apply:** Treat a successful tracker transport response as separate
from queryable Project Analytics ingestion. After any analytics instrumentation
change, republish and verify both the network payload and a delayed analytics
query using a bounded window.