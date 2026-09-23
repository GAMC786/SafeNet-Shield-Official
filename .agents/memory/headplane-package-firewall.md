---
name: Headplane package firewall
description: SafeNet's isolated Headplane companion dependency boundary and runtime configuration constraint.
---

When the workspace package firewall blocks a required Headplane dependency, keep the firewall intact: use a locally built, license-preserving source snapshot with a recorded source commit and a workspace file dependency.

**Why:** The published terminal dependency was blocked by the workspace firewall, while its upstream source built successfully. Bypassing the firewall would weaken the repository's dependency boundary.

**How to apply:** Preserve the upstream license and source provenance beside the vendored package, keep the dependency exports unchanged, and validate the companion with the pinned Node/pnpm toolchain. Headplane's schema also requires `integration.kubernetes.pod_name` even when Kubernetes is disabled, so generated minimal configs must provide a harmless placeholder.