---
name: Supabase auth migration target
description: SafeNet's chosen authentication provider after the planned Clerk migration.
---

Use Supabase Auth for Google sign-in after the planned migration. Keep the current Clerk authentication in place until the Supabase project and migration are ready.

**Why:** The user selected Supabase as the target provider for Google sign-in after migration.

**How to apply:** Configure Google sign-in in Supabase as part of the migration; do not treat the Google SHA-1 registration or the Supabase agent plugin as an app auth migration.
