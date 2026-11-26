---
name: Android Google sign-in boundary
description: Google authentication requirements for SafeNet's embedded Android app.
---

Do not run Google OAuth from SafeNet's embedded Android WebView. Use Clerk's native Android Google sign-in flow instead; it requires Native API registration and Google Android/Web OAuth clients configured for the production Clerk instance.

**Why:** Google blocks OAuth from embedded WebViews, so the React web sign-in flow cannot reliably authenticate from the packaged app.

**How to apply:** Before changing Android sign-in, verify the production Clerk Native API and Google provider setup. Never put Google client secrets in app code or ask for them in chat.
