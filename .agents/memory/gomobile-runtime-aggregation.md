---
name: SafeNet Local VPN Go runtime
description: Keep SafeNet Local VPN's packet engine and DNSCrypt resolver in one Android AAR.
---

Bind the SafeNet Local VPN packet engine and DNSCrypt resolver into one gomobile AAR. Separate gomobile AARs each include the same `go.Seq` Java classes and `libgojni.so`, which causes duplicate-class and native-library conflicts.

**Why:** The Local VPN uses both gVisor packet forwarding and DNSCrypt; keeping their Go bindings together avoids duplicate Java and JNI runtime classes. Also, `go mod tidy` can remove `x/mobile` when gomobile is only installed separately, and gomobile bind then rejects the staged module.

**How to apply:** When adding another Go-backed Android feature, include it in the Local VPN AAR or verify it does not package a second Go runtime. Keep gomobile and gobind as module tools before binding; on Linux, mask false `xcrun` detection and place Go temporary files outside a size-limited `/tmp`.
