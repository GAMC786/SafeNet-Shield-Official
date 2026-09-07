---
name: Android Clerk startup configuration
description: Packaged Android builds need runtime Clerk configuration when CI does not inject Vite public variables.
---

Native APK bundles may not receive the browser build's `VITE_CLERK_PUBLISHABLE_KEY`. The client must load the public Clerk key and proxy URL from the HTTPS backend before mounting `ClerkProvider`, and render a visible configuration error instead of throwing during module startup.

**Why:** A missing compile-time public key causes a blank WebView even though the APK, backend, and Android smoke installation checks can all succeed.

**How to apply:** Keep `/api/auth/config` unauthenticated and CORS-allowed for the packaged origin; republish the backend before building a replacement APK.