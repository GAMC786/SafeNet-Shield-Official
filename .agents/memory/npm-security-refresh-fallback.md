---
name: Npm security refresh fallback
description: How to validate dependency security updates when Replit's npm audit or newly published tarballs are temporarily unavailable.
---

If Replit’s npm audit endpoint is unavailable, do not treat the failed audit request as evidence that the dependency refresh failed. Verify the resolved package names and versions in every discovered lockfile, and confirm the installed tree is internally valid.

**Why:** The package firewall can return an upstream error for the audit endpoint independently of normal package metadata, and newly published transitive tarballs can briefly lag behind metadata.

**How to apply:** Attempt the ecosystem audit command first. If it fails at the service boundary, use a structured lockfile scan for the reported vulnerable pairs and validate the installed tree. Retry missing tarballs before narrowly pinning the immediately preceding safe release.