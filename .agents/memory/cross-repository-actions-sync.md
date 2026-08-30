---
name: Cross-repository Actions sync
description: GitHub-specific constraints for safely pushing a source snapshot into a review branch in another repository.
---

Cross-repository synchronization workflows must disable persisted
`actions/checkout` credentials before supplying a separate destination token.

**Why:** The checkout action stores the job's built-in `GITHUB_TOKEN`; without
`persist-credentials: false`, Git can prefer that token and authenticate the
cross-repository push as `github-actions[bot]` even when another authorization
header is supplied.

**How to apply:** Keep the job token read-only, disable persisted checkout
credentials, and expose the destination token only to the push and pull-request
steps.

GitHub Actions secret names cannot begin with `GITHUB_`.

**Why:** GitHub reserves that prefix and rejects attempts to create repository
secrets with it.

**How to apply:** Use a destination-specific secret name and document the
minimum repository permissions it needs.

Review branches copied from repositories with unrelated histories need a commit
that descends from the destination base branch.

**Why:** GitHub cannot open a pull request when the base and head have no common
ancestor.

**How to apply:** Build append-only snapshot commits whose tree matches the
source and whose ancestry includes the destination base. Validate the previous
snapshot before appending so independent branch changes stop the workflow.