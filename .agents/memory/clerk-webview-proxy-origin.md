---
name: Clerk WebView proxy origin
description: Native WebView requests through the Clerk proxy need upstream origin rewriting and response CORS restoration.
---

The Clerk proxy must rewrite the upstream `Origin` header to the public SafeNet proxy origin for requests originating from a native WebView, then restore the native origin on the response CORS header.

**Why:** Android Capacitor content is served from `https://localhost`; Clerk validates the forwarded browser origin against the public proxy host and returns `origin_invalid` when it receives `https://localhost`, while reflecting the rewritten origin in CORS would make the browser reject the response.

**How to apply:** Preserve the original origin from the request, use the canonical forwarded protocol and host for Clerk’s upstream `Origin`, and restore the original origin in the proxy response’s CORS headers for known native origins.