---
name: Gmail connector authentication boundary
description: Distinguishes Gmail mailbox API access from end-user Google identity authentication.
---

The connected Gmail integration can send SafeNet recovery and security messages, but it is not an end-user Google sign-in provider.

**Why:** Treating the mailbox connection as user authentication would create a false security boundary and could expose app access to the wrong account model.

**How to apply:** Keep Gmail for server-side notifications. Use a dedicated supported identity/OAuth flow for Google account sign-in, with local PIN recovery remaining independent.