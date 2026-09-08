---
name: Tagged Android metadata proof
description: How to preserve release metadata evidence when the full tagged release gate is blocked by a dedicated Android runner.
---

When a tagged release workflow builds the signed application and instrumentation APKs successfully but its dedicated writable-system startup job is queued, use the standalone Android APK workflow on the same controlled tag to prove the Gradle-derived version metadata and signed APK badging independently.

**Why:** The release job may not start until the self-hosted Android runner becomes available, while the metadata contract can still be validated by a real hosted run without publishing a GitHub Release.

**How to apply:** Correlate both run URLs and commit/tag, capture the resolver’s `versionName`/`versionCode` output plus `apksigner` and `aapt` verification, then confirm the GitHub Release endpoint has no release for the disposable tag. Keep the controlled tag and branch disposable after evidence is collected. The APK-only workflow also enforces package.json and Gradle version agreement, so temporary validation tags must update both values together.