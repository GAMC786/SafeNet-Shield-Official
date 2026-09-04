---
name: GitHub private npm lockfiles
description: GitHub-hosted Actions cannot resolve Replit-only tarball URLs recorded in package-lock files.
---

GitHub-hosted Actions cannot resolve Replit package-firewall tarball URLs recorded in a package-lock file; release lockfiles must use a registry reachable from the hosted runner.

**Why:** A tagged Android/Windows release failed during `npm ci` before any build because the lockfile pointed to `package-firewall.replit.local`.

**How to apply:** Before triggering a GitHub release, check the lockfile for Replit-only resolved URLs and normalize them to a public registry or another runner-reachable source.