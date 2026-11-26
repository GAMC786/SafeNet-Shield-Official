---
name: Anonymous access boundary
description: The current SafeNet authentication decision and compatibility limits for legacy account fields.
---

SafeNet's core app and general API remain public. Sign-in is required for user-owned Control D, NextDNS, and Family DNS account management, plus App Lock recovery and billing flows. Derive the owner from the authenticated Clerk identity on the server, never from request data. Legacy PIN columns are compatibility data only and must not be accepted, returned, hashed, verified, or used for authorization.

**Why:** Account-specific provider credentials, recovery, and billing must be tied to the right user, while basic SafeNet features should remain usable without an account.

**How to apply:** Keep startup, core protection, Android WebView checks, and general browser smoke coverage public. Protect user-owned DNS provider credentials, App Lock recovery, and billing operations with Clerk, and scope every account read or mutation to the authenticated user.