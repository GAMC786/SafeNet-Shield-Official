---
name: Persistent form drafts
description: User-entered drafts across the DNS, DDNS, Firewall, and Antivirus pages.
---

Unsaved form values should use browser-local persistence, while submitted settings, toggles, and entities should continue using their existing server or native persistence.

**Why:** React component state is discarded when a window closes or a route remounts, so users otherwise lose partially completed security configuration.

**How to apply:** Preserve the complete draft object and the edit target/dialog context; clear it only after a successful save or an explicit form cancellation. Test through a real reload/return flow.