---
name: Published Stripe connector auth
description: Token selection needed for Stripe connector access in Replit published environments.
---

Published server builds must use the deployment-scoped connector token when both a source-repl token and a deployment token are injected.

**Why:** A published process can inherit `REPL_IDENTITY`, but using it against the connector service resolves the development binding and reports Stripe as not connected even when the deployment has access.

**How to apply:** Prefer `WEB_REPL_RENEWAL` with the `depl` scheme in production; retain `REPL_IDENTITY` with the `repl` scheme for development.