---
name: Android physical connectivity recovery
description: Physical-device recovery smoke uses public resolvers because emulator fixture addressing is not reachable from phones
---

Physical Android recovery checks must use reachable public resolver endpoints; the local DNS fixture's `10.0.2.2` address is an emulator-only route. Keep physical target discovery strict and classify missing, offline, or emulated targets as device-access blocks rather than application failures.

**Why:** A phone attached to a dedicated runner does not share the emulator host network namespace, so fixture-based resolver setup can produce false infrastructure failures before the network-loss behavior is exercised.

**How to apply:** Run the signed recovery instrumentation on a runner labeled for physical Android devices, toggle airplane mode in the test, and publish both normalized access/application status and raw logcat/network evidence.

Representative OEM coverage should use one dedicated runner label per phone profile, and the runner must verify its manufacturer and Android version before starting the smoke. A missing, offline, emulated, or mismatched target is device access failure rather than application evidence.

**Why:** Multiple USB targets or a phone assigned to the wrong OEM lane can produce misleading VPN ownership and WebView timing results while still looking like a successful ADB connection.

**How to apply:** Keep the Pixel, Samsung, and Motorola profiles independently visible with fail-fast disabled; preserve one profile-specific artifact and summary for every matrix job, including blocked jobs.

WireGuard diagnostic evidence should be parsed as a whitelist of category tokens (HANDSHAKE, ROUTE, DNS, NAT, plus the existing setup categories), never by copying a matched log message. Synthetic instrumentation should emit category-only fixture markers so parser regressions are deterministic without exposing endpoints or credentials.

**Why:** Physical-device logcat can include resolver endpoints, peer configuration, and exception text; copying arbitrary failure lines into a release summary can turn useful diagnostics into a secret-disclosure path.

**How to apply:** Keep the fixture test credential-free in its emitted log line and have the runner record one bounded status per category. Treat missing fixture markers as an application validation failure.