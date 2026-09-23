---
name: Android physical runner preflight
description: Prevent physical-device validation from waiting indefinitely when GitHub has no online runner with the required Android label.
---

The workflow should check for an online self-hosted runner carrying the required physical-device label before scheduling a device job. If none is available, skip the device job and publish bounded BLOCKED evidence from a hosted runner.

**Why:** GitHub can report zero self-hosted runners while a label-gated job remains queued, which produces no result or usable evidence for a release decision.

**How to apply:** Keep runner availability checks separate from ADB/device checks; the first classifies runner infrastructure, while the device job classifies missing or unusable phones.