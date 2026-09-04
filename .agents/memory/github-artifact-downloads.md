---
name: GitHub artifact downloads
description: Documents the Actions artifact download limitation seen through the connected GitHub client.
---

The connected GitHub API client may successfully list workflow runs, jobs, and artifacts while returning 403 for artifact archives and job logs. It can also lag behind the live branch ref and return Cloudflare HTML for repository content writes. An opaque `GH_TOKEN` environment handoff to the GitHub CLI can still download artifacts and perform narrowly scoped repository operations without exposing the credential. Public Actions pages can expose the rendered run metadata while REST check-run output leaves `GITHUB_STEP_SUMMARY` as null; use the hosted log archive for summary-writing evidence and independently verify downloaded files.

**Why:** Release validation needs to inspect the actual uploaded files, and metadata alone cannot prove that an artifact is downloadable or contains useful diagnostics.

**How to apply:** Keep the credential out of logs and chat, use the connected API for Actions metadata, cross-check exact branch state with the CLI when refs disagree, and use the CLI only as a narrowly scoped fallback when connector archive, log, or repository endpoints are blocked.