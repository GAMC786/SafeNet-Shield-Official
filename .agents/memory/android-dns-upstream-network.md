---
name: Android DNS upstream network
description: The DNS-only Android VPN must keep resolver traffic on the physical network instead of recursively routing it through its own virtual DNS interface.
---

The DNS-only VPN should both bind upstream resolver sockets to the current usable non-VPN network and call VpnService.protect before connecting them. The VPN interface may own only the virtual DNS routes; ordinary internet traffic must remain outside the tunnel.

**Why:** On Android, protecting a socket is necessary but can be insufficient after Wi-Fi/mobile-network changes. A resolver socket that follows the VPN's route can make every app appear offline even though the VPN interface is running.

**How to apply:** Preserve the non-VPN network selection for UDP, TCP, DoT, and DoH upstream sockets. Keep the hosted Android smoke test for ordinary HTTPS connectivity and add physical-device evidence when changing routing behavior.