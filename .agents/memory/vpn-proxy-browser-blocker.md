---
name: VPN and proxy browser blocker
description: SafeNet's dedicated policy for preventing selected VPN or proxy browser apps from launching on Android.
---

SafeNet blocks selected VPN/proxy browser packages at the Android foreground-app boundary through the opt-in Accessibility service. The policy is device-local and separate from App Lock; it does not inspect, decrypt, or filter traffic inside an encrypted proxy or another VPN.

**Why:** Android Private DNS cannot see a browser's private DNS, proxy destination, tunnel payload, or direct IP connections. Launch blocking is the reliable control available on unmanaged devices without claiming unsupported traffic inspection.

**How to apply:** Keep app selection explicit, preselect only recognizable VPN/proxy browser labels or package names, require the user to enable Accessibility, and clearly state that the feature blocks launches rather than tunnel traffic. Stronger anti-bypass enforcement requires managed-device/device-owner controls.