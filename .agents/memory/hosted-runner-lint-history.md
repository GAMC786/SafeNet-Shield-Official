---
name: Hosted-runner lint history
description: Durable design rules for the monthly Windows and macOS workflow-lint health record
---

The hosted-runner lint matrix must publish one machine-readable outcome per platform and architecture before the summary job evaluates the aggregate result. Keep a bounded run history with trigger and run metadata.

**Why:** GitHub exposes a matrix job's aggregate result to downstream jobs, not a reliable per-entry outcome. Per-matrix artifacts preserve which runner or architecture regressed, while bounded history keeps the repository signal small.

**How to apply:** Keep history writes behind the monthly schedule or explicit maintainer dispatch condition, preserve the existing schema version when adding fields, and update the matrix outcome artifact contract together with matrix changes.