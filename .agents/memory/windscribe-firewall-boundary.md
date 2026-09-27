---
name: Windscribe firewall boundary
description: Architectural limits of applying SafeNet's packet firewall to imported Windscribe WireGuard tunnels.
---

The stock WireGuard Android GoBackend does not expose an app-level TUN packet-filter hook; it hands the Android VPN descriptor directly to native WireGuard. SafeNet's custom SDNS wrapper is now the packet-level hook for imported Windscribe tunnels. Android passes the restored firewall snapshot into the native Go interceptor at tunnel startup and atomically replaces it on live updates. The interceptor evaluates domain allow/block and keyword rules, DNS access rules, and Prevent DNS Overrides for cleartext DNS on UDP/TCP port 53. Direct external TCP/53 and fragmented DNS packets fail closed while the firewall is enabled because they cannot be safely inspected in the transparent packet path.

**Why:** DNS redirection to an encrypted resolver is not DNS firewall enforcement. Native policy evaluation now exists, but it does not inspect HTTPS, DoH, or DoT, and device-level Windscribe enforcement has not been verified by a real Android tunnel test.

**How to apply:** Keep Windscribe claims scoped to cleartext DNS on UDP/TCP port 53; do not imply HTTPS, DoH, or DoT inspection. Preserve the visible warning that device-level enforcement is unverified until a real Android tunnel test passes, including startup-policy and live-update behavior.