# SafeNet DNS - Native Build Instructions

This document provides instructions for building the SafeNet Android APK.

## Prerequisites

### For Android APK:
- Android Studio installed
- Android SDK Command-line Tools
- Java JDK 17+
- Gradle

## Building Android APK

The APK packages the SafeNet DNS frontend only. It must connect to a separately
running SafeNet DNS backend over HTTPS. The backend must be publicly reachable
from the Android device.

### Step 0: Prepare the Android SDK

Set `ANDROID_SDK_ROOT` (or `ANDROID_HOME`) to the Android SDK directory, then
run the shared setup command from the project root:

```bash
ANDROID_SDK_ROOT="$HOME/Android/Sdk" npm run android:setup
```

On Windows, run the native PowerShell setup command from the project root. For
the default Android Studio SDK location:

```powershell
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
npm run android:setup:windows
```

If Android Studio has already created `android\local.properties` with an
`sdk.dir`, the environment variable can be omitted:

```powershell
npm run android:setup:windows
```

The command reads the compile SDK, target SDK, and build-tools versions from
`android/variables.gradle`, accepts the SDK licenses, installs the required
packages, and verifies that they are present. If Android Studio has already
created `android/local.properties` with an `sdk.dir`, the environment variable
can be omitted:

```bash
npm run android:setup
```

If a pinned package is unavailable, setup stops and names the missing package;
do not change a version in the setup command. Update `android/variables.gradle`
when intentionally changing the Android toolchain.

The Windows CI lane runs `scripts/test-setup-android-sdk.ps1` on
`windows-latest` with a mocked `sdkmanager`. It verifies that the pins from
`android/variables.gradle` reach the command, including SDK paths escaped in
`android/local.properties`, and checks the remediation shown for missing
`sdkmanager` and unavailable packages. To run the same check locally on
Windows:

```powershell
pwsh -NoProfile -File scripts/test-setup-android-sdk.ps1
```

### Step 1: Build the web application
```bash
MOBILE_API_URL=https://your-server.example.com ./scripts/build-android.sh
```

This validates the backend URL, builds the web application with that API origin,
checks its settings endpoint, and syncs the latest assets into the Android
project. The URL must be a public HTTPS origin without a path or query. Do not
use `localhost` or a private network address: on the phone, `localhost` refers
to the phone itself.

### Optional Step 1a: Configure the SafeNet WireGuard gateway

WireGuard controls are included only when the APK build receives a complete
SafeNet-operated gateway and peer configuration. The values are validated by
the official WireGuard parser; an incomplete build keeps the controls hidden
instead of starting an arbitrary or competing VPN. Supply these values through
the environment or equivalent Gradle properties before running the Android
build:

```bash
export SAFENET_WIREGUARD_GATEWAY_OWNER=SafeNet
export SAFENET_WIREGUARD_GATEWAY_ENDPOINT=wireguard.example.com:51820
export SAFENET_WIREGUARD_PEER_PUBLIC_KEY='<gateway-public-key>'
export SAFENET_WIREGUARD_CLIENT_PRIVATE_KEY='<client-private-key>'
export SAFENET_WIREGUARD_CLIENT_ADDRESS=10.66.0.2/32
export SAFENET_WIREGUARD_ALLOWED_IPS='0.0.0.0/0, ::/0'
export SAFENET_WIREGUARD_DNS_SERVERS=10.66.0.1
export SAFENET_WIREGUARD_PERSISTENT_KEEPALIVE=25
```

Do not commit the client private key or put it in frontend assets. The WireGuard
backend owns Android's single VPN permission while the tunnel is active, so
SafeNet DNS and WireGuard start requests reject conflicting ownership. The
Quick Settings tile follows whichever SafeNet tunnel is active.

The release workflows read these same eight names from protected GitHub
repository secrets: `SAFENET_WIREGUARD_GATEWAY_OWNER`,
`SAFENET_WIREGUARD_GATEWAY_ENDPOINT`, `SAFENET_WIREGUARD_PEER_PUBLIC_KEY`,
`SAFENET_WIREGUARD_CLIENT_PRIVATE_KEY`, `SAFENET_WIREGUARD_CLIENT_ADDRESS`,
`SAFENET_WIREGUARD_ALLOWED_IPS`, `SAFENET_WIREGUARD_DNS_SERVERS`, and
`SAFENET_WIREGUARD_PERSISTENT_KEEPALIVE`. The release job fails before
packaging if any value is missing, and the private key is passed only to
Gradle's native build configuration, never to the web build or frontend
assets. A configured app status reports the SafeNet gateway owner, endpoint,
peer public key, allowed IPs, and DNS servers; it never reports the client
private key.

