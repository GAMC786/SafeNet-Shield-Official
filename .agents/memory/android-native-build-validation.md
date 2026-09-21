---
name: Android native build validation
description: The Android project requires an explicitly provisioned SDK for deterministic Java compilation.
---

The Android SDK is not guaranteed to be installed in the development workspace. Native changes should be validated through the pinned SDK setup and a forced debug assembly before any release APK packaging.

**Why:** A web or TypeScript pass can hide Java compilation errors in Capacitor and VPN code, while an unconfigured local Gradle invocation fails before compiling any native source.

**How to apply:** Keep the SDK versions sourced from the Android Gradle pins, use the shared setup path for hosted validation, and run the native assembly gate before release signing or upload.

Hosted Android proof runs can also fail inside the SDK setup action before APK packaging, leaving the smoke job skipped even when TypeScript, workflow lint, and application tests pass.

**Why:** Resolver evidence cannot be produced without a packaged APK and instrumentation APK, so a green application test suite does not prove the hosted smoke path ran.

**How to apply:** Classify SDK setup failures as infrastructure blockers, preserve the run URL and failed step, and retry the hosted job before attributing the result to resolver behavior.

The hosted release compiler can still catch Java-only errors that local TypeScript and application tests cannot see; a successful signed APK requires the native compile gate to pass before smoke or publication.

**Why:** The release reached Android packaging only after correcting an invalid Java multi-catch in the Internet Share manager.

**How to apply:** Treat the hosted native compile result as authoritative when the local workspace has no Android SDK, and do not bypass it to publish an APK.

Release instrumentation compilation exercises the full Android test-source graph, including retained UI tests that may be excluded from the normal app build. Removing a native feature must not leave active test calls pointing at helpers hidden inside obsolete comment blocks.

**Why:** The hosted release test compile caught both a missing standard-library import and retained non-VPN UI-test helpers that had been commented out during VPN removal.

**How to apply:** Use the hosted release-instrumentation preflight as the source-of-truth check for Android test Java, and keep retained instrumentation helpers active when their tests remain enabled.