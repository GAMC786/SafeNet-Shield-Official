---
name: Android release artifact integrity
description: Protects Android releases from silently publishing debug APKs.
---

Release workflows must build and publish an explicitly named signed release APK, and the release verification step must reject debug APK filenames.

**Why:** A tag workflow can pass while publishing `app-debug.apk` when its build job and release job only check for a generic `*.apk`; artifact existence alone does not prove release signing.

**How to apply:** Keep debug builds for pull requests and normal branch pushes, gate release signing on protected credentials, fail fast when the keystore is unavailable, and verify the release asset name before publishing.

Hosted emulator action scripts must use a single shell-safe command and avoid Bash-only options in the inline `script` input.

**Why:** `reactivecircus/android-emulator-runner` invokes its inline script through `/usr/bin/sh`; multiline continuations and `set -o pipefail` were passed through incompatibly and blocked an otherwise valid release.

**How to apply:** Keep strict Bash behavior inside the invoked `.sh` file, but pass the command as one line in the action input and let the script return the smoke result.