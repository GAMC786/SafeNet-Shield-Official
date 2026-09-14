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
const startupArtworkSource = readFileSync(
  path.join(clientRoot, "public/SafeNet_Astronaut_White_Background.png"),
);
const uploadedArtworkSource = readFileSync(
  path.resolve(
    process.cwd(),
    "attached_assets/SafeNet_Astronaut_White_Background_1789375663944.png",
  ),
);
const appSource = readFileSync(path.join(clientRoot, "src/App.tsx"), "utf8");
const mainSource = readFileSync(path.join(clientRoot, "src/main.tsx"), "utf8");
const serverIndexSource = readFileSync(
  path.resolve(process.cwd(), "server/index.ts"),
  "utf8",
);
const glitchTipSource = readFileSync(
  path.resolve(process.cwd(), "server/glitchtip.ts"),
  "utf8",
);
const instrumentationSource = readFileSync(
  path.resolve(process.cwd(), "server/instrumentation.ts"),
  "utf8",
);
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
const wireGuardInfographicSource = readFileSync(
  path.join(clientRoot, "src/components/WireGuardInfographic.tsx"),
  "utf8",
);
const navigationSource = readFileSync(
  path.join(clientRoot, "src/components/Navigation.tsx"),
  "utf8",
);
const tetherShareSource = readFileSync(
  path.join(clientRoot, "src/pages/TetherShare.tsx"),
  "utf8",
);
const tetherShareManagerSource = readFileSync(
  path.resolve(
    process.cwd(),
    "android/app/src/main/java/com/safenet/dns/TetherShareManager.java",
  ),
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
const firewallSource = readFileSync(
  path.join(clientRoot, "src/pages/Firewall.tsx"),
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
    assert.match(indexHtml, /SafeNet_Astronaut_White_Background\.png/);
   assert.match(indexHtml, /background: #ffffff/);
    assert.deepEqual(startupArtworkSource, uploadedArtworkSource);
    assert.deepEqual(
      startupArtworkSource.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    assert.doesNotMatch(indexHtml, /startup-loader-brand|startup-loader-brand-safenet|startup-loader-brand-shield/);
    assert.doesNotMatch(indexHtml, /SafeNet<\/span>|Shield<\/span>/);
    assert.match(indexHtml, /width: 100%;/);
    assert.match(indexHtml, /height: 100%;/);
     assert.match(indexHtml, /object-fit: contain/);
     assert.match(indexHtml, /color: #000000/);
     assert.match(indexHtml, /background: #dc2626/);
     assert.match(indexHtml, /background: #ef4444/);
     assert.match(indexHtml, /color: #dc2626/);
    assert.match(indexHtml, /object-position: center center/);
  assert.match(indexHtml, /startup-loader-dot/);
  assert.doesNotMatch(indexHtml, /startup-loader-shield-stroke|stroke: rgba\(255,255,255,.98\)/);
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

test("the Activity tab is replaced by Android Internet Share", () => {
  assert.match(navigationSource, /path: "\/tether", label: "Internet Share", icon: Share2/);
  assert.doesNotMatch(navigationSource, /label: "Activity"/);
  assert.match(appSource, /Route path="\/tether" component=\{TetherShare\}/);
  assert.match(tetherShareSource, /No-root Wi-Fi Direct gateway/);
  assert.match(tetherShareSource, /Recommended family DNS setup/);
  assert.match(tetherShareSource, /https:\/\/family\.adguard-dns\.com\/dns-query/);
  assert.match(tetherShareSource, /AdGuard DNS \(Family\) is the active SafeNet resolver/);
  assert.match(tetherShareSource, /running \? "sharing" : "not-sharing"/);
  assert.match(headerSource, /status === "sharing" \? "Sharing"/);
  assert.match(headerSource, /status === "not-sharing" \? "Not Sharing"/);
  assert.match(tetherShareSource, /Start sharing/);
  assert.match(tetherShareSource, /Proxy host/);
  assert.match(tetherShareSource, /Open Android Wi-Fi settings/);
  assert.match(tetherShareSource, /HTTPS uses the standard CONNECT tunnel/);
  assert.match(tetherShareSource, /separate from SafeNet&apos;s VPN tunnel/);
  assert.match(tetherShareManagerSource, /PROXY_HOST = "192\.168\.49\.1"/);
  assert.match(tetherShareManagerSource, /PROXY_PORT = 8080/);
  assert.match(tetherShareManagerSource, /"CONNECT"\.equalsIgnoreCase\(method\)/);
  assert.match(tetherShareManagerSource, /getClientList\(\)/);
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
  assert.match(indexHtml, /playback && typeof playback\.catch === "function"/);
  assert.match(indexHtml, /window\.localStorage\.getItem\(mutedKey\) === "true"/);
  assert.match(indexHtml, /audio\.muted = false/);
  assert.match(indexHtml, /addEventListener\("pagehide", stopAudio\)/);
  assert.match(indexHtml, /addEventListener\("visibilitychange"/);
  assert.match(indexHtml, /safenet-soundtrack-change/);
  assert.doesNotMatch(appSource, /SoundtrackControl/);
  assert.match(androidMainActivity, /onPause\(\)/);
  assert.match(androidMainActivity, /if\(a&&!a\.muted\)/);
});

test("Android proves the Dashboard soundtrack toggle survives pause and resume", () => {
  assert.match(
    androidInstrumentationSource,
    /soundtrackToggleSurvivesAndroidPauseAndResume/,
  );
  assert.match(androidInstrumentationSource, /data-testid=.*switch-soundtrack/);
  assert.match(androidInstrumentationSource, /By\.desc\("Soundtrack On"\)/);
  assert.match(androidInstrumentationSource, /By\.desc\("Soundtrack Off"\)/);
  assert.match(androidInstrumentationSource, /safenet-soundtrack-muted/);
  assert.match(androidInstrumentationSource, /audio\.pause\(\)/);
  assert.match(androidInstrumentationSource, /audio\.currentTime <= 0\.05/);
  assert.match(androidInstrumentationSource, /audio\.currentTime > 0/);
  assert.match(androidInstrumentationSource, /pauseAndResumeActivity\(\)/);
  assert.match(androidInstrumentationSource, /unhandledrejection/);
  assert.match(androidInstrumentationSource, /console\.error/);
});

test("Android proves soundtrack playback resumes at the ended boundary", () => {
  assert.match(
    androidInstrumentationSource,
    /soundtrackResumesAfterEndedBoundaryWithToggleEnabled/,
  );
  assert.match(androidInstrumentationSource, /audio\.dispatchEvent\(new Event\('ended'\)\)/);
  assert.match(androidInstrumentationSource, /toggle\.getAttribute\('aria-label'\) === 'Soundtrack On'/);
  assert.match(androidInstrumentationSource, /window\.localStorage\.getItem\('safenet-soundtrack-muted'\) === 'false'/);
  assert.match(androidInstrumentationSource, /audio\.currentTime > 0/);
  assert.match(androidInstrumentationSource, /unhandledrejection/);
  assert.match(androidInstrumentationSource, /console\.error/);
});

test("Measure Your Network keeps ISP profiling and uses Cloudflare's browser engine", () => {
  assert.match(speedTestSource, /ISP-based connection telemetry/);
  assert.match(speedTestSource, /Measure your network/);
  assert.match(speedTestSource, /https:\/\/ipapi\.co\/json\//);
  assert.match(speedTestSource, /https:\/\/ipinfo\.io\/json/);
  assert.match(speedTestSource, /https:\/\/ipwho\.is\//);
  assert.match(speedTestSource, /@cloudflare\/speedtest/);
  assert.match(speedTestSource, /Cloudflare.*global edge network/);
  assert.match(speedTestSource, /turnServerCredsApiUrl: "\/api\/speedtest\/turn-creds"/);
  assert.match(routesSource, /speed\.cloudflare\.com\/turn-creds/);
  assert.match(routesSource, /Origin: "https:\/\/speed\.cloudflare\.com"/);
  assert.match(routesSource, /api\/speedtest\/turn-creds/);
  assert.doesNotMatch(speedTestSource, /LibreSpeed|librespeed/);
  assert.doesNotMatch(speedTestSource, /fiber\.google\.com|Google Speed Test/);
});

test("GlitchTip error reporting is initialized without reviving the dismissed Sentry connector", () => {
  assert.match(glitchTipSource, /GLITCHTIP_DSN/);
  assert.match(glitchTipSource, /skipOpenTelemetrySetup: true/);
  assert.match(glitchTipSource, /expressErrorHandler/);
  assert.match(instrumentationSource, /initializeGlitchTip/);
  assert.match(serverIndexSource, /import "\.\/instrumentation"/);
  assert.match(serverIndexSource, /installGlitchTipExpressErrorHandler/);
  assert.match(mainSource, /initializeGlitchTip/);
  assert.match(mainSource, /installGlitchTipGlobalHandlers/);
  assert.match(appSource, /ErrorBoundary/);
  assert.match(appSource, /captureGlitchTipException/);
  assert.doesNotMatch(glitchTipSource, /connector_catalog:sentry|mcp:sentry/);
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
  assert.match(firewallSource, /Prevent DNS Overrides/);
  assert.match(firewallSource, /switch-prevent-dns-overrides/);
  assert.match(firewallSource, /const isProtected = firewallEnabled && preventDnsOverrides/);
  assert.match(firewallSource, /status=\{isProtected \? "active" : "unprotected"\}/);
  assert.doesNotMatch(settingsSource, /Prevent DNS Overrides|switch-prevent-dns-overrides/);
  assert.doesNotMatch(settingsSource, /data-testid="switch-ai-shield"|aria-label="AI Shield"/);
  assert.doesNotMatch(settingsSource, /Always-On VPN|Device Admin|App Firewall|Device Integration/);
  assert.doesNotMatch(settingsSource, /button-set-pin|Update PIN Code|New four-digit PIN|PIN Protection|PIN Recovery Email|isPinEnabled/);
  assert.doesNotMatch(settingsSource, /v1\.0\.20/);
   assert.match(
     manifestSource,
     new RegExp(`SafeNet Shield DNS v${packageVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
   );
  assert.doesNotMatch(manifestSource, /v1\.0\.20/);
});

test("the Dashboard reports SafeNet VPN protection instead of generic system activity", () => {
  assert.match(dashboardSource, /useSafeNetVpn/);
  assert.match(dashboardSource, /useSettings/);
  assert.match(dashboardSource, /useAntivirusSettings/);
  assert.match(dashboardSource, /settings\?\.firewallEnabled === true/);
  assert.match(dashboardSource, /antivirusSettings\?\.isEnabled === true/);
  assert.match(dashboardSource, /status=\{isProtected \? "active" : "unprotected"\}/);
  assert.match(headerSource, /"Unprotected"/);
  assert.match(headerSource, /yellow-500/);
  assert.match(dashboardSource, /SafeNet VPN/);
  assert.match(dashboardSource, /SafeNet VPN On\/Off/);
  assert.match(dashboardSource, /startAfterEula/);
  assert.match(dashboardSource, /Available in the SafeNet Android APK/);
   assert.match(dashboardSource, /SafeNet VPN protection is running/);
  assert.match(dashboardSource, /WireGuardInfographic/);
  assert.match(wireGuardInfographicSource, /Official WireGuard tunnel/);
  assert.match(wireGuardInfographicSource, /SafeNet WireGuard On\/Off/);
  assert.match(wireGuardInfographicSource, /Android Tunnel Library/);
  assert.doesNotMatch(dashboardSource, /System Active/);
  assert.doesNotMatch(settingsSource, /DNS Protection VPN/);
});

test("resolver, DDNS, and threat views expose the requested controls", () => {
  assert.match(dnsSettingsSource, /ipVersion/);
  assert.match(dnsSettingsSource, /IPv4/);
  assert.match(dnsSettingsSource, /IPv6/);
  assert.match(ddnsSource, /Update Interval \(minutes\)/);
  assert.match(ddnsSource, /DNSExit/);
  assert.match(ddnsSource, /Test/);
  assert.match(ddnsSource, /Manual update verification successful/);
  assert.match(ddnsSource, /Manual update verification unsuccessful/);
  assert.match(antivirusSource, /Threat mix/);
  assert.match(antivirusSource, /Severity profile/);
  assert.match(antivirusSource, /status=\{antivirusEnabled \? "active" : "unprotected"\}/);
  assert.match(appSource, /useFirewallConfig/);
  assert.match(aiShieldSource, /switch-ai-camera/);
  assert.match(aiShieldSource, /switch-ai-screen/);
  assert.match(aiShieldSource, /DeepCleer Ai Camera and Screen Detector/);
  assert.match(aiShieldSource, /Detects Images, Videos, Livestreams, Texts, and Audios\./);
  assert.match(aiShieldSource, /cameraEnabled/);
  assert.match(aiShieldSource, /screenEnabled/);
  assert.match(aiShieldSource, /toggleSource/);
  assert.match(aiShieldSource, /\{cameraEnabled \? "On" : "Off"\}/);
  assert.match(aiShieldSource, /\{screenEnabled \? "On" : "Off"\}/);
  assert.match(settingsSource, /Marathon of Hope/);
  assert.match(settingsSource, /In Loving Memory of Mr\. Terry Stanley Fox\. \(1958 – 1981\)/);
  assert.match(settingsSource, /terryFoxSourceUrl/);
  assert.match(settingsSource, /terryFoxImage/);
  assert.match(settingsSource, /aspect-\[1200\/630\]/);
  assert.match(settingsSource, /bg-white/);
  assert.match(settingsSource, /object-contain/);
  assert.doesNotMatch(settingsSource, /clipPath|terry-fox-white-side-bar/);
  assert.match(dnsSettingsSource, /formData\.type === "plain"/);
  assert.match(dnsSettingsSource, /AdGuard DNS \(Family\)/);
  assert.match(dnsSettingsSource, /https:\/\/family\.adguard-dns\.com\/dns-query/);
  assert.match(dnsSettingsSource, /NextDNS/);
  assert.match(dnsSettingsSource, /45\.90\.28\.0/);
  assert.match(dnsSettingsSource, /Control D/);
  assert.match(dnsSettingsSource, /https:\/\/freedns\.controld\.com\/p2/);
});
