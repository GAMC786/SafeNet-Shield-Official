---
name: Vite preview cache behavior
description: Development previews can retain stale optimized dependency URLs across workflow restarts.
---

When a fresh preview shows a static loader with 504 Outdated Optimize Dep errors, clear the generated node_modules/.vite cache and restart the workflow; no application dependency change is implied.

**Why:** The preview browser may reuse an older optimized-module URL even after the server has rebuilt its dependency manifest.

**How to apply:** Treat current workflow logs and direct module responses as authoritative, and avoid changing application code to work around stale preview cache state.