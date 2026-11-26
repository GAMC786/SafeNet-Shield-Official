---
name: Supabase auth migration target
description: SafeNet's chosen authentication provider after the planned Clerk migration.
---

Use Supabase Auth for Google and email/password sign-in after the planned migration. Preserve existing accounts through verified linking and a legacy-ID mapping; replace App Lock recovery email codes with Supabase email OTP. Keep current Clerk authentication in place until the Supabase project and migration are ready.

**Why:** The user selected Supabase for Google and email/password sign-in, chose to preserve existing accounts rather than start fresh, and approved Supabase email OTP for App Lock recovery.

**How to apply:** Configure Google sign-in and OTP email templates in Supabase, and retain the Clerk-ID mapping for account-owned data and billing. Do not treat Google SHA-1 registration or the Supabase agent plugin as an app auth migration.
