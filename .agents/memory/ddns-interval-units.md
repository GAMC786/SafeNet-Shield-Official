---
name: DDNS interval units
description: The boundary between user-facing DDNS intervals and internal scheduler timing.
---

DDNS update intervals are expressed in whole minutes in the UI and API, while scheduler comparisons use seconds. The existing database column remains milliseconds for compatibility, with conversion isolated at the route and persistence boundaries.

**Why:** Minute-based provider writes avoid accidental high-frequency updates while preserving the existing persisted column and scheduler precision.

**How to apply:** Validate and report whole minutes at the API/UI boundary, convert to milliseconds for persistence, clamp legacy or malformed stored values to the one-minute scheduler minimum, and claim each write slot atomically across autoscaled processes.