---
name: Post-merge setup retries
description: How to distinguish a transient post-merge runner disconnect from a broken setup hook.
---

When post-merge setup reports `UNEXPECTED_DISCONNECT`, rerun the configured hook through the post-merge runner before changing its commands. A successful retry indicates the hook and its workflow reconciliation are healthy; keep the script idempotent, non-interactive, fail-fast, and executable.

**Why:** The runner can disconnect independently of the setup process. Treating a transient transport failure as a script defect risks introducing unnecessary changes to a working dependency restore, type-check, and build sequence.

**How to apply:** First inspect the configured path and logs, then retry with the existing timeout. Only modify the script or timeout when the retry reproduces a deterministic command failure or timeout.