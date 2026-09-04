---
name: Development schema sync
description: Runtime verification can use a database schema older than the current shared TypeScript schema.
---

When validating an unmerged branch, apply additive schema changes to the development database before restarting or exercising the app.

**Why:** The workflow can start with the new Drizzle query shape while the existing development table still lacks newly declared columns, causing startup scheduler failures or API 500 responses.

**How to apply:** Confirm the development schema before runtime checks, use the supported database schema-sync path, and then restart the workflow once the schema matches the shared definitions.