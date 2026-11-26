---
name: Supabase auth migration target
description: SafeNet's chosen authentication provider after the planned Clerk migration.
---

Use Supabase Auth for Google and email/password sign-in after the planned migration. Preserve existing accounts through verified linking and a legacy-ID mapping; keep current Clerk authentication in place until the Supabase project and migration are ready.

**Why:** The user selected Supabase for Google and email/password sign-in, and chose to preserve existing accounts rather than start fresh.

**How to apply:** Configure Google sign-in in Supabase as part of the migration, and retain the Clerk-ID mapping for account-owned data and billing. Do not treat Google SHA-1 registration or the Supabase agent plugin as an app auth migration.
