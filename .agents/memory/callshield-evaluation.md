---
name: CallShield evaluation
description: Architectural and licensing constraints when considering SysAdminDoc/CallShield for SafeNet call screening.
---

SafeNet remains the Android CallScreeningService. External call-blocker apps such as YACB may inform SafeNet's offline/local-blocking design, but they are not plug-in backends or data dependencies. CallShield is also a standalone MIT-licensed Android application with an on-device screening pipeline and GitHub-hosted feed, not a provider-neutral hosted reputation API. Its bundled data has source-specific licensing and redistribution restrictions, so code reuse and data reuse must be reviewed separately.

**Why:** The repository can provide useful local-screening patterns, but treating it as an API or copying its aggregate database would create integration and provenance risks.

**How to apply:** Keep SafeNet's existing native screening boundary. Treat YACB and similar apps as reference implementations only. Consume CallShield through its signed manifest and hash-verified shards when live, retaining the legacy feed and approved offline snapshot as fail-open fallbacks.

For offline redistribution, the aggregate feed must not be treated as uniformly approved: its source manifest can include non-redistributable inputs. Bundle only rows whose provenance is explicitly approved, and ship attribution plus a hash/version manifest that rejects mutations and downgrades.

**Why:** A mixed-source CallShield snapshot can contain restricted bulk data even when the upstream repository code is MIT-licensed.

**How to apply:** Recheck `source-manifest.json` whenever refreshing the offline snapshot; keep the server and Android copies pinned to the same verified feed version and SHA-256.

In the upstream source-manifest revision reviewed on 2026-09-25, `github_database` is explicitly redistributable under “CallShield database terms.” SafeNet's offline export may include it only when a row has one unique evidence source, its license and attribution exactly match that declaration, and the evidence has not expired. Mixed-source rows and prefixes without item-level evidence remain excluded.

**Why:** The aggregate feed also contains mixed or restricted inputs, so a redistributable flag on one source cannot approve a row that combines it with other provenance.

**How to apply:** Re-fetch and review the source manifest for every refresh; do not treat this reviewed source ID or its approval as permanent.