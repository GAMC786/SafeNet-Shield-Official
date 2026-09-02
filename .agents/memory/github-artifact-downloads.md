---
name: GitHub artifact downloads
description: Documents the Actions artifact download limitation seen through the connected GitHub client.
---

The connected GitHub API client may successfully list workflow runs, jobs, and artifacts while returning 403 for artifact archives and job logs. An opaque `GH_TOKEN` environment handoff to the GitHub CLI can still download the artifact without exposing the credential.

**Why:** Release validation needs to inspect the actual uploaded files, and metadata alone cannot prove that an artifact is downloadable or contains useful diagnostics.

**How to apply:** Keep the credential out of logs and chat, use the connected API for metadata, and use the CLI only as a narrowly scoped download fallback when the connector blocks archive/log endpoints.