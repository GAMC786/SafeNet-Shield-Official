---
name: Android VPN removal boundary
description: Durable cleanup rule for retiring Android VPN functionality from SafeNet.
---

When SafeNet no longer provides an Android VPN, remove the capability from the native implementation, manifest, UI, instrumentation, smoke scripts, release evidence jobs, asset verifiers, and contract tests together. Keep only neutral compatibility names needed by unrelated Capacitor features, and make their behavior explicitly non-VPN.

**Why:** Removing the service and hiding its controls is not sufficient; stale release jobs and test fixtures can still require deleted WireGuard configuration, physical connectivity scripts, or VPN evidence and break otherwise valid releases.

**How to apply:** During future VPN-related cleanup, search source, workflows, scripts, docs, and test fixtures as one dependency surface. Preserve DNS/DDNS and unrelated Android feature coverage while deleting VPN-only validation lanes.