---
name: Protection status coordination
description: Shared protection truth across browser antivirus, Android Private DNS, and native status consumers
---

Protection indicators must be derived from verified dependencies: browser protection requires server availability, firewall enabled, antivirus enabled, and a verified ClamAV engine; Android protection requires hostname-mode Private DNS matching the expected SafeNet hostname after normalization.

**Why:** A configured setting or arbitrary Private DNS hostname can look active while the actual protection path is unavailable or bypassable.

**How to apply:** Keep the high-level predicate shared between Dashboard and feature status consumers, and pass the expected resolver hostname into native protection-status reads.