### Step 2: Open in Android Studio
```bash
npx cap open android
```

### Step 3: Build APK in Android Studio
1. In Android Studio, go to **Build > Build Bundle(s) / APK(s) > Build APK(s)**
2. The APK will be generated in `android/app/build/outputs/apk/debug/`

### Alternative: Build from command line
```bash
cd android
./gradlew assembleDebug
```

The debug APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`

Gradle verifies that the validated mobile build marker exists. If it asks you to
run `scripts/build-android.sh`, repeat Step 1 before building the APK.

For the deterministic native validation used before release packaging, run this
from the project root after Step 1:

```bash
npm run android:check
```

This runs `assembleDebug` with the pinned Android SDK and forces Java
compilation. It includes `SafeNetVpnPlugin.java` and `SafeNetVpnService.java`,
so resolver address-family forwarding must compile before a release APK is
built. The command reads the SDK path from `ANDROID_SDK_ROOT`, `ANDROID_HOME`,
or `android/local.properties`; do not commit `android/local.properties`.

### For Release APK (signed):
1. Generate a keystore:
```bash
keytool -genkey -v -keystore safenet-dns.keystore -alias safenet -keyalg RSA -keysize 2048 -validity 10000
```

2. Build release:
```bash
cd android
./gradlew assembleRelease
./gradlew assembleReleaseAndroidTest
```

The release verification APK has an explicit, stable name:
`android/app/build/outputs/apk/release/app-release.apk`. Do not point the
smoke lane at a wildcard or at `app-debug.apk`.
The instrumentation package is built separately as
`android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk`.

### Repeatable Android DNS smoke test

Run the smoke lane on one attached Android device or emulator after building
the signed release APK:

```bash
./scripts/android-smoke-test.sh \
  --apk android/app/build/outputs/apk/release/app-release.apk \
  --test-apk android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk \
  --serial emulator-5554
```

The script uninstalls the previous app, installs exactly `app-release.apk`,
records device and network details, and runs
`SafeNetVpnInstrumentationTest`. The instrumentation covers the EULA gate,
the Android VPN permission flow, the DNS-only `/32` route, ordinary HTTPS
connectivity, DoH fallback, DoT fallback, and clean VPN shutdown. Resolver
and ordinary connectivity endpoints can be changed with the
`ANDROID_SMOKE_*` environment variables. The default DoT fallback is
`cloudflare-dns.com` so TLS certificate hostname validation is exercised.

Evidence is written to
`android/app/build/reports/android-smoke/latest/`. A failed run is classified
as `ENETUNREACH`, `UNRELATED_NETWORK_FAILURE`, or `NON_NETWORK_FAILURE` in
`failure-category.txt`; `ENETUNREACH` is the original “network unreachable”
regression and must not be treated as a generic resolver failure.

Tagged releases run the hosted public-network DNS smoke lane plus a required
startup gate on a dedicated self-hosted Linux runner with the
`android-writable-system` label. The startup gate installs the signed APK,
captures the native startup surface, and verifies that the WebView transitions
beyond it. That runner uses an AOSP ATD API 35 image with KVM, `adb root`,
writable system overlays, and passwordless `sudo` for the controlled resolver
fixture. Provision it once with:

```bash
ANDROID_SDK_ROOT="$HOME/Android/Sdk" ./scripts/provision-android-runner.sh
```

Run `./scripts/provision-android-runner.sh --check` from the registered
GitHub Actions runner account to verify its capabilities. The release startup
job will wait for, and then require, this labeled runner; it will not substitute
a hosted image for the real-device startup check. Manual and scheduled non-tag
checks retain the hosted validation lane. A local run needs an Android SDK,
`adb`, and an attached target; a host DNS lookup is not a substitute for these
VPN or startup checks.

---

## Project Structure for Native Builds

```
project/
├── android/                 # Android project (generated by Capacitor)
│   ├── app/
│   │   ├── build/
│   │   │   └── outputs/
│   │   │       └── apk/    # APK files here
│   │   └── src/
│   └── gradle/
├── build/
│   └── icon.png             # Android/web icon source
├── dist/
│   └── public/             # Built web assets
├── capacitor.config.ts     # Capacitor configuration
```

---

## Customizing App Icons

### For Android:
Place icons in `android/app/src/main/res/` directories:
- `mipmap-hdpi/ic_launcher.png` (72x72)
- `mipmap-mdpi/ic_launcher.png` (48x48)
- `mipmap-xhdpi/ic_launcher.png` (96x96)
- `mipmap-xxhdpi/ic_launcher.png` (144x144)
- `mipmap-xxxhdpi/ic_launcher.png` (192x192)

---

## Troubleshooting

### Android Build Issues:
- Ensure Android SDK is properly configured
- Run `npx cap doctor` to diagnose issues
- Check `android/local.properties` for correct SDK path
- If the app shows **Server connection unavailable**, confirm the backend URL is
  reachable from the phone and rebuild with the correct `MOBILE_API_URL`
- Re-run the Android build script before creating every APK so stale web assets
  are not left in `android/app/src/main/assets/public`

## Automated Builds with GitHub Actions

This project includes a GitHub Actions workflow that automatically builds the Android APK.

### Setup:
1. Push this project to a GitHub repository
2. The workflow runs automatically on every push to `main`

### Download builds:
1. Go to your repository on GitHub
2. Click the **Actions** tab
3. Click the latest workflow run
4. Scroll down to **Artifacts**
5. Download **SafeNet-DNS-Android** (APK)

### Create a Release with downloads:
1. Create a git tag: `git tag v1.0.0`
2. Push the tag: `git push origin v1.0.0`
3. GitHub will automatically create a Release with these Android downloads attached:
   - `app-release.apk` — the signed app APK
   - `app-release-androidTest.apk` — the matching instrumentation test APK
   - `app-release.apk.sha256` — the signed app APK checksum
   - `app-release-androidTest.apk.sha256` — the instrumentation APK checksum

The two APKs and their checksums are built and verified by the same tagged
workflow run. For release verification, download both APKs and their matching
checksum files from the GitHub Release. Check the instrumentation APK checksum
from the directory containing the downloaded files:

```bash
sha256sum --check app-release-androidTest.apk.sha256
```

Then pass both APKs to the smoke-test script:

```bash
./scripts/android-smoke-test.sh \
  --apk app-release.apk \
  --test-apk app-release-androidTest.apk \
  --serial emulator-5554
