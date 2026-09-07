---
name: Clerk WebView proxy origin
description: Native WebView requests through the Clerk proxy need an upstream origin rewrite.
---

The Clerk proxy must rewrite the upstream `Origin` header to the public SafeNet proxy origin for requests originating from a native WebView.

**Why:** Android Capacitor content is served from `https://localhost`; Clerk validates the forwarded browser origin against the public proxy host and returns `origin_invalid` when it receives `https://localhost`, leaving Clerk startup incomplete.

**How to apply:** Preserve the original origin for response CORS, but use the canonical forwarded protocol and host when setting the `Origin` header on the request sent to Clerk.