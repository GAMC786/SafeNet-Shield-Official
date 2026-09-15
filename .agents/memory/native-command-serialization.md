---
name: Native command serialization
description: Cross-feature ordering rules for Capacitor VPN, WireGuard, and Internet Share calls
---

Native SafeNet plugin operations must use one shared command queue across all React hooks, not one queue per hook instance.

**Why:** Dashboard, DNS, and Internet Share can be mounted together; separate queues allow status refreshes and start/stop transitions to race and leave Android VPN ownership inconsistent.

**How to apply:** Route every SafeNet VPN, WireGuard, and Internet Share plugin call through the shared queue, including status reads that follow mutations.