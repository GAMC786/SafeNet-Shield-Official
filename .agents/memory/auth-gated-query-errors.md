---
name: Auth-gated query errors
description: Prevent protected-query cache state from blocking public app surfaces before authentication.
---

Treat loading, error, and fetching state from protected queries as actionable only while the current session is eligible to run those queries.

**Why:** A disabled TanStack Query observer can still reflect an error cached by another mounted observer using the same key. A protected Settings request therefore made a public dashboard show a false server-unavailable screen even though the global observer was disabled.

**How to apply:** When a shared query key is used by both public and protected surfaces, combine its status with the current authentication condition before feeding it into app-wide loading or error boundaries. Browser tests should mock the real unauthenticated HTTP error rather than returning protected data.