# Android DNS service boundary

SafeNet's Android app no longer creates or controls a VPN. The Android client
stores the user's selected DNS resolver through the SafeNet server, while
device-wide DNS routing remains an Android Private DNS or separate VPN
provider responsibility.

SafeNet does not inspect traffic from private browser proxies, encrypted DNS,
HTTPS content, or another VPN. Internet Share is an independent Wi-Fi Direct
feature that exposes its own manual proxy and does not depend on SafeNet VPN
state.

## Verification boundary

Android instrumentation should verify that the app starts, the DNS resolver
settings load, and the remaining native features continue to work. It must not
request `android.net.VpnService`, install a VPN service, or report SafeNet as
the owner of an Android VPN.