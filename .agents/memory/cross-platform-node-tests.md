---
name: Cross-platform Node test discovery
description: Keeps npm test discovery independent of Windows shell glob behavior.
---

CI test commands should discover test files in Node rather than relying on shell wildcard expansion.

**Why:** The same npm test command can pass on Linux while failing on a Windows runner when the shell and Node receive wildcard arguments differently.

**How to apply:** Use a small Node launcher that recursively collects the intended test files and invokes the Node test runner with explicit paths.