---
name: RevenueCat Amazon D8 exclusion
description: Google Play-only Android builds can fail in D8 because RevenueCat resolves its optional Amazon store module.
---

For Google Play-only Android builds using RevenueCat hybrid common, exclude both the optional RevenueCat Amazon store module and its Amazon Appstore SDK at Android root subproject configuration scope.

**Why:** The Amazon SDK can contain bytecode rejected by the pinned hosted D8 toolchain. Excluding only the direct SDK at the app module may leave `purchases-store-amazon` resolved through the RevenueCat library project.

**How to apply:** Keep the Google Play RevenueCat dependency, but apply both exclusions to every Android subproject configuration before compiling.