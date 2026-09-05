---
name: Android PIN session cookies
description: Why packaged Android PIN authentication depends on WebView third-party cookie support.
---

The packaged Android app loads locally but authenticates against the production HTTPS API, so its session cookie is cross-site from the WebView's perspective. Keep third-party cookie acceptance enabled unless Android authentication is migrated away from cookie sessions.

**Why:** Production can return a successful PIN verification while the following authentication-status request remains unauthenticated if the WebView rejects the session cookie.

**How to apply:** Any Android WebView, Capacitor-origin, cookie-policy, API-origin, or PIN-authentication change must verify that a successful PIN request is followed by an authenticated status request in the same installed app.