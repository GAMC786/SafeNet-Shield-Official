import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const clientRoot = path.resolve(process.cwd(), "client");
const androidMainActivity = readFileSync(
  path.resolve(
    process.cwd(),
    "android/app/src/main/java/com/safenet/dns/MainActivity.java",
  ),
  "utf8",
);
const nativeFallbackSource = readFileSync(
  path.resolve(
    process.cwd(),
    "android/app/src/main/java/com/safenet/dns/NativeStartupFallbackView.java",
  ),
  "utf8",
);
const indexHtml = readFileSync(path.join(clientRoot, "index.html"), "utf8");
const appSource = readFileSync(path.join(clientRoot, "src/App.tsx"), "utf8");
const mainSource = readFileSync(path.join(clientRoot, "src/main.tsx"), "utf8");
const androidInstrumentationSource = readFileSync(
  path.resolve(
    process.cwd(),
    "android/app/src/androidTest/java/com/safenet/dns/SafeNetVpnUiInstrumentationTest.java",
  ),
  "utf8",
);
const headerSource = readFileSync(
  path.join(clientRoot, "src/components/Header.tsx"),
  "utf8",
);
const navigationSource = readFileSync(
  path.join(clientRoot, "src/components/Navigation.tsx"),
  "utf8",
);
const speedTestSource = readFileSync(
  path.join(clientRoot, "src/pages/SpeedTest.tsx"),
  "utf8",
);
const routesSource = readFileSync(path.join(process.cwd(), "server/routes.ts"), "utf8");
const launchStyleSource = readFileSync(
  path.resolve(process.cwd(), "android/app/src/main/res/values-v31/styles.xml"),
  "utf8",
);
const androidColorsSource = readFileSync(
  path.resolve(process.cwd(), "android/app/src/main/res/values/colors.xml"),
  "utf8",
);
const serviceWorkerSource = readFileSync(
  path.join(clientRoot, "src/service-worker.ts"),
  "utf8",
);
const settingsSource = readFileSync(
  path.join(clientRoot, "src/pages/Settings.tsx"),
  "utf8",
);
const dashboardSource = readFileSync(
  path.join(clientRoot, "src/pages/Dashboard.tsx"),
  "utf8",
);
const dnsSettingsSource = readFileSync(
  path.join(clientRoot, "src/pages/DnsSettings.tsx"),
  "utf8",
);
const ddnsSource = readFileSync(
  path.join(clientRoot, "src/pages/DdnsUpdater.tsx"),
  "utf8",
);
const antivirusSource = readFileSync(
  path.join(clientRoot, "src/pages/Antivirus.tsx"),
  "utf8",
);
const aiShieldSource = readFileSync(
  path.join(clientRoot, "src/components/AiShieldControls.tsx"),
  "utf8",
);
const manifestSource = readFileSync(
  path.join(clientRoot, "public/manifest.json"),
  "utf8",
);
const packageVersion = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
).version as string;

test("the app mounts directly with a Dashboard fallback", () => {
  assert.match(indexHtml, /id="dashboard-fallback"/);
  assert.match(indexHtml, /id="startup-loader"/);
  assert.match(indexHtml, /Connecting to SafeNet Shield DNS Server\+/);
  assert.match(indexHtml, /safenet-astronaut-loader-transparent\.png/);
  assert.match(indexHtml, /startup-loader-dot/);
  assert.match(indexHtml, /startup-loader-shield-stroke/);
  assert.match(indexHtml, /stroke: rgba\(255,255,255,.98\)/);
  assert.match(indexHtml, /Command Center/);
  assert.match(indexHtml, /Loading protected network status/);
  assert.match(indexHtml, /Network/);
  assert.match(indexHtml, /Protected/);
  assert.match(indexHtml, /id="safenet-soundtrack-audio"/);
  assert.match(mainSource, /STARTUP_LOADER_DURATION_MS\s*=\s*10_000/);
  assert.match(mainSource, /STARTUP_LOADER_FADE_MS\s*=\s*180/);
  assert.match(mainSource, /requestAnimationFrame\(updateProgress\)/);
  assert.match(mainSource, /safenet:startup-complete/);
  assert.doesNotMatch(indexHtml, /startup-soundtrack-toggle|static-soundtrack-toggle|Soundtrack: On|Soundtrack: Off/);
  assert.doesNotMatch(indexHtml, /boot-surface|Loading secure server/i);
});

