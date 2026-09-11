---
name: WireGuard release secret boundary
description: Documents the separate GitHub Actions secret requirements for protected Android WireGuard releases.
---

Tagged Android release validation requires the complete SafeNet WireGuard configuration in GitHub Actions repository secrets; Replit environment secrets do not satisfy those workflow inputs.

**Why:** The release must not produce an APK with missing or guessed gateway credentials, resolver settings, or tunnel parameters.

**How to apply:** Before retagging a release, verify the eight `SAFENET_WIREGUARD_*` repository secret names exist in GitHub Actions. Never paste their values into chat or replace them with placeholders.