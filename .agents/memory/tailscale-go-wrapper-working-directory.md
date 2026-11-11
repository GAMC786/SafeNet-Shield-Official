---
name: Tailscale Android Go working directory
description: How the Tailscale Android Makefile selects its custom Go toolchain.
---

The Tailscale Android Makefile builds its tool `PATH` from the process working directory. Invoking it with `make -C` can leave the caller's working directory in effect and select the wrong Go toolchain; enter the Tailscale submodule before invoking Make.

Some workspace snapshots contain the pinned Tailscale source without nested `.git` metadata. In that case, validate the expected submodule commit from the parent repository's gitlink instead of requiring `git rev-parse` inside the source directory.

**Why:** A hosted release build selected an incompatible Go toolchain and failed before generating the AAR. The source snapshot can also omit nested Git metadata even though the parent repository still pins the exact submodule commit.

**How to apply:** Any wrapper that builds the Android AAR should change into the Tailscale submodule before running Make. Accept materialized source without nested Git metadata only when the parent gitlink matches the expected commit.