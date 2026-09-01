---
name: Android release artifact integrity
description: Protects Android releases from silently publishing debug APKs.
---

Release workflows must build and publish an explicitly named signed release APK, and the release verification step must reject debug APK filenames.

**Why:** A tag workflow can pass while publishing `app-debug.apk` when its build job and release job only check for a generic `*.apk`; artifact existence alone does not prove release signing.

**How to apply:** Keep debug builds for pull requests and normal branch pushes, gate release signing on protected credentials, fail fast when the keystore is unavailable, and verify the release asset name before publishing.