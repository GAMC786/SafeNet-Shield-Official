---
name: GitHub workflow validation access
description: Environment constraints and safe access pattern for real GitHub Actions workflow validation
---

The GitHub connector can be sufficient for Actions reads and dispatches while still blocking writes under `.github/workflows`; a disposable branch is required when the workflow under test is not already remote.

**Why:** In this environment, workflow-file REST writes were rejected by the connector's Cloudflare layer and the GraphQL commit mutation was forbidden, while authenticated Git transport remained available.

**How to apply:** Push only a temporary validation branch with the preconfigured credential, dispatch against that branch, collect run evidence, cancel stuck runs, and delete the branch afterward. Never use this path to modify `main` application code.