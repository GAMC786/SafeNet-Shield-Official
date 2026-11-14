---
name: Secure Dialer integration boundary
description: Constraints for connecting SafeNet to the Secure-Phone-apps dialer project.
---

Secure Dialer is a separate offline Android app, not a SafeNet API. Its published materials state it has no Android INTERNET permission. GitHub also sends `X-Frame-Options: deny` and `frame-ancestors 'none'` for repository pages, so the repository cannot be rendered in an iframe.

**Why:** An embedded web/API integration would imply capabilities the external app does not offer and would fail because GitHub blocks framing.

**How to apply:** Surface the official project website, repository, releases, and Obtainium links. Do not describe Secure Dialer as part of SafeNet or claim SafeNet can control its features.
