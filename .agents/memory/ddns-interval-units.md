---
name: DDNS interval units
description: The boundary between user-facing DDNS intervals and internal scheduler timing.
---

DDNS update intervals are expressed in whole seconds in the UI, API, and scheduler. The existing database column remains milliseconds for compatibility, with conversion isolated at the route and persistence boundaries.

**Why:** User-entered intervals and scheduler decisions should use the same simple unit, while changing the existing persisted column would risk rewriting live records.

**How to apply:** Keep API validation, response messages, elapsed-time comparisons, and scheduler cadence in seconds. Convert only when reading or writing the legacy millisecond database value.