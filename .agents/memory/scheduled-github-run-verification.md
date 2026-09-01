---
name: Scheduled GitHub run verification
description: Constraints for validating workflow steps that are gated on GitHub's schedule event.
---

Scheduled workflow behavior must be verified from the default branch after merge; a manual workflow dispatch has a different event name and skips steps gated on `github.event_name == 'schedule'`.

**Why:** GitHub's workflow dispatch API cannot create a schedule event, so a successful manual run is not evidence that schedule-only alert or recovery steps executed.

**How to apply:** Check the default-branch workflow revision and query scheduled runs before attempting live issue-history verification. Do not manufacture schedule evidence by changing production timing or directly editing alert history.

In this project, the attached GitHub integration may be able to read repository
state and manage issues while lacking permission to publish commits; its proxy
can also reject paths under `.github/workflows`. Treat those as external access
blockers and obtain a maintainer merge before dispatching or interpreting live
workflow evidence.

**Why:** A manually created branch or issue cannot establish that the default
branch workflow and its repository permissions work for maintainers.

**How to apply:** Verify the workflow file and branch revision through the
public repository or an authorized maintainer channel, and do not create alert
issues by hand to simulate the action.