---
name: Production API public access
description: Native SafeNet builds require an unauthenticated production API origin.
---

Release builds must target a published deployment whose visibility is public. A
password-protected deployment redirects unauthenticated `/api` requests through
Replit Shield, so Android and Windows clients cannot complete API preflight or
authenticate normally.

**Why:** Native clients have no reliable way to supply a Replit deployment
password, and accepting the redirect would ship an unusable client.

**How to apply:** Check deployment visibility before release; change the
published deployment to public and republish before running mobile/desktop
backend validation.