test("startup renders the app without an authentication configuration", () => {
  assert.match(mainSource, /root\.render\(<App \/>/);
  assert.match(mainSource, /openDashboardOnLaunch/);
  assert.doesNotMatch(mainSource, /loadClerkConfig|auth\/config|ClerkRuntimeConfig/);
});

test("startup handoff is not gated by sign-in configuration", () => {
  assert.doesNotMatch(mainSource, /STARTUP_CONFIG_RESPONSE_DELAY_MS|STARTUP_CONFIG_TEST_QUERY|STARTUP_CONFIG_DELAYED_TEST_VALUE/);
  assert.match(mainSource, /hideDashboardFallback\(\);\s*root\.render\(<App \/>/);
});

test("the navigation panel is mounted without the old header arrow control", () => {
  assert.match(appSource, /import \{ Navigation \} from "@\/components\/Navigation"/);
  assert.match(appSource, /<Navigation \/>/);
  assert.match(navigationSource, /navItems/);
  assert.doesNotMatch(headerSource, /ArrowLeft|Back to Command Center/);
});

test("Android keeps a Dashboard recovery state instead of a permanent dark screen", () => {
  assert.match(mainSource, /dashboard-fallback/);
  assert.match(androidMainActivity, /installNativeFallback/);
  assert.match(androidMainActivity, /startupFallback\.setVisibility\(View\.GONE\)/);
  assert.match(androidMainActivity, /startupHandler\.post\(startupCheck\)/);
  assert.match(androidMainActivity, /WebView did not paint SafeNet content/);
  assert.match(androidMainActivity, /resumeSoundtrack/);
  assert.match(nativeFallbackSource, /COMMAND CENTER/);
  assert.match(nativeFallbackSource, /drawCard/);
  assert.match(nativeFallbackSource, /Tap anywhere to retry/);
  assert.doesNotMatch(nativeFallbackSource, /safenet-astronaut|drawCircle|drawTriangleDots|ValueAnimator/i);
});

test("the soundtrack is configured as a persistent loop with an ended fallback", () => {
  assert.match(indexHtml, /id="safenet-soundtrack-audio"/);
  assert.match(indexHtml, /\bloop\b/);
  assert.match(indexHtml, /preload="auto"/);
  assert.doesNotMatch(indexHtml, /syncSoundtrack/);
});

test("the soundtrack loops through startup and has no visible control", () => {
  assert.match(indexHtml, /autoplay/);
  assert.match(indexHtml, /addEventListener\("ended"/);
  assert.match(indexHtml, /void audio\.play\(\)\.catch/);
  assert.doesNotMatch(appSource, /SoundtrackControl/);
  assert.match(androidMainActivity, /!document\.getElementById\('startup-loader'\)/);
});

test("OpenSpeedTest is the only speed-test engine", () => {
  assert.match(speedTestSource, /openspeedtest\.com\/speedtest\?darkmode=1/);
  assert.match(speedTestSource, /OpenSpeedTest engine/);
  assert.match(speedTestSource, /data-testid="openspeedtest-frame"/);
  assert.doesNotMatch(speedTestSource, /@cloudflare\/speedtest|CloudflareSpeedTest/);
});

test("Android 12+ launch surface does not show the Shield Logo", () => {
  assert.match(launchStyleSource, /windowSplashScreenAnimatedIcon/);
  assert.match(launchStyleSource, /splash_transparent/);
});

test("Android keeps a visible black status bar with white icons", () => {
  assert.match(androidColorsSource, /<color name="status_bar">#000000<\/color>/);
  assert.match(launchStyleSource, /android:statusBarColor">@color\/status_bar/);
  assert.match(launchStyleSource, /android:windowLightStatusBar">false/);
  assert.match(androidMainActivity, /show\(WindowInsetsCompat\.Type\.statusBars\(\)\)/);
  assert.match(androidMainActivity, /FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS/);
  assert.match(indexHtml, /name="theme-color" content="#000000"/);
});

test("updated web assets refresh without clearing app storage", () => {
  assert.match(mainSource, /addEventListener\("controllerchange"/);
  assert.match(mainSource, /registration\.update\(\)/);
  assert.match(serviceWorkerSource, /safenet-dns-v3/);
  assert.match(serviceWorkerSource, /clients\.claim\(\)/);
  assert.doesNotMatch(mainSource, /localStorage\.clear|sessionStorage\.clear|clearCache/);
});

test("Settings use the current package version and expose only current controls", () => {
  assert.match(settingsSource, /import\.meta\.env\.VITE_APP_VERSION/);
  assert.match(settingsSource, /data-testid="settings-version"/);
  assert.match(settingsSource, /settingsReady/);
  assert.match(settingsSource, /Prevent DNS Overrides/);
  assert.match(settingsSource, /switch-prevent-dns-overrides/);
  assert.doesNotMatch(settingsSource, /Always-On VPN|Device Admin|App Firewall|Device Integration/);
  assert.doesNotMatch(settingsSource, /button-set-pin|Update PIN Code|New four-digit PIN|PIN Protection|PIN Recovery Email|isPinEnabled/);
  assert.doesNotMatch(settingsSource, /v1\.0\.20/);
  assert.match(
    manifestSource,
    new RegExp(`SafeNet Shield DNS Server\\+ \\(Official\\) v${packageVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  assert.doesNotMatch(manifestSource, /v1\.0\.20/);
});

test("the Dashboard reports Built-In Private DNS protection instead of generic system activity", () => {
  assert.match(dashboardSource, /useSafeNetVpn/);
  assert.match(dashboardSource, /Built-In Private DNS Protection/);
  assert.match(dashboardSource, /Private DNS protection On\/Off/);
  assert.match(dashboardSource, /startAfterEula/);
  assert.match(dashboardSource, /Available in the SafeNet Android APK/);
   assert.match(dashboardSource, /Private DNS protection is running/);
  assert.doesNotMatch(dashboardSource, /System Active/);
  assert.doesNotMatch(settingsSource, /DNS Protection VPN/);
});

test("resolver, DDNS, and threat views expose the requested controls", () => {
  assert.match(dnsSettingsSource, /ipVersion/);
  assert.match(dnsSettingsSource, /IPv4/);
  assert.match(dnsSettingsSource, /IPv6/);
  assert.match(ddnsSource, /Update Interval \(seconds\)/);
  assert.match(ddnsSource, /Test/);
  assert.match(ddnsSource, /Connection test successful/);
  assert.match(ddnsSource, /Connection test unsuccessful/);
  assert.match(antivirusSource, /Threat mix/);
  assert.match(antivirusSource, /Severity profile/);
  assert.match(appSource, /useFirewallConfig/);
  assert.match(aiShieldSource, /switch-ai-camera/);
  assert.match(aiShieldSource, /switch-ai-screen/);
  assert.match(aiShieldSource, /cameraEnabled/);
  assert.match(aiShieldSource, /screenEnabled/);
  assert.match(aiShieldSource, /\{cameraEnabled \? "On" : "Off"\}/);
  assert.match(aiShieldSource, /\{screenEnabled \? "On" : "Off"\}/);
  assert.match(dnsSettingsSource, /formData\.type === "plain"/);
});