---
name: Android physical connectivity recovery
description: Physical-device recovery smoke uses public resolvers because emulator fixture addressing is not reachable from phones
---

Physical Android recovery checks must use reachable public resolver endpoints; the local DNS fixture's `10.0.2.2` address is an emulator-only route. Keep physical target discovery strict and classify missing, offline, or emulated targets as device-access blocks rather than application failures.

**Why:** A phone attached to a dedicated runner does not share the emulator host network namespace, so fixture-based resolver setup can produce false infrastructure failures before the network-loss behavior is exercised.

**How to apply:** Run the signed recovery instrumentation on a runner labeled for physical Android devices, toggle airplane mode in the test, and publish both normalized access/application status and raw logcat/network evidence.

WireGuard diagnostic evidence should be parsed as a whitelist of category tokens (HANDSHAKE, ROUTE, DNS, NAT, plus the existing setup categories), never by copying a matched log message. Synthetic instrumentation should emit category-only fixture markers so parser regressions are deterministic without exposing endpoints or credentials.

**Why:** Physical-device logcat can include resolver endpoints, peer configuration, and exception text; copying arbitrary failure lines into a release summary can turn useful diagnostics into a secret-disclosure path.

**How to apply:** Keep the fixture test credential-free in its emitted log line and have the runner record one bounded status per category. Treat missing fixture markers as an application validation failure.