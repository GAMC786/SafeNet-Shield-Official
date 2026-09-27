---
name: Private Go runtime copies
description: Use a writable private GOROOT for SafeNet's CLOCK_BOOTTIME patch.
---

The workspace Go toolchain is package-managed and its GOROOT sources are read-only. A private copy must be made writable before editing runtime assembly; never patch the active installation.

**Why:** Copying the package-managed tree with preserved permissions caused runtime patch writes and cleanup to fail.

**How to apply:** Copy the pinned toolchain into a separate build cache, add owner-write permission recursively, verify the target differs from `go env GOROOT`, and compile the patched target sources.