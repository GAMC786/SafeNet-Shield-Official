---
name: CallShield evaluation
description: Architectural and licensing constraints when considering SysAdminDoc/CallShield for SafeNet call screening.
---

CallShield is a standalone MIT-licensed Android application with an on-device screening pipeline and GitHub-hosted feed, not a provider-neutral hosted reputation API. Its bundled data has source-specific licensing and redistribution restrictions, so code reuse and data reuse must be reviewed separately.

**Why:** The repository can provide useful local-screening patterns, but treating it as an API or copying its aggregate database would create integration and provenance risks.

**How to apply:** Keep SafeNet's existing native screening boundary. Consider CallShield-inspired local rules/feed verification only after auditing each source license and preserving fail-open behavior.