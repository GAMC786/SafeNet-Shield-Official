# SafeNet DNS - Native Build Instructions

This document provides instructions for building native installers for Android (APK) and Windows (MSI).

## Prerequisites

### For Android APK:
- Android Studio installed
- Android SDK Command-line Tools
- Java JDK 17+
- Gradle

### For Windows MSI:
- Node.js 22+
- Windows OS (or Wine on Linux/macOS)
- Visual Studio Build Tools (for native modules)

---

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

Tagged releases run the same script on a dedicated self-hosted Linux runner
with the `android-writable-system` label. That runner uses an AOSP ATD API 35
image with KVM, `adb root`, writable system overlays, and passwordless `sudo`
for the controlled resolver fixture. Provision it once with:

```bash
ANDROID_SDK_ROOT="$HOME/Android/Sdk" ./scripts/provision-android-runner.sh
```

Run `./scripts/provision-android-runner.sh --check` from the registered
GitHub Actions runner account to verify its capabilities. The release job will
wait for, and then require, this labeled runner; it will not substitute a
hosted image that cannot install the temporary system CA. Manual and scheduled
non-tag checks retain the hosted validation lane. A local run needs an Android
SDK, `adb`, and an attached target; a host DNS lookup is not a substitute for
these VPN checks.

---

## Building Windows MSI

The MSI packages the web frontend and loads it from a local `file://` URL. It
must be built with a separately running SafeNet DNS backend over HTTPS.

### Step 1: Build the web application
```bash
DESKTOP_API_URL=https://your-server.example.com ./scripts/build-windows.sh
```

This validates the backend URL, builds the web application with that API origin,
and creates the Windows installer. The URL must be a public HTTPS origin
without a path or query.

### Alternative: Run Electron Builder manually
```bash
VITE_API_URL=https://your-server.example.com npm run build
npx electron-builder --win --x64 --publish never
```

### Output Files:
- MSI installer: `dist-electron/SafeNet DNS Setup X.X.X.msi`
- NSIS installer: `dist-electron/SafeNet DNS Setup X.X.X.exe`

### For specific targets only:
```bash
# MSI only
npx electron-builder --win msi

# NSIS only
npx electron-builder --win nsis
```

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
├── electron/
│   ├── main.cjs            # Electron main process (CommonJS)
│   └── preload.cjs         # Electron preload script (CommonJS)
├── build/
│   ├── icon.ico            # Windows icon
│   ├── icon.icns           # macOS icon
│   └── icon.png            # Linux icon
├── dist/
│   └── public/             # Built web assets
├── dist-electron/          # Electron build output
├── capacitor.config.ts     # Capacitor configuration
└── electron-builder.yml    # Electron Builder configuration
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

### For Windows/macOS/Linux:
Place icons in `build/` directory:
- `icon.ico` - Windows (256x256 recommended)
- `icon.icns` - macOS
- `icon.png` - Linux (512x512 recommended)

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

### Windows Build Issues:
- Install Windows Build Tools: `npm install --global windows-build-tools`
- Ensure you have sufficient disk space
- Run as Administrator if permission issues occur

---

## Automated Builds with GitHub Actions

This project includes a GitHub Actions workflow that automatically builds APK and MSI files.

### Setup:
1. Push this project to a GitHub repository
2. The workflow runs automatically on every push to `main`

### Download builds:
1. Go to your repository on GitHub
2. Click the **Actions** tab
3. Click the latest workflow run
4. Scroll down to **Artifacts**
5. Download **SafeNet-DNS-Android** (APK) or **SafeNet-DNS-Windows** (MSI)

### Create a Release with downloads:
1. Create a git tag: `git tag v1.0.0`
2. Push the tag: `git push origin v1.0.0`
3. GitHub will automatically create a Release with APK and MSI attached

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
requests. A `v*` tag runs the release job in the repository where that tag was
created and attaches the APK and MSI artifacts to a GitHub Release.

To publish an official release:

1. Merge the reviewed synchronization pull request into
   `GAMC786/SafeNet-Shield-Official/main`.
2. Ensure the `package.json` version and the release version agree.
3. Create and push the matching tag from the official repository, for example:
   ```bash
   git tag -a v1.0.0 -m "SafeNet DNS v1.0.0"
   git push origin v1.0.0
   ```
4. Download the APK and MSI from the resulting official GitHub Release.

Tags created only in the source repository are not copied automatically and do
not publish an official release. This keeps official releases tied to reviewed
content on the official `main` branch.

---

## Version Information
- App ID: com.safenet.dns
- App Name: SafeNet DNS
- Web Directory: dist/public
