---
name: Google speed test integration
description: How SafeNet links to Google’s official consumer speed test without pretending a public API exists.
---

Use Google Fiber’s official speed-test page as an external launch target alongside SafeNet’s ISP-based Measure Your Network UI. Do not build against an assumed Google JSON endpoint; Google does not document a public speed-test API, and its page disallows embedding.

**Why:** The official Google Fiber test is a hosted consumer page, not a public application API, and it returns same-origin framing restrictions.

**How to apply:** Keep the Google launch URL external and preserve the ISP profile plus local diagnostic measurements in the SafeNet UI.