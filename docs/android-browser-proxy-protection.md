# Android DNS service boundary

SafeNet's Android app uses a DNS-only `VpnService` when the user enables DNS
filtering. Android routes DNS requests to SafeNet's virtual resolver address;
SafeNet evaluates the encrypted firewall snapshot and forwards allowed queries
to the active plain DNS, DNS over HTTPS, or DNS over TLS resolver.

SafeNet does not inspect traffic from private browser proxies, encrypted DNS,
HTTPS content, or another VPN. The service filters DNS requests only and does
not route arbitrary application payloads. Internet Share is an independent
Wi-Fi Direct feature that exposes its own manual proxy.

## Verification boundary

Android instrumentation should verify that the app starts, the DNS resolver
settings load, and the remaining native features continue to work. The signed
package should contain the DNS-only service and `BIND_VPN_SERVICE`; it must not
contain the removed WireGuard service or VPN tile.