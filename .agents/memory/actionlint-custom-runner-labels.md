---
name: Actionlint custom runner labels
description: Keeps actionlint useful when workflows intentionally target private self-hosted runners
---

When a workflow intentionally targets a custom self-hosted runner label, declare that label in actionlint's GitHub configuration rather than disabling runner-label validation.

**Why:** actionlint otherwise reports the private label as unknown, which either blocks the validation gate or encourages broad suppression of useful workflow checks.

**How to apply:** keep custom labels in `.github/actionlint.yaml` under `self-hosted-runner.labels`; leave the standard GitHub-hosted and self-hosted labels to actionlint's built-in list.