# Android Speed Test versus Cloudflare verification

Date: 2026-09-22

## Scope

The required comparison is a packaged SafeNet Android build against
`speed.cloudflare.com` on the same physical device over both Wi-Fi and
cellular networks.

## Source and artifact identity

- Source commit: `f3ab68dfc78a44701f267c80eb4c14e3b6380073`
- Source package version: `1.0.88`
- Speed-test engine: `@cloudflare/speedtest` `1.14.0`
- SafeNet upload endpoint: `https://speed.cloudflare.com/__up`
- Android flow: Cloudflare's default measurement sequence, with a bounded
  elapsed-time upload recovery only when Android WebView omits upload timing.
- Exact signed release APK for source commit: `NOT_AVAILABLE_IN_WORKSPACE`

## Physical-device evidence

The cloud workspace has no attached Android target:

```text
adb devices -l
List of devices attached
```

No physical-device runner or speed-test evidence workflow is available in the
checked-out project. Therefore the following measurements are intentionally not
recorded:

| Network | SafeNet latency | Cloudflare latency | SafeNet download | Cloudflare download | SafeNet upload | Cloudflare upload | Discrepancy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Wi-Fi | NOT_RECORDED | NOT_RECORDED | NOT_RECORDED | NOT_RECORDED | NOT_RECORDED | NOT_RECORDED | NOT_EVALUATED |
| Cellular | NOT_RECORDED | NOT_RECORDED | NOT_RECORDED | NOT_RECORDED | NOT_RECORDED | NOT_RECORDED | NOT_EVALUATED |

This is an access limitation, not a pass: the task's real-network Android
comparison remains unverified.

## Automated checks completed

- `npm run check` — passed.
- `UI_TEST_PORT=4174 npm run test:ui -- --test-name-pattern='Measure Your Network'` —
  passed. These checks use mocked Cloudflare transfer timing and are not a
  substitute for the required physical-device comparison.
- `android/gradlew -p android tasks --quiet` — passed, but no device was
  connected and no exact signed release APK was available for installation.

## Conclusion

`BLOCKED`: no latency, download, upload, or discrepancy claim is made for
Wi-Fi or cellular networks. A separately connected physical-device runner and
the signed APK built from the source commit are required to complete this
verification.