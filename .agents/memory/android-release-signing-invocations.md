---
name: Android release signing invocations
description: Release workflows must provide signing inputs to every Gradle invocation that configures the release variant.
---

Every Gradle step that touches the Android release variant must receive the complete signing environment, not only the step that assembles the APK.

**Why:** Gradle configures the release signing guard during later metadata and verification tasks too; a valid signed APK can already exist while a follow-up invocation fails because its signing inputs are missing.

**How to apply:** Keep the keystore path, store password, alias, and key password aligned across release assembly, instrumentation checks, metadata generation, and any later release verification task.