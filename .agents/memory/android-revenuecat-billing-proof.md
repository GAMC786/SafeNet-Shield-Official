---
name: Android RevenueCat billing proof
description: Constraints for proving native Android purchases, restores, and server entitlements.
---

A real Android purchase proof must run the signed release APK on a Play-enabled device or emulator with a configured license-tester account. The ordinary hosted `google_apis` emulator can validate the WebView and Clerk session but cannot prove a Google Play purchase dialog.

**Why:** RevenueCat's native purchase flow depends on Google Play availability and account/product configuration; a mocked bridge or non-Play emulator can produce false confidence while the server entitlement remains unverified.

**How to apply:** Keep billing validation behind an explicit workflow input and a dedicated Play-runner label. Require the signed `app-release.apk`, carry the authenticated Clerk session into the WebView, perform purchase or restore through the native bridge, and poll the authenticated billing status endpoint until `linked` and `hasEntitlement` are both true.

GitHub assigns `runs-on` jobs before their steps execute, so a missing self-hosted label cannot produce a fast failure from inside the billing script. Run a hosted inventory and fixture preflight first, then make the Play job depend on that success.

**Why:** Without a hosted preflight, a manual billing validation can remain queued indefinitely when the dedicated runner is offline or the Clerk session fixture is absent.

**How to apply:** Check for an online, idle runner carrying `android-play-billing` and validate the Clerk storage-state fixture on a hosted runner. Keep the self-hosted proof job gated on both preflight and signed APK build success.