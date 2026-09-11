---
name: Capacitor activity-result recovery
description: Pending Capacitor activity calls survive Android recreation through bridge state, while plugin-local delivery state must be restored separately.
---

Capacitor rebuilds a pending activity call as a dangling call after activity recreation. Plugins that need exactly-once delivery or lifecycle guards must persist their own pending/result state and release the retained call after handling the result.

**Why:** A recreated plugin instance has no in-memory callback identifier, and duplicate activity results can otherwise restart capture or resolve the same native operation more than once.

**How to apply:** Pair the plugin’s `saveInstanceState`/`restoreState` with Capacitor’s built-in activity-result persistence, guard the callback before starting work, and test both approval and cancellation while the external prompt is open.