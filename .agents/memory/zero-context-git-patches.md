---
name: Zero-context Git patches
description: Applying checked-in patches generated with zero lines of unified-diff context.
---

When a patch is generated with `git diff -U0`, use `git apply --unidiff-zero` for forward checks, reverse/idempotence checks, and application. Plain `git apply --check` rejects these hunks even when the target line is an exact match.

**Why:** Git rejects zero-context hunks by default as a safety measure; this is independent of whether the base file contents match.

**How to apply:** Use this option only when the target source revision is pinned and the assembled patch content is verified (for example, by a checksum). Do not weaken checks for an unpinned patch.