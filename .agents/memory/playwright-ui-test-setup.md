---
name: Playwright UI test setup
description: Environment and fixture requirements for browser-level checks in this project
---

Browser-level checks use Playwright's managed Chromium and must have both the browser binary and the host libraries required to launch it. API interception fixtures must return every field required by the shared Zod response schema, even when the component only reads a subset.

**Why:** The Nix workspace does not provide a browser executable or all Chromium libraries by default, and incomplete mocked responses can make the app render its connection error instead of the page under test.

**How to apply:** Install Chromium before running UI checks, install the matching Linux browser libraries in environments that need local execution, and keep route fixtures aligned with `shared/routes.ts` response schemas.