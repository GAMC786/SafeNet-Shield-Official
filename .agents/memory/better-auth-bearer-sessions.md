---
name: Better Auth bearer sessions
description: How SafeNet API middleware should authenticate Better Auth bearer tokens.
---

Application middleware cannot assume that `betterAuthInstance.api.getSession()` processes a raw `Authorization: Bearer` token. The Better Auth bearer plugin converts the token to its signed session cookie inside the Better Auth HTTP handler; app-owned protected routes need their own database-backed bearer lookup or must call the HTTP handler.

**Why:** Android native authentication returns a short-lived one-time code, then stores the exchanged Better Auth session token in encrypted preferences. An initial protected-route check returned 401 because the app middleware bypassed the plugin hook, and the legacy Auth0 middleware also tried to validate the same token.

**How to apply:** When adding bearer-authenticated app endpoints, resolve active Better Auth sessions from the session table before the Auth0 fallback, and skip Auth0 validation once a Better Auth session is attached.
