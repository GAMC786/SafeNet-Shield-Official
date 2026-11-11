---
name: GitHub workflow validation access
description: Environment constraints and safe access pattern for real GitHub Actions workflow validation
---

The GitHub connector can be sufficient for Actions reads and dispatches while Git pushes still lack the `workflow` scope needed to update `.github/workflows`. Reauthorize the GitHub connection for that scope, retry the push once, and verify the target ref before dispatching.

**Why:** Workflow-file pushes were rejected until the GitHub OAuth connection was reauthorized with the workflow scope; after reconnect, the fast-forward push succeeded.

**How to apply:** Fetch and pin the expected remote commit, confirm a fast-forward, push only the intended branch and tag, then confirm both refs and the resulting Actions run. Never expose the credential or use it for unrelated repository changes.

On September 8-9, 2026, the connector still allowed ref/blob reads but rejected Git tree creation and repository Contents writes with 403/404 responses. The available `GITHUB_RELEASE_TOKEN` was also rejected by GitHub for Git transport; do not repeatedly retry it. A maintainer-authorized Git push remains the required handoff for workflow changes and runner validation.