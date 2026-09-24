---
name: Tailscale Android Go working directory
description: How the Tailscale Android Makefile selects its custom Go toolchain.
---

The Tailscale Android Makefile builds its tool `PATH` from the process working directory. Invoking it with `make -C` can leave the caller's working directory in effect and select the wrong Go toolchain; enter the Tailscale submodule before invoking Make.

**Why:** A hosted release build selected an incompatible Go toolchain and failed before generating the AAR. Running the Makefile from the submodule produced the AAR successfully.

**How to apply:** Any wrapper that builds the Android AAR should change into the Tailscale submodule before running Make, and release CI should keep a real hosted compilation step.