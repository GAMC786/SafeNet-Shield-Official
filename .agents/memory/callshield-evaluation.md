---
name: CallShield evaluation
description: Architectural and licensing constraints when considering SysAdminDoc/CallShield for SafeNet call screening.
---

CallShield is a standalone MIT-licensed Android application with an on-device screening pipeline and GitHub-hosted feed, not a provider-neutral hosted reputation API. Its bundled data has source-specific licensing and redistribution restrictions, so code reuse and data reuse must be reviewed separately.

**Why:** The repository can provide useful local-screening patterns, but treating it as an API or copying its aggregate database would create integration and provenance risks.

**How to apply:** Keep SafeNet's existing native screening boundary. Consider CallShield-inspired local rules/feed verification only after auditing each source license and preserving fail-open behavior.

For offline redistribution, the aggregate feed must not be treated as uniformly approved: its source manifest can include non-redistributable inputs. Bundle only rows whose provenance is explicitly approved, and ship attribution plus a hash/version manifest that rejects mutations and downgrades.

**Why:** A mixed-source CallShield snapshot can contain restricted bulk data even when the upstream repository code is MIT-licensed.

**How to apply:** Recheck `source-manifest.json` whenever refreshing the offline snapshot; keep the server and Android copies pinned to the same verified feed version and SHA-256.