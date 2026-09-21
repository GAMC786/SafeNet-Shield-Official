---
name: Workflow dispatch input budget
description: GitHub Actions workflow_dispatch input-count constraint affecting manual validation lanes.
---

GitHub Actions permits at most ten workflow_dispatch inputs. When a manual validation lane needs another toggle, prefer an existing compatible gate or a separate workflow rather than making the workflow invalid.

**Why:** actionlint rejects workflows with more than ten dispatch inputs before any job can run.

**How to apply:** Run actionlint after changing workflow inputs, and keep physical-device validation controls aligned with the workflow's input budget.