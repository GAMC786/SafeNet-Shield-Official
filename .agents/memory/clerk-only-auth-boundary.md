---
name: Clerk-only authentication
description: Authentication boundary after removing App Access Protection and its local session fallback.
---

Clerk is the only active authentication mechanism. App Access Protection, PIN verification/recovery, local authenticated sessions, and PIN-related email delivery are intentionally removed.

**Why:** The user explicitly confirmed that removing App Access Protection means removing the full PIN feature and leaving Clerk as the sole authentication path.

**How to apply:** Keep protected routes, client gating, Android WebView sign-in, and release checks aligned with Clerk. Treat legacy PIN database columns as compatibility data only; they must not be accepted, returned, hashed, verified, or used for authorization.