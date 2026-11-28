---
name: Supabase auth migration target
description: SafeNet's chosen authentication provider after the planned Clerk migration.
---

Use Supabase Auth for Google and email/password sign-in after the planned migration. Preserve existing accounts through verified linking and a legacy-ID mapping; replace App Lock recovery email codes with Supabase email OTP. Use a separate Supabase project for development and leave the production project untouched during testing. Keep current Clerk authentication in place until the Supabase project and migration are ready.

**Why:** The user selected Supabase for Google and email/password sign-in, chose to preserve existing accounts rather than start fresh, approved Supabase email OTP for App Lock recovery, and chose an isolated test project.

**How to apply:** Route development builds to the test project and production builds to the existing project; configure Google sign-in and OTP email templates per project, and retain the Clerk-ID mapping for production account-owned data and billing. Do not treat Google SHA-1 registration or the Supabase agent plugin as an app auth migration.

**PKCE callback constraint:** Supabase OAuth completion must happen in the same browser and device that started the sign-in because the verifier is stored locally. An embedded preview and a separately opened browser may not share it.

**Why:** Supabase rejects a callback that cannot retrieve the original PKCE verifier, even when the Google provider and redirect URL are configured correctly.

**How to apply:** Test web OAuth by starting and completing the flow in one browser context; do not copy or reopen the callback URL elsewhere.

**Native callback matching:** Add the app deep link to the active Supabase project's Auth URL Configuration, and make the `redirectTo` URL match the allowlisted URI. If the allowlist contains only a bare callback, avoid appending unused query parameters to the normal native sign-in callback.

**Why:** Supabase redirects to its Site URL when the requested `redirectTo` does not match an allowed redirect URL; Google Cloud's OAuth redirect URI does not replace Supabase's app redirect allowlist.

**How to apply:** For Android OAuth, verify the exact callback host and URI in the Supabase project used by the production API. Use a wildcard only when dynamic callback parameters are required.
