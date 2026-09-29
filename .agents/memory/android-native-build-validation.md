---
name: Android native build validation
description: The Android project requires an explicitly provisioned SDK for deterministic Java compilation.
---

The Android SDK is not guaranteed to be installed in the development workspace. Native changes should be validated through the pinned SDK setup and a forced debug assembly before any release APK packaging.

**Why:** A web or TypeScript pass can hide Java compilation errors in Capacitor and VPN code, while an unconfigured local Gradle invocation fails before compiling any native source.

**How to apply:** Keep the SDK versions sourced from the Android Gradle pins, use the shared setup path for hosted validation, and run the native assembly gate before release signing or upload.

Large multi-ABI gomobile links can exceed this workspace's `/tmp` quota even when `df` reports free space; set both `TMPDIR` and `GOTMPDIR` to runner or workspace storage.

**Why:** The four-ABI Tailscale AAR failed while writing intermediates under `/tmp`, then completed after Go scratch output moved to the workspace volume.

**How to apply:** Set these variables on the `make libtailscale` subprocess, not only on the Gradle caller.

Hosted Android proof runs can also fail inside the SDK setup action before APK packaging, leaving the smoke job skipped even when TypeScript, workflow lint, and application tests pass.

**Why:** Resolver evidence cannot be produced without a packaged APK and instrumentation APK, so a green application test suite does not prove the hosted smoke path ran.

**How to apply:** Classify SDK setup failures as infrastructure blockers, preserve the run URL and failed step, and retry the hosted job before attributing the result to resolver behavior.

The hosted release compiler can still catch Java-only errors that local TypeScript and application tests cannot see; a successful signed APK requires the native compile gate to pass before smoke or publication.

**Why:** The release reached Android packaging only after correcting an invalid Java multi-catch in the Internet Share manager.

**How to apply:** Treat the hosted native compile result as authoritative when the local workspace has no Android SDK, and do not bypass it to publish an APK.

Compose and Kotlin build configuration can be validated during Gradle configuration even when the local workspace has no Android SDK, but source compilation still requires the hosted pinned-SDK lane.

**Why:** Gradle loaded the Kotlin and Compose plugins locally, then stopped before Kotlin compilation because the SDK directory was absent.

**How to apply:** Do not treat plugin configuration or web tests as native proof; run the hosted Android compile and UI lane before publishing a Compose-based APK.

Release instrumentation compilation exercises the full Android test-source graph, including retained UI tests that may be excluded from the normal app build. Removing a native feature must not leave active test calls pointing at helpers hidden inside obsolete comment blocks.

**Why:** The hosted release test compile caught both a missing standard-library import and retained non-VPN UI-test helpers that had been commented out during VPN removal.

**How to apply:** Use the hosted release-instrumentation preflight as the source-of-truth check for Android test Java, and keep retained instrumentation helpers active when their tests remain enabled.

The official APK workflow must be dispatched from a branch containing the validated workspace tree; the official repository's default branch can lag behind the current app source.

**Why:** A successful workflow on the official default branch can produce an older APK, while a source branch release can expose Java-only compilation gaps before publication.

**How to apply:** Publish the exact validated commit to a dedicated official release branch, dispatch the signed workflow against that branch, and verify the formal release tag and checksum assets afterward.

Vendored strongSwan menu handlers must compare non-final `R.id` values at runtime instead of using them in `switch` labels; `android.nonFinalResIds=false` did not restore compile-time IDs for this library.

**Why:** A forced Android rebuild with regenerated resources still rejected `case R.id.*` labels as non-constant; replacing them with `if` comparisons passed strongSwan Java compilation.

**How to apply:** Avoid resource-ID switch cases when updating bundled strongSwan Java sources, and validate with the Android native compile gate.

Pass variable overrides to Android `ndkBuild.arguments` as `NAME=value`, not compiler-style `-DNAME=value`; the latter reaches GNU make as an unsupported option.

**Why:** The pinned NDK's bundled make rejected `-DSAFENET_SDNS_*` during its configure probe, while Android.mk consumes those names as make variables.

**How to apply:** Use plain assignments for values read by Android.mk and reserve `-D` for compiler flags inside `LOCAL_CPPFLAGS` or `LOCAL_CFLAGS`.