---
name: Diverged release branch strategy
description: Safe Android release publishing when the workspace history and GitHub main are not fast-forward compatible.
---

When the workspace contains the verified release commit but the configured GitHub `main` branch is an older or diverged history, publish from a versioned release branch and dispatch the signed APK workflow against that branch.

**Why:** Merging an unrelated old `main` line can introduce broad conflicts, while force-pushing it would overwrite remote history. A release branch preserves the verified workspace tree and lets the workflow create the formal release without changing `main`.

**How to apply:** Compare the merge base before pushing. Push the verified commit to a new `release/v<version>` branch, then run `build-apk-only.yml` with that branch as `ref`. Verify the resulting formal release assets and checksum before reporting success.