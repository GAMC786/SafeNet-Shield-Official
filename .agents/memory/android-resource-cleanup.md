---
name: Android resource cleanup
description: Native Android removals must include cleanup of obsolete resource entries before hosted release builds.
---

When removing an Android service or feature, remove its unused resource entries in the same change. A resource can remain in `res/values` after all code references disappear, and the hosted AAPT toolchain still parses and validates it during release-related compilation.

**Why:** A tagged release exposed an obsolete Accessibility string resource that was no longer used by the app; hosted AAPT rejected the stale entry and stopped the build before APK publication.

**How to apply:** Search Android resources for the removed component's names and validate the resource XML before pushing a release tag. Prefer deleting unused entries rather than keeping compatibility strings without a current consumer.