```

The instrumentation APK is also retained as the
`SafeNet-DNS-Android-instrumentation` Actions artifact for tagged workflow
runs, but the GitHub Release downloads above are the stable handoff for
real-device verification.

---

## Keeping SafeNet-Shield-Official synchronized

`GAMC786/SafeNet-Shield` is the source repository. The
`Sync SafeNet-Shield-Official` workflow runs after every push to its `main`
branch, and can also be started manually from the Actions tab. It advances the
`sync/from-safenet-shield` branch in
`GAMC786/SafeNet-Shield-Official` and creates or updates a pull request against
the official repository's `main` branch.

The workflow requires an `OFFICIAL_REPO_TOKEN` Actions secret in the source
repository. GitHub reserves secret names beginning with `GITHUB_`, so the
workspace token may not use its `GITHUB_RELEASE_TOKEN` name when it is added to
Actions. Use a fine-grained token scoped only to
`GAMC786/SafeNet-Shield-Official` with:

- **Contents:** Read and write
- **Pull requests:** Read and write
- **Workflows:** Read and write
- **Metadata:** Read-only

No source-repository administration or Actions-management access is needed. The
token is not used for source pull requests, and it must not be printed in
workflow output.

Reviewers must merge the synchronization pull request before changes become
part of the official `main` branch. The workflow never force-pushes the sync
branch and never writes directly to official `main`. If someone changes the
sync branch independently, the workflow stops rather than overwriting that
work; resolve the branch manually before running synchronization again. The
existing replication pull request is independent of this recurring sync branch
and is not modified by the workflow.

### Release workflows and tags

The build workflow is present in both repositories after a synchronization
pull request is merged. It builds validation artifacts for branches and pull
requests. A `v*` tag runs the Android release job in the repository where that
tag was created and attaches the APK artifacts to a GitHub Release.

To publish an official release:

1. Merge the reviewed synchronization pull request into
   `GAMC786/SafeNet-Shield-Official/main`.
2. Ensure the `package.json` version and the release version agree.
3. Create and push the matching tag from the official repository, for example:
   ```bash
   git tag -a v1.0.0 -m "SafeNet DNS v1.0.0"
   git push origin v1.0.0
   ```
4. Download the APK artifacts from the resulting official GitHub Release.

Tags created only in the source repository are not copied automatically and do
not publish an official release. This keeps official releases tied to reviewed
content on the official `main` branch.

---

## Version Information
- App ID: com.safenet.dns
- App Name: SafeNet DNS
- Web Directory: dist/public
