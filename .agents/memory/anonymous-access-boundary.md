---
name: Anonymous access boundary
description: The current SafeNet authentication decision and compatibility limits for legacy account fields.
---

SafeNet's general app and API remain public. Only Control D account-management routes require an authenticated Clerk identity; derive the owner from that identity on the server, never from request data. Legacy PIN columns are compatibility data only and must not be accepted, returned, hashed, verified, or used for authorization.

**Why:** The user approved sign-in specifically for connecting to and managing each user's Control D account, while requiring all other SafeNet features to remain public.

**How to apply:** Keep startup, Android WebView checks, browser smoke coverage, and non-Control-D APIs public. Protect Control D credentials and management routes with Clerk, and scope every read or mutation to the authenticated user.