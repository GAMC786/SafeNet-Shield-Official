---
name: PIN auth status cache
description: Authentication status must not be cached across PIN verification.
---

Authentication-status responses must use no-store semantics on both the server and
client. A cached unauthenticated 304 can make a successfully verified PIN appear
to fail because the UI never observes the regenerated authenticated session.

**Why:** PIN verification regenerates the session, so the response changes
immediately while browser validators may still hold the pre-verification state.

**How to apply:** When changing PIN login or session behavior, verify the
post-verification status request returns fresh authenticated state, not a 304.