---
name: Zero-context Git patches
description: Applying checked-in patches generated with zero lines of unified-diff context.
---

When a patch is generated with `git diff -U0`, use `git apply --unidiff-zero` for forward checks, reverse/idempotence checks, and application. Plain `git apply --check` rejects these hunks even when the target line is an exact match.

When comparing an assembled diff byte-for-byte with a checked-in patch, pin `core.abbrev` to the index-prefix width used by that patch; local and hosted Git defaults can differ.

**Why:** Git rejects zero-context hunks by default as a safety measure, and a different abbreviated object-ID width makes an otherwise equivalent diff fail exact comparison.

**How to apply:** Use `--unidiff-zero` only when the target source revision is pinned and the assembled patch content is verified (for example, by a checksum). Pin `core.abbrev` for deterministic comparisons; do not weaken checks for an unpinned patch.