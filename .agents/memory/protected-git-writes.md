---
name: Protected Git writes
description: The explicit ShellExec opt-in required before modifying the workspace Git directory.
---

When ShellExec blocks an authorized Git mutation with a protected `.git` directory warning, rerun only the intended Git command with `DANGEROUSLY_ALLOW_GIT=1`. Do not force-push or broaden the ref being changed.

**Why:** The release branch creation was blocked until the environment's Git-write guard was explicitly enabled.

**How to apply:** For user-authorized commits, branch creation, or pushes, set the guard for that command and keep all other Git operations unchanged.
