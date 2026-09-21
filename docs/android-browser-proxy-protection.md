# Android DNS service boundary

SafeNet's Android app uses Android Private DNS when the user enables SafeNet
Private DNS. Android applies the selected DNS-over-TLS hostname at the system
level; SafeNet opens the Android setting and reports active only when the
configured hostname matches the selected compatible resolver.

SafeNet does not inspect traffic from private browser proxies, HTTPS content, or
another VPN. Private DNS encrypts DNS resolution only and does not route
arbitrary application payloads. Internet Share is an independent Wi-Fi Direct
feature that exposes its own manual proxy.

## Verification boundary

Android instrumentation should verify that the app starts, the DNS resolver
settings load, and the remaining native features continue to work. The signed
package must not contain a DNS VPN service, `BIND_VPN_SERVICE`, the removed
WireGuard service, or a VPN tile.