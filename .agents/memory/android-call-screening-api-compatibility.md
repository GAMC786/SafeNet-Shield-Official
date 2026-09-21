---
name: Android call-screening API compatibility
description: Keeps call-screening role requests compatible with the pinned Android SDK while retaining a settings fallback
---

Use `RoleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING)` for the native role request and launch generic default-app settings for the fallback; do not depend on `Intent.EXTRA_ROLE_NAME`.

**Why:** The pinned Android SDK rejected `Intent.EXTRA_ROLE_NAME` during the native compile even though the role itself is available through `RoleManager`.

**How to apply:** Keep the role request and settings fallback separate, and validate both the Java source contract and the hosted native compile before tagging an Android release.