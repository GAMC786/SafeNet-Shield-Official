---
name: Secure Dialer integration boundary
description: Constraints for connecting SafeNet to the Secure-Phone-apps dialer project.
---

Secure Dialer is a separate offline Android app, not a SafeNet API. Its published materials state it has no Android INTERNET permission. GitHub also sends `X-Frame-Options: deny` and `frame-ancestors 'none'` for repository pages, so the repository cannot be rendered in an iframe.

CallShield and OpenCallShield are standalone Android apps, not embeddable widgets or hosted lookup APIs. SafeNet uses OpenCallShield's public GitHub JSON list for live lookups; its existing verified offline snapshot remains the fallback when that unsigned list cannot be fetched. OpenCallShield does not provide a report API.

**Why:** An embedded web/API integration would imply capabilities the external apps do not offer and would fail because GitHub blocks framing. The offline fallback remains verified because live OpenCallShield data is unsigned.

**How to apply:** Surface official project websites, repositories, releases, and Obtainium links. Describe SafeNet's OpenCallShield integration as a public JSON feed, not a SpamBlocker API; do not claim either external Android app runs inside SafeNet.
