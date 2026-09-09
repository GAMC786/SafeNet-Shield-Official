---
name: Anonymous access boundary
description: The current SafeNet authentication decision and compatibility limits for legacy account fields.
---

SafeNet is intentionally public: the client mounts directly without Clerk configuration or sign-in, and API routes do not require a user session. Legacy PIN and session database columns are compatibility data only; they must not be accepted, returned, hashed, verified, or used for authorization.

**Why:** The user explicitly superseded the earlier Clerk-only decision and requires no sign-in anywhere in the app.

**How to apply:** Keep startup, Android WebView checks, browser smoke coverage, and API tests anonymous. Do not reintroduce Clerk providers, sign-in routes, auth gates, or local session fallbacks unless the user explicitly changes this requirement.