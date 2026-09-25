---
name: GitHub connector response bodies
description: One-shot response-body handling for GitHub connector proxyFetch in CodeExecution.
---

Read response bodies exactly once. For API responses, call `await response.text()` and then `JSON.parse(text)` when JSON is expected; retain the text for a bounded error preview. Avoid calling `.json()` and then falling back to `.text()` because response streams are one-shot and the second read can raise `TypeError: Body is unusable`.

**Why:** A GitHub inspection helper consumed the body while parsing JSON, then retried by reading it again for error handling. This produced an unusable-body error instead of the original API response.

**How to apply:** In CodeExecution with GitHub `proxyFetch`, read `.text()` once, parse that cached string, and include the HTTP status with a bounded parse error. Do not retry by re-reading the same response.