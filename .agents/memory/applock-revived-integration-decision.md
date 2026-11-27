---
name: AppLock-Revived integration decision
description: SafeNet's chosen direction for replacing its embedded App Lock.
---

SafeNet should replace its embedded App Lock with an integrated port of AppLock-Revived rather than treating a one-off recovery-screen fix as the final direction.

**Why:** the user explicitly chose AppLock-Revived. It is a standalone Android application, so SafeNet must port the needed implementation and preserve SafeNet-specific identity, permissions, local state, and Supabase email recovery.

**How to apply:** prioritize the AppLock-Revived port before completing Supabase sign-in setup. Preserve SafeNet's local passcode and protected-app selections, and keep email recovery behind its existing boundary without embedding provider credentials.

**Why:** the user changed the order after repeated recovery crashes and wants the App Lock replacement tested before finishing Supabase setup.
