---
name: Production API public access
description: Native SafeNet builds require an unauthenticated production API origin.
---

Release builds must target a published deployment whose visibility is public. A
password-protected deployment redirects unauthenticated `/api` requests through
Replit Shield, so Android and Windows clients cannot complete API preflight or
authenticate normally. Native APK configuration must use the stable production
origin, never an auth-smoke override that could point at a Replit preview host.

**Why:** Native clients have no reliable way to supply a Replit deployment
password, and accepting the redirect would ship an unusable client. Embedding a
preview origin also makes sign-in depend on a temporary development URL.

**How to apply:** Check deployment visibility before release; change the
published deployment to public and republish before running mobile/desktop
backend validation. Keep the APK's API origin separate from test-only auth
origins and assert that release configuration names the published production
host.