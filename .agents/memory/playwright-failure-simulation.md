---
name: Playwright failure simulation
description: Keeps browser failure-path tests strict without confusing expected transport failures with application console errors
---

When a browser test must verify client-side rollback and a clean console, prefer a successful HTTP response with an invalid response body to simulate a client request failure. Chromium reports non-2xx responses fulfilled by Playwright as `Failed to load resource` console errors, even when the application handles the rejection correctly.

**Why:** A literal mocked 500 response can make a correctly handled mutation fail the test's no-console-errors assertion because the browser emits its own network diagnostic.

**How to apply:** Keep the response JSON content type, delay it long enough to observe optimistic UI state, make the body invalid so the client's response parsing rejects, and assert the rollback, user-facing error, page errors, and console errors.