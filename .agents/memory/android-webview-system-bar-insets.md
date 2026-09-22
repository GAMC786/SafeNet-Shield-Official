---
name: Android WebView system-bar insets
description: System-bar inset ownership for SafeNet's fixed web navigation menus.
---

The Android WebView must remain edge-to-edge while the web shell owns status-bar and navigation-bar spacing through its CSS inset variables. Native padding and CSS menu offsets must not both apply the same insets.

**Why:** Applying live Android insets as WebView padding and then using them again for fixed top and bottom menus double-shifts both menus on physical Android devices.

**How to apply:** Keep native inset listeners for the startup and app-lock overlays, but set WebView padding to zero and continue publishing the live inset values to the document root for the web layout.