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