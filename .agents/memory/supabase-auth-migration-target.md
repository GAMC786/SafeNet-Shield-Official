---
name: Supabase auth migration target
description: SafeNet's chosen authentication provider after the planned Clerk migration.
---

Use Supabase Auth for Google and email/password sign-in after the planned migration. Preserve existing accounts through verified linking and a legacy-ID mapping; replace App Lock recovery email codes with Supabase email OTP. Use a separate Supabase project for development and leave the production project untouched during testing. Keep current Clerk authentication in place until the Supabase project and migration are ready.

**Why:** The user selected Supabase for Google and email/password sign-in, chose to preserve existing accounts rather than start fresh, approved Supabase email OTP for App Lock recovery, and chose an isolated test project.

**How to apply:** Route development builds to the test project and production builds to the existing project; configure Google sign-in and OTP email templates per project, and retain the Clerk-ID mapping for production account-owned data and billing. Do not treat Google SHA-1 registration or the Supabase agent plugin as an app auth migration.
