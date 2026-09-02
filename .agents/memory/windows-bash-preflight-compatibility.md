---
name: Windows Bash preflight compatibility
description: Cross-platform shell behavior that affects Android preflight tests and readiness checks on hosted Windows runners.
---

Windows-hosted Git Bash can rewrite leading-slash command arguments, use Windows-style temporary paths, and emit warnings into merged command output. Tests that exercise a later shell branch should inject uniquely named command stubs instead of relying on PATH shadowing of native tools.

**Why:** A preflight cleanup regression test initially failed before reaching cleanup because the hosted Windows shell selected native OpenSSL and later treated shell warnings as the entire emulator state.

**How to apply:** Keep production temp paths normalized when `cygpath` is available, parse readiness by looking for a valid state line rather than exact raw output, and give test-only tool seams explicit command names.