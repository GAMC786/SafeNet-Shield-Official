---
name: GitHub workflow push permissions
description: GitHub Actions workflow files require extra authorization when pushing through Replit's connected GitHub access.
---

Pushing a repository that contains `.github/workflows/*` can be rejected even after ordinary Git authentication succeeds if the connected GitHub authorization lacks workflow permission.

**Why:** GitHub treats creating or updating Actions workflow files as a separately scoped operation.

**How to apply:** Reconnect GitHub through Replit's Connected Services and approve workflow/Actions access before retrying the push; do not interpret a transferred pack as a successful branch update.