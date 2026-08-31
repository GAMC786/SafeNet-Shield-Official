---
name: Release API DNS validation
description: Non-obvious behavior of the Android release workflow's deployed API validation.
---

Official Android release builds validate the configured deployed API hostname with public DNS before syncing mobile assets. A transient resolver failure can stop the tag workflow before Gradle runs even when the same commit already passed compilation in pull-request and main-branch workflows.

**Why:** The release workflow deliberately fails fast rather than packaging an APK with an unreachable backend, but public DNS availability can differ between runners or moments.

**How to apply:** When the same commit has already passed application and Android compilation checks, inspect the failed step. If it is only the public-DNS lookup, rerun the tag workflow before modifying application code.