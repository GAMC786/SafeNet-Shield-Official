---
name: Actionlint context compatibility
description: How to handle GitHub Actions context fields that strict actionlint schemas do not recognize
---

When workflow behavior needs a runtime timestamp or similarly dynamic value, capture it in a shell step and pass it through step outputs instead of assuming every documented GitHub context property is recognized by the pinned actionlint schema.

**Why:** The pinned actionlint version can reject a valid-but-newer context property during local and CI linting, preventing the workflow from reaching runtime.

**How to apply:** Prefer stable context fields in expressions; for unsupported dynamic fields, use a bounded shell command with an explicit output and validate the resulting workflow with the repository-pinned actionlint.