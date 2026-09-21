---
name: OneSignal environment split
description: OneSignal status can differ between the workspace preview and the published SafeNet deployment.
---

Treat workspace and published OneSignal checks as separate environments. A successful local proxy response does not prove the production deployment has a valid OneSignal connection.

**Why:** The workspace returned a connected status while the public production endpoint continued returning HTTP 401 and the older 503 response.

**How to apply:** Verify both endpoints after connecting or publishing, and do not report push alerts as fixed until the production endpoint returns the connected status.