---
name: SMS contact import boundary
description: User's expected behavior for importing phone contacts into Junkboy SMS filtering.
---

For Junkboy SMS Filter, import all phone numbers saved in Android Contacts, including Google-synced entries, into the local allowlist instead of requiring manual sender entry. Contact numbers stay on-device; no Google sign-in or contact upload is needed.

**Why:** The user asked to import saved Google phone entries rather than adding contacts manually.

**How to apply:** Request contacts permission only when the user starts an import. Let imported numbers bypass local junk rules, and provide refresh and clear controls.
