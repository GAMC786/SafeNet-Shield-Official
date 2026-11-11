---
name: Android gomobile runtime aggregation
description: Avoid duplicate gomobile Java and JNI runtimes in Android apps.
---

Bind all Go packages required by one Android app into a single gomobile AAR. Separate gomobile AARs each include the same `go.Seq` Java classes and `libgojni.so`, which causes duplicate-class and native-library conflicts.

**Why:** Adding the SafeNet packet-forwarder as a separate AAR conflicted with the existing Tailscale Go runtime during Android packaging; cached stripped outputs can also leave stale Java bindings after a new unstripped AAR is built.

**How to apply:** When adding another Go-backed Android feature, include its Go package in the existing app-level gomobile bind, invalidate stale stripped outputs, and verify the final packaged Java API.
