---
name: Cross-platform CI diagnostics
description: Makes Windows-only test failures actionable when hosted runner logs are unavailable.
---

When a hosted CI connector exposes only a generic failed-step annotation, have the test launcher emit the failing file and captured child-process output as a bounded GitHub error annotation.

**Why:** The hosted GitHub log endpoint may be unavailable even when check status and annotations are readable, making ordinary console output insufficient for diagnosing platform-only failures.

**How to apply:** Keep diagnostics bounded and failure-only; normalize platform-dependent fixture inputs such as CRLF text before parsing them.