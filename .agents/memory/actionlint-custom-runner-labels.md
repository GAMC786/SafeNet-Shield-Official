---
name: Actionlint custom runner labels
description: Keeps actionlint useful when workflows intentionally target private self-hosted runners
---

When a workflow intentionally targets a custom self-hosted runner label, or a newer hosted label unknown to the pinned actionlint release, declare that label in actionlint's GitHub configuration rather than disabling runner-label validation.

**Why:** actionlint otherwise reports the label as unknown, which either blocks the validation gate or encourages broad suppression of useful workflow checks. Pinned actionlint versions can lag GitHub's hosted-runner label catalog.

**How to apply:** keep intentional labels in `.github/actionlint.yaml` under `self-hosted-runner.labels` with a comment explaining why; leave labels recognized by the pinned release to actionlint's built-in list.