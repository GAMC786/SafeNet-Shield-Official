---
name: Android gomobile 16 KB alignment
description: Keep SafeNet's Go JNI library compatible with 16 KB Android devices.
---

Pass `-Wl,-z,max-page-size=16384` through `CGO_LDFLAGS` when building the Android gomobile AAR, then inspect every packaged ABI's ELF `PT_LOAD` alignment.

**Why:** The default gomobile `libgojni.so` used 4 KB ELF alignment; 16 KB-capable Pixel devices can reject or fail to load native libraries built that way.

**How to apply:** After changing the Go toolchain or gomobile inputs, verify the generated APK's arm64 `libgojni.so` reports `p_align` of `0x4000` or greater and that APK ZIP alignment also passes at 16 KB.
