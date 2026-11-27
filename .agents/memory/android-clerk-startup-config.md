---
name: Android runtime auth configuration
description: Packaged Android builds need public Clerk and Supabase settings before React mounts.
---

Native APK builds cannot assume GitHub Actions has the Replit Vite variables. Before importing the app, the client must load only public Clerk and Supabase settings from the HTTPS backend, then mount `ClerkProvider`; configuration failures must show a visible retry state rather than leave a blank WebView.

**Why:** The signed APK previously lacked both Clerk and Supabase client settings, so module initialization stopped before React mounted even though APK installation and signing checks passed. The user confirmed the runtime-loaded replacement APK starts successfully.

**How to apply:** Keep `/api/auth/config` unauthenticated, CORS-allowed for Capacitor localhost origins, and limited to publishable values; publish the backend before building a replacement APK.