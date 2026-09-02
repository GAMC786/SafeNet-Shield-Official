# Android browser and private-proxy protection

SafeNet's Android VPN is a DNS-only VPN. It routes DNS packets addressed to
SafeNet's virtual IPv4 and IPv6 DNS endpoints, then forwards those queries to
the selected resolver. It does not install a default route for ordinary web
traffic and does not decrypt HTTPS.

## Reported protection states

The APK checks Android's active network capabilities and the SafeNet service
state:

- `protected`: Android identifies SafeNet as the owner of the active VPN path.
- `vpn_replaced`: another VPN owns the active path, or SafeNet was revoked.
- `dns_bypass_possible`: SafeNet is running but Android cannot prove ownership
  of the active path (including older Android releases that hide VPN owner
  identity).
- `protection_unavailable`: SafeNet is not controlling a usable network path.
- `proxy_uninspectable`: the embedded proxy limitation is always reported
  separately from the network-path state.
- `capture_unavailable`: screen/camera capture is unavailable; this belongs to
  the separate consented AI Shield capture state, not DNS protection.

Every status includes a timestamp, an actionable explanation, the covered
scope, and explicit proxy/DoH/HTTPS limitations. The UI polls the native bridge
while the Android surfaces are open so revocation or replacement is not
silently shown as protected.

## What is covered

When `protected` is verified and an app uses system DNS, SafeNet can apply its
existing domain/blocklist behavior to DNS over UDP or TCP, over IPv4 or IPv6.
Resolver connections are protected from looping back through the DNS VPN.
Unsupported or unavailable DNS paths fail closed rather than being reported as
allowed.

## What is not covered

UPX-style private proxies, browser-owned encrypted DNS, HTTPS destinations, and
another app's private VPN tunnel can hide the destination from SafeNet. A
normal APK cannot inspect or block those paths without becoming the active VPN
owner, and SafeNet does not add a second VPN, install certificates, perform
TLS interception, use AccessibilityService, or capture hidden content.

Recovery guidance is to stop the competing VPN, disable the browser's private
proxy/encrypted-DNS mode when appropriate, reconnect SafeNet, and use system
DNS. Screen monitoring is a separate opt-in MediaProjection feature and is not
network interception.

If AI Shield is monitoring a consented visible screen, a high-confidence
finding raises the existing shield event. That configured response is
visibility only for content inside a private browser tunnel; SafeNet cannot
turn that event into a network block without owning and inspecting the
traffic.

## Validation

The Android instrumentation fixtures cover state resolution, fail-closed
ownership decisions, bridge delivery, and the proxy limitation contract.
Device validation still requires a supported Android emulator or device with a
configured SDK. On a target, verify SafeNet is shown as the active VPN, then
repeat with a competing VPN and with a controlled private-proxy/DoH browser
fixture; the expected result is `vpn_replaced` or an explicit
`proxy_uninspectable` limitation rather than a protected claim.