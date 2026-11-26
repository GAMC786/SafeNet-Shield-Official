---
name: Native command serialization
description: Cross-feature ordering rules for Capacitor VPN, WireGuard, and Internet Share calls
---

Native SafeNet plugin operations must use one shared command queue across all React hooks, not one queue per hook instance. The Local VPN-to-Private-DNS mode switch must wait for Android to confirm the VPN stopped before exposing Private DNS controls.

**Why:** Dashboard, DNS, and Internet Share can be mounted together; separate queues allow status refreshes and start/stop transitions to race and leave Android VPN ownership inconsistent. Entering Private DNS before Local VPN shutdown is confirmed can leave the network path in a failed transition.

**How to apply:** Route every SafeNet VPN, WireGuard, Internet Share, AI Shield, APK scanner, firewall-sync, and status call through the shared queue, including reads that follow mutations. Await a positive stopped status before switching resolver modes, and keep failed commands from poisoning later work.

Phone controls must not report success until Android confirms the native state transition. If a service start fails, catch lifecycle exceptions, publish the error through status, and keep the UI error visible until a later successful state update or retry.

**Why:** An accepted foreground-service request can still fail before the VPN is active, and optimistic “connected” state hides that failure; a fast status poll can also erase the only useful error message.

**How to apply:** Confirm VPN start/stop state before resolving toggle actions, handle permission cancellation as a normal rejected operation, and clear a displayed failure only after a successful retry or confirmed active state.