---
name: AppLock-Revived integration decision
description: SafeNet's chosen direction for replacing its embedded App Lock.
---

SafeNet should replace its embedded App Lock with an integrated port of AppLock-Revived rather than treating a one-off recovery-screen fix as the final direction.

**Why:** the user explicitly chose AppLock-Revived. It is a standalone Android application, so SafeNet must port the needed implementation and preserve SafeNet-specific identity, permissions, local state, and Supabase email recovery.

**How to apply:** keep the port dependent on the Supabase sign-in migration so the new App Lock retains the correct recovery flow. Do not silently discard existing local passcodes or protected-app selections.
