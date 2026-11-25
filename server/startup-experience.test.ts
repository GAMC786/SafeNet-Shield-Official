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
const appLockComposeSource = readFileSync(
  path.resolve(
    process.cwd(),
    "android/app/src/main/java/com/safenet/dns/LockLockComposeUi.kt",
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
const nativeStatusBarThemeSource = readFileSync(
  path.join(clientRoot, "src/components/NativeStatusBarThemeSync.tsx"),
  "utf8",
);
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
const navigationSource = readFileSync(
  path.join(clientRoot, "src/components/Navigation.tsx"),
  "utf8",
);
const tetherShareSource = readFileSync(
  path.join(clientRoot, "src/pages/TetherShare.tsx"),
  "utf8",
);
const secureDialerSource = readFileSync(
  path.join(clientRoot, "src/pages/SecureDialer.tsx"),
  "utf8",
);
const tetherShareManagerSource = readFileSync(
  path.resolve(
    process.cwd(),
    "android/app/src/main/java/com/safenet/dns/TetherShareManager.java",
  ),
  "utf8",
);
const tetherShareProxySource = readFileSync(
  path.resolve(
    process.cwd(),
    "android/app/src/main/java/com/safenet/dns/TetherShareProxy.java",
  ),
  "utf8",
);
const ddnsHookSource = readFileSync(
  path.join(clientRoot, "src/hooks/use-ddns.ts"),
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
const clamAvHookSource = readFileSync(path.join(clientRoot, "src/hooks/use-clamav.ts"), "utf8");
const billingSource = readFileSync(
  path.join(clientRoot, "src/pages/Billing.tsx"),
  "utf8",
);
const firewallSource = readFileSync(
  path.join(clientRoot, "src/pages/Firewall.tsx"),
  "utf8",
);
const adGuardDnsBlocklistsSource = readFileSync(
  path.join(clientRoot, "src/components/AdGuardDnsBlocklists.tsx"),
  "utf8",
);
const dnsProviderBlocklistsSource = readFileSync(
  path.join(clientRoot, "src/components/DnsProviderBlocklists.tsx"),
  "utf8",
);
const dnsProviderConnectionsSource = readFileSync(
  path.join(clientRoot, "src/components/DnsProviderConnections.tsx"),
  "utf8",
);
const dashboardSource = readFileSync(
  path.join(clientRoot, "src/pages/Dashboard.tsx"),
  "utf8",
);
const vpnProxyBrowserBlockerSource = readFileSync(
  path.join(clientRoot, "src/components/VpnProxyBrowserBlocker.tsx"),
  "utf8",
);
const dnsSettingsSource = readFileSync(
  path.join(clientRoot, "src/pages/DnsSettings.tsx"),
  "utf8",
);
const privateDnsCardSource = readFileSync(
  path.join(clientRoot, "src/components/PrivateDnsCard.tsx"),
  "utf8",
);
const privateDnsHookSource = readFileSync(
  path.join(clientRoot, "src/hooks/use-private-dns.ts"),
  "utf8",
);
const dnsResolversSource = readFileSync(
  path.resolve(process.cwd(), "shared/dns-resolvers.ts"),
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

test("the app mounts directly without a startup loader", () => {
  assert.doesNotMatch(indexHtml, /startup-loader|dashboard-fallback|Loading protected network status/);
  assert.doesNotMatch(indexHtml, /SafeNet_Astronaut_White_Background\.png/);
  assert.match(indexHtml, /id="safenet-soundtrack-audio"/);
  assert.match(mainSource, /root\.render\(<App \/>/);
  assert.doesNotMatch(mainSource, /STARTUP_LOADER|startup-loader|dashboard-fallback|hideDashboardFallback/);
  assert.doesNotMatch(indexHtml, /startup-soundtrack-toggle|static-soundtrack-toggle|Soundtrack: On|Soundtrack: Off/);
  assert.doesNotMatch(indexHtml, /boot-surface|Loading secure server/i);
});

test("startup renders the app without an authentication configuration", () => {
  assert.match(mainSource, /root\.render\(<App \/>/);
  assert.match(mainSource, /openDashboardOnLaunch/);
  assert.doesNotMatch(mainSource, /loadClerkConfig|auth\/config|ClerkRuntimeConfig/);
});

test("startup is not gated by sign-in configuration", () => {
  assert.doesNotMatch(mainSource, /STARTUP_CONFIG_RESPONSE_DELAY_MS|STARTUP_CONFIG_TEST_QUERY|STARTUP_CONFIG_DELAYED_TEST_VALUE/);
  assert.match(mainSource, /openDashboardOnLaunch\(\);\s*root\.render\(<App \/>/);
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
  assert.match(tetherShareSource, /No-root Wi-Fi, hotspot, and Wi-Fi Direct gateway/);
  assert.match(tetherShareSource, /Existing Wi-Fi \/ hotspot/);
  assert.match(tetherShareSource, /Wireless Debugging/);
  assert.match(tetherShareSource, /start\(shareMode\)/);
  assert.doesNotMatch(tetherShareSource, /Recommended family DNS setup/);
  assert.match(tetherShareSource, /DNS resolver controls/);
  assert.match(tetherShareSource, /find\(\(server\) => server\.isActive\)/);
  assert.match(tetherShareSource, /is active for SafeNet protection/);
  assert.match(tetherShareSource, /No resolver is active for SafeNet protection/);
  assert.match(tetherShareSource, /setSelectedResolverProtocol\(activeResolver\.type\)/);
  assert.match(tetherShareSource, /useCreateDnsServer/);
  assert.match(tetherShareSource, /useUpdateDnsServer/);
  assert.match(tetherShareSource, /useDeleteDnsServer/);
  assert.match(tetherShareSource, /useActivateDnsServer/);
  assert.match(tetherShareSource, /Plain DNS/);
  assert.match(tetherShareSource, /DNS over HTTPS/);
  assert.match(tetherShareSource, /DNS over TLS/);
  assert.match(tetherShareSource, /Select one resolver when you want SafeNet protection to use it/);
  assert.match(tetherShareSource, /Activate/);
  assert.match(tetherShareSource, /safenet-tether-resolver-draft/);
  assert.match(tetherShareSource, /safenet-tether-editing-resolver-id/);
  assert.match(secureDialerSource, /https:\/\/github\.com\/Secure-Phone-apps\/Secure-Dialer/);
  assert.match(secureDialerSource, /separate Android dialer maintained by Secure-Phone-apps/);
  assert.match(secureDialerSource, /CallShield/);
  assert.doesNotMatch(secureDialerSource, /Junkboy SMS Filter/);
  assert.doesNotMatch(tetherShareSource, /Recommended providers|dotResolverPresets/);
  assert.match(tetherShareSource, /Add resolver/);
  assert.match(tetherShareSource, /Edit/);
  assert.match(tetherShareSource, /Remove/);
  assert.match(dnsResolversSource, /Control D Family/);
  assert.match(dnsResolversSource, /OpenDNS FamilyShield/);
  assert.match(dnsResolversSource, /AdGuard DNS Family/);
  assert.match(dnsResolversSource, /name: "NextDNS"/);
   assert.match(dnsResolversSource, /primaryAddress: "family\.adguard-dns\.com"/);
  assert.match(tetherShareSource, /running \? "sharing" : "not-sharing"/);
  assert.match(headerSource, /status === "sharing" \? "Sharing"/);
  assert.match(headerSource, /status === "not-sharing" \? "Not Sharing"/);
  assert.match(tetherShareSource, /from "@\/components\/ui\/switch"/);
  assert.match(tetherShareSource, /<Switch/);
  assert.match(tetherShareSource, /checked=\{running\}/);
  assert.match(tetherShareSource, /onCheckedChange=\{\(checked\) => void handleToggle\(checked\)\}/);
  assert.match(tetherShareSource, /nextRunning \? start\(shareMode\) : stop\(\)/);
  assert.match(tetherShareSource, /Secured TLS, HTTPS, and SOCKS5 Proxy Endpoints/);
  assert.match(tetherShareSource, /HTTPS proxy endpoint \(TLS\)/);
  assert.match(tetherShareSource, /SOCKS5 endpoint \(TLS-wrapped\)/);
  assert.match(tetherShareSource, /The HTTPS proxy uses TLS and supports\s+HTTPS CONNECT\. SOCKS5 clients must support\s+SOCKS through a TLS wrapper/);
  assert.match(tetherShareSource, /TLS certificate SHA-256 fingerprint/);
  assert.match(tetherShareSource, /Open Android Wi-Fi &amp; hotspot settings/);
  assert.match(tetherShareSource, /separate from SafeNet&apos;s Private DNS setting/);
  assert.match(tetherShareProxySource, /PROXY_HOST = "192\.168\.49\.1"/);
  assert.match(tetherShareProxySource, /HTTP_PORT = 8228/);
  assert.match(tetherShareProxySource, /loadOrCreate\(context, proxyHost\)/);
  assert.match(tetherShareProxySource, /startHandshake\(\)/);
  assert.match(tetherShareProxySource, /"CONNECT"\.equalsIgnoreCase\(method\)/);
  assert.match(tetherShareManagerSource, /getClientList\(\)/);
});

test("Android keeps a Dashboard recovery state instead of a permanent dark screen", () => {
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

test("the document canvas stays dark behind the app while scrolling", () => {
  assert.match(indexHtml, /localStorage\.getItem\("safenet-theme"\) === "light"/);
  assert.match(indexHtml, /html\.light, html\.light body \{ background: #f1f3f6; color: #1b2432; \}/);
  assert.match(indexHtml, /<body>/);
  assert.match(appSource, /h-screen min-h-0 h-\[100dvh\][\s\S]*overflow-hidden bg-background/);
  assert.match(appSource, /min-h-0 flex-1[\s\S]*overflow-y-auto/);
  assert.match(readFileSync(path.join(clientRoot, "src/index.css"), "utf8"), /background: hsl\(var\(--background\)\);/);
});

test("Wonderland Light Mode page subtitles use dark gray", () => {
  const css = readFileSync(path.join(clientRoot, "src/index.css"), "utf8");
  assert.match(headerSource, /className=\{cn\("safenet-page-subtitle text-sm text-muted-foreground/);
  assert.match(css, /\.light \.safenet-page-subtitle\s*\{\s*color: #4b5563 !important;\s*opacity: 1;/);
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

test("the Dashboard uses Android's built-in SafeNet Private DNS control", () => {
  assert.match(dashboardSource, /<PrivateDnsCard\s*\/>/);
  assert.match(privateDnsCardSource, /SafeNet Private DNS/);
  assert.match(privateDnsCardSource, /Android&apos;s built-in encrypted DNS setting/);
  assert.match(privateDnsCardSource, /No local VPN or VPN server is used/);
  assert.match(privateDnsCardSource, /useDnsServers/);
  assert.match(privateDnsCardSource, /usePrivateDns\(selectedResolver\)/);
  assert.match(privateDnsCardSource, /checked=\{privateDns\.status\?\.running === true\}/);
  assert.match(privateDnsCardSource, /onCheckedChange=\{handleToggle\}/);
  assert.match(privateDnsCardSource, /Selected DNS server:/);
  assert.doesNotMatch(dashboardSource, /WindscribeVpnCard/);
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
  assert.match(speedTestSource, /standard browser measurement sequence/);
  assert.match(speedTestSource, /setResourceTimingBufferSize/);
  assert.match(speedTestSource, /clearResourceTimings/);
  assert.doesNotMatch(speedTestSource, /cloudflareMeasurements/);
  assert.doesNotMatch(speedTestSource, /Math\.random/);
  assert.doesNotMatch(speedTestSource, /button-official-cloudflare-speedtest|Open Official Test/);
  assert.match(speedTestSource, /turnServerCredsApiUrl: resolveApiUrl\("\/api\/speedtest\/turn-creds"\)/);
  assert.match(speedTestSource, /uploadApiUrl: cloudflareUploadApiUrl/);
  assert.match(speedTestSource, /__up\(\?:\\\?\|\$\)/);
  assert.match(routesSource, /speed\.cloudflare\.com\/turn-creds/);
  assert.match(routesSource, /Origin: "https:\/\/speed\.cloudflare\.com"/);
  assert.match(routesSource, /api\/speedtest\/turn-creds/);
  assert.match(routesSource, /api\/speedtest\/upload/);
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

test("Android App Lock applies live system-bar insets to the native overlay", () => {
  assert.match(androidMainActivity, /applySystemBarInsets\(appLockView\)/);
  assert.match(androidMainActivity, /applySystemBarInsets\(startupFallback\)/);
  assert.match(androidMainActivity, /applySystemBarInsets\(webView\)/);
  assert.match(androidMainActivity, /target\.setPadding\(0, systemBars\.top, 0, systemBars\.bottom\)/);
  assert.doesNotMatch(androidMainActivity, /setOnApplyWindowInsetsListener\(container/);
});

test("Android App Lock can return to the SafeNet Dashboard", () => {
  assert.match(appLockComposeSource, /navigationIcon\s*=\s*\{\s*TextButton\(onClick = \{ activity\.finish\(\) \}\)/);
  assert.match(appLockComposeSource, /Text\("Back to Dashboard"\)/);
});

test("Android keeps a visible black status bar with white icons", () => {
  assert.match(androidColorsSource, /<color name="status_bar">#000000<\/color>/);
  assert.match(launchStyleSource, /android:statusBarColor">@color\/status_bar/);
  assert.match(launchStyleSource, /android:windowLightStatusBar">false/);
  assert.match(androidMainActivity, /show\(WindowInsetsCompat\.Type\.statusBars\(\)\)/);
  assert.match(androidMainActivity, /FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS/);
  assert.match(indexHtml, /name="theme-color" content="#000000"/);
});

test("Wonderland Light Mode shows the Android status bar with dark icons", () => {
  assert.match(nativeStatusBarThemeSource, /resolvedTheme === "light" \? "light" : "dark"/);
  assert.match(nativeStatusBarThemeSource, /Capacitor\.getPlatform\(\) !== "android"/);
  assert.match(appSource, /<NativeStatusBarThemeSync \/>/);
  assert.match(androidMainActivity, /setStatusBarColor\(\s*lightStatusBarAppearance \? LIGHT_SYSTEM_SURFACE/);
  assert.match(androidMainActivity, /setAppearanceLightStatusBars\(lightStatusBarAppearance\)/);
  assert.match(androidMainActivity, /show\(WindowInsetsCompat\.Type\.statusBars\(\)\)/);
});

test("Android publishes live system-bar insets to the WebView layout", () => {
  assert.match(
    androidMainActivity,
    /setWebViewSystemBarInsets\(\s*\(WebView\) target,\s*systemBars\.top,\s*systemBars\.bottom/,
  );
  assert.match(androidMainActivity, /--safenet-status-bar-inset/);
  assert.match(androidMainActivity, /--safenet-navigation-bar-inset/);
});

test("app updates fetch pages and auth from network while reusing build assets", () => {
  assert.match(mainSource, /addEventListener\("controllerchange"/);
  assert.match(mainSource, /let hasServiceWorkerController = Boolean\(navigator\.serviceWorker\.controller\)/);
  assert.match(mainSource, /if \(!hasServiceWorkerController\) \{\s*hasServiceWorkerController = true;\s*return;/);
  assert.match(mainSource, /registration\.update\(\)/);
  assert.match(serviceWorkerSource, /safenet-dns-v4/);
  assert.match(serviceWorkerSource, /clients\.claim\(\)/);
  assert.match(serviceWorkerSource, /event\.request\.mode === "navigate"/);
  assert.match(serviceWorkerSource, /requestUrl\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorkerSource, /requestUrl\.pathname\.startsWith\("\/assets\/"\)/);
  assert.match(serviceWorkerSource, /cache: "no-store"/);
  assert.doesNotMatch(mainSource, /localStorage\.clear|sessionStorage\.clear|clearCache/);
});

test("DNS Firewall clearly explains domain rules and their enforcement limits", () => {
  assert.match(firewallSource, /<h2[^>]*>DNS Firewall<\/h2>/);
  assert.match(firewallSource, /SafeNet applies DNS rules on this phone while its DNS-only VPN is active/);
  assert.match(firewallSource, /Manual domain rules are saved in SafeNet/);
  assert.match(firewallSource, /DnsProviderBlocklists/);
  assert.match(dnsProviderBlocklistsSource, /OpenDNS Home is resolver-only/);
  assert.match(dnsProviderBlocklistsSource, /uBlockDNS has no supported account API/);
  assert.match(dnsProviderBlocklistsSource, /SafeNet rule sync updates only SafeNet-owned entries/);
  assert.match(dnsProviderBlocklistsSource, /provider !== "controld"/);
  assert.match(adGuardDnsBlocklistsSource, /AdGuard DNS Built-in Blocklists/);
  assert.match(adGuardDnsBlocklistsSource, /button-adguard-sign-in/);
  assert.match(firewallSource, /DNS names, not keywords or URL paths/);
  assert.match(firewallSource, /aria-label="Enable DNS filtering"/);
  assert.match(firewallSource, /Use on phone/);
  assert.match(firewallSource, /DNS_PROVIDER_PHONE_PRESETS/);
  assert.match(firewallSource, /button-edit-dns-preset-/);
  assert.match(firewallSource, /safenet-family-dns-preset-overrides/);
  assert.match(firewallSource, /Changes are saved on this device/);
  const addRulesButton = firewallSource.indexOf("data-testid={`button-add-dns-provider-");
  const usePhoneButton = firewallSource.indexOf("data-testid={`button-use-phone-dns-");
  const editPresetButton = firewallSource.indexOf("data-testid={`button-edit-dns-preset-");
  assert.ok(
    addRulesButton >= 0 && addRulesButton < usePhoneButton && usePhoneButton < editPresetButton,
    "Family DNS actions should be ordered Add rules, Use on phone, then Edit",
  );
  assert.doesNotMatch(firewallSource, /Allow\/Block URLs|Domain or URL|Enter URL|URL rule/);
  assert.match(firewallSource, /useDnsServers/);
  assert.match(firewallSource, /useLocalVpn/);
  assert.match(firewallSource, /localVpn\.connected/);
  assert.doesNotMatch(firewallSource, /nextdns\/connection|NextDNS API key|Sign in once to connect/);
  assert.match(firewallSource, /href="\/dns"/);
  assert.doesNotMatch(firewallSource, /local-vpn-firewall-scope|SafeNet Local VPN Firewall Rules/);
});

test("AdGuard API connections distinguish the API server ID from the device setup ID", () => {
  assert.match(dnsProviderConnectionsSource, /\/api\/family-dns\/adguard\/servers/);
  assert.match(dnsProviderConnectionsSource, /Load AdGuard servers/);
  assert.match(dnsProviderConnectionsSource, /Server setup ID is only for device enrollment/);
});

test("Android Dashboard exposes DNS-only VPN coverage and consent limits", () => {
  const dashboardSource = readFileSync(path.join(clientRoot, "src/pages/Dashboard.tsx"), "utf8");
  const localDnsVpnSource = readFileSync(
    path.join(clientRoot, "src/components/LocalDnsVpnCard.tsx"),
    "utf8",
  );
  const localVpnEulaSource = readFileSync(
    path.join(clientRoot, "src/components/LocalVpnEulaDialog.tsx"),
    "utf8",
  );
  assert.match(dashboardSource, /<LocalDnsVpnCard \/>/);
  assert.match(localDnsVpnSource, /DNS-only VPN/);
  assert.match(localDnsVpnSource, /UDP\/TCP DNS on port 53/);
  assert.match(localDnsVpnSource, /other active Android VPN/);
  assert.match(localVpnEulaSource, /Android allows one active VPN at a time/);
  assert.match(localVpnEulaSource, /DNS-over-HTTPS, DNS-over-TLS, another VPN/);
});

test("ClamAV verification waits for both scans and shows its pending state", () => {
  assert.match(clamAvHookSource, /timeoutMs: 80000/);
  assert.match(antivirusSource, /Verifying engine…/);
  assert.match(antivirusSource, /Verification checklist/);
  assert.match(antivirusSource, /Check the REST health endpoint/);
  assert.match(antivirusSource, /harmless test file/);
  assert.match(antivirusSource, /EICAR test signature/);
  assert.match(antivirusSource, /engine version stayed the same/);
});

test("Settings use the current package version and expose only current controls", () => {
  assert.match(settingsSource, /import\.meta\.env\.VITE_APP_VERSION/);
  assert.match(settingsSource, /data-testid="settings-version"/);
  assert.match(firewallSource, /Save DNS Override Policy/);
  assert.match(firewallSource, /switch-prevent-dns-overrides/);
  assert.match(firewallSource, /const firewallHeaderStatus = firewallEnabled && localVpn\.connected \? "rules-enabled" : "inactive"/);
  assert.match(firewallSource, /subtitle="DNS & Network Packet-Filtering Rules"/);
  assert.match(firewallSource, /status=\{firewallHeaderStatus\}/);
  const headerSource = readFileSync(path.join(clientRoot, "src/components/Header.tsx"), "utf8");
  assert.match(headerSource, /status === "active" \|\| status === "sharing" \|\| status === "rules-enabled"/);
  assert.match(headerSource, /status === "rules-enabled" \? "Rules Enabled"/);
  assert.match(headerSource, /status === "active" \? "Protected"/);
  assert.doesNotMatch(headerSource, /Rules configured/);
  assert.doesNotMatch(firewallSource, /local-vpn-firewall-scope|Connection status:/);
  assert.doesNotMatch(firewallSource, /Connect NextDNS|Sign in once to connect or sync this provider/);
  assert.doesNotMatch(firewallSource, /Sign in to connect another DNS provider/);
  assert.doesNotMatch(firewallSource, /Windscribe|IKEv2/);
  assert.match(firewallSource, /restrict direct unencrypted DNS on port 53/i);
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

test("Billing recovers from Clerk loading stalls without skipping signed-out access", () => {
  assert.match(billingSource, /const CLERK_LOAD_TIMEOUT_MS = 12_000/);
  assert.match(
    billingSource,
    /const clerkIsLoaded = isLoaded && !clerkStartupStallRequested/,
  );
  assert.match(
    billingSource,
    /if \(clerkIsLoaded\) \{\s*setClerkLoadTimedOut\(false\);\s*return;\s*\}/,
  );
  assert.match(
    billingSource,
    /window\.setTimeout\(\s*\(\) => setClerkLoadTimedOut\(true\),\s*CLERK_LOAD_TIMEOUT_MS,\s*\)/,
  );
  assert.match(
    billingSource,
    /!clerkIsLoaded && !clerkLoadTimedOut[\s\S]*?Loading your account…/,
  );
  assert.match(
    billingSource,
    /!isAndroid && !clerkIsLoaded && !clerkLoadTimedOut \? \([\s\S]*?Loading your account…[\s\S]*?\) : !isAndroid && !clerkIsLoaded \? \([\s\S]*?Your account could not be loaded\. Check your connection and try again\.[\s\S]*?onClick=\{retryClerkLoading\}[\s\S]*?>\s*Retry/,
  );
  assert.match(
    billingSource,
    /!isSignedIn[\s\S]*?Sign in to manage billing[\s\S]*?onClick=\{openSignIn\}[\s\S]*?>\s*Sign in to continue/,
  );
});

test("Android Premium uses anonymous RevenueCat billing without SafeNet sign-in", () => {
  assert.match(billingSource, /Purchases\.configure\(\{ apiKey: REVENUECAT_ANDROID_API_KEY \}\)/);
  assert.match(billingSource, /fetchBilling\("\/api\/billing\/config"/);
  assert.match(billingSource, /Google Play subscriptions/);
  assert.match(billingSource, /SafeNet account sign-in is not required to subscribe or restore purchases/);
  assert.match(billingSource, /Purchases\.purchasePackage/);
  assert.match(billingSource, /Purchases\.restorePurchases/);
  assert.match(billingSource, /Browser\.open\(\{ url: GOOGLE_PLAY_SUBSCRIPTIONS_URL \}\)/);
  assert.match(billingSource, /Purchases\.logIn\(\{ appUserID: currentClerkUserId \}\)/);
  assert.doesNotMatch(billingSource, /fetchBilling\("\/api\/billing\/preflight"/);
});

test("the Sign-Up back button keeps the original post-auth destination", () => {
  assert.match(
    appSource,
    /function SignUpPage\(\)[\s\S]*?label="Back to SafeNet sign-in"\s+onClick=\{\(\) =>\s+setLocation\(authPathWithRedirect\("\/sign-in", redirectUrl\)\)\s*\}/,
  );
});

test("Premium page shows the requested subscription subtitle", () => {
  assert.match(billingSource, /nativePackage\.product\.priceString/);
  assert.match(
    billingSource,
    /subtitle="Pay via Google Play Store - CAD \$3\.00 Monthly - Subscribe and Conquer!"/,
  );
  assert.match(billingSource, /subtitleClassName="normal-case tracking-normal"/);
});

test("Private DNS is a built-in dashboard feature, not a DNS resolver wrapper", () => {
  assert.match(dashboardSource, /PrivateDnsCard/);
  assert.doesNotMatch(dnsSettingsSource, /SafeNet Private DNS|switch-safe-net-private-dns|Open Private DNS/);
  assert.match(privateDnsCardSource, /SafeNet Private DNS/);
  assert.match(privateDnsCardSource, /<Switch/);
  assert.match(privateDnsCardSource, /switch-private-dns-protection/);
  assert.match(privateDnsCardSource, /Android protects this system setting/);
  assert.match(dashboardSource, /VpnProxyBrowserBlocker/);
  assert.match(vpnProxyBrowserBlockerSource, /VPN &amp; Proxy Browser Blocker/);
  assert.match(vpnProxyBrowserBlockerSource, /switch-vpn-proxy-browser-blocker/);
  assert.match(vpnProxyBrowserBlockerSource, /does not inspect or stop traffic inside encrypted VPN or proxy tunnels/);
  assert.match(vpnProxyBrowserBlockerSource, /App selection is stored on this device/);
  assert.match(
    dashboardSource,
    /const isProtected = isProtectionActive\(\{[\s\S]*privateDnsRunning: privateDns\.status\?\.running === true/,
  );
  assert.match(dashboardSource, /status=\{isProtected \? "active" : "unprotected"\}/);
  assert.doesNotMatch(dashboardSource, /VpnService|DNS VPN/);
  assert.doesNotMatch(settingsSource, /DNS Protection VPN/);
});

test("resolver, DDNS, and threat views expose the requested controls", () => {
  assert.match(dashboardSource, /DNS Resolver Active/);
  assert.match(dashboardSource, /text-emerald-300/);
  assert.match(dnsSettingsSource, /ipVersion/);
  assert.match(dnsSettingsSource, /IPv4/);
  assert.match(dnsSettingsSource, /IPv6/);
  assert.match(dnsSettingsSource, /resolverTypeLabel\(preset\.type\)/);
  assert.doesNotMatch(dnsSettingsSource, /SafeNet Private DNS|switch-safe-net-private-dns|Open Private DNS/);
  assert.match(privateDnsCardSource, /Open Android Private DNS settings/);
  assert.match(ddnsSource, /Update Interval \(minutes\)/);
  assert.doesNotMatch(ddnsSource, /DNSExit/);
  assert.match(ddnsSource, /Active Cloudflare zone required/);
  assert.match(ddnsSource, /Add and activate a domain zone in Cloudflare/);
  assert.match(ddnsSource, /https:\/\/dash\.cloudflare\.com\//);
  assert.match(ddnsHookSource, /\/api\/ddns\/update-all/);
  assert.doesNotMatch(ddnsHookSource, /\/api\/ddns\/0\/update/);
  assert.match(ddnsSource, /Test/);
  assert.match(ddnsSource, /Manual update verification successful/);
  assert.match(ddnsSource, /Manual update verification unsuccessful/);
  assert.match(ddnsHookSource, /\/api\/ddns\/update-all/);
   assert.match(ddnsSource, /SafeNet DDNS \(Cloudflare DNS\)/);
   assert.match(ddnsSource, /SafeNet DDNS Hostname URL/);
    assert.match(ddnsSource, /NextDNS, Control D, OpenDNS, and AdGuard linked-IP setup/);
    assert.match(ddnsSource, /NextDNS, Control D, OpenDNS, or AdGuard linked-IP settings/);
   assert.match(ddnsSource, /provider === "safenet"/);
  assert.match(tetherShareProxySource, /candidate\.startsWith\("\["\)/);
  assert.match(tetherShareProxySource, /parsePort/);
  assert.match(antivirusSource, /Threat mix/);
  assert.match(antivirusSource, /Severity profile/);
  assert.match(antivirusSource, /const clamAvVerified = clamAv\.data\?\.verified === true/);
  assert.match(antivirusSource, /const antivirusEnabled = clamAvVerified && settings\?\.isEnabled === true/);
  assert.match(antivirusSource, /disabled=\{updateSettings\.isPending \|\| !clamAvVerified\}/);
  assert.match(antivirusSource, /status=\{antivirusEnabled \? "active" : "unprotected"\}/);
  assert.match(appSource, /useFirewallConfig/);
  assert.match(aiShieldSource, /switch-ai-camera/);
  assert.match(aiShieldSource, /switch-ai-screen/);
  assert.doesNotMatch(aiShieldSource, /button-ai-start-camera|button-ai-start-screen|button-ai-stop/);
  assert.doesNotMatch(aiShieldSource, /Start Camera|Start Screen|Stop Detector/);
  assert.match(aiShieldSource, /Detector controls/);
  assert.match(aiShieldSource, /DeepCleer Ai Detector/);
  assert.match(aiShieldSource, /key: "images"/);
  assert.match(aiShieldSource, /key: "videos"/);
  assert.match(aiShieldSource, /key: "livestreams"/);
  assert.match(aiShieldSource, /key: "texts"/);
  assert.match(aiShieldSource, /key: "audios"/);
  assert.match(aiShieldSource, /mediaPreferences/);
  assert.match(aiShieldSource, /captured frames are released immediately/);
  assert.doesNotMatch(aiShieldSource, /The server AI Shield setting does not inspect browser or device pixels/);
  assert.match(aiShieldSource, /cameraEnabled/);
  assert.match(aiShieldSource, /screenEnabled/);
  assert.match(aiShieldSource, /toggleSource/);
  assert.match(aiShieldSource, /\{cameraEnabled \? "On" : "Off"\}/);
  assert.match(aiShieldSource, /\{screenEnabled \? "On" : "Off"\}/);
  assert.match(settingsSource, /Marathon of Hope/);
  assert.match(settingsSource, /In Loving Memory of Mr\. Terry Stanley Fox \(1958 – 1981\)/);
  assert.match(settingsSource, /terryFoxSourceUrl/);
  assert.match(settingsSource, /terryFoxImage/);
  assert.match(settingsSource, /aspect-\[1200\/630\]/);
  assert.match(settingsSource, /bg-white/);
  assert.match(settingsSource, /object-contain/);
  assert.doesNotMatch(settingsSource, /clipPath|terry-fox-white-side-bar/);
  assert.match(dnsSettingsSource, /formData\.type === "plain"/);
    assert.doesNotMatch(dnsResolversSource, /name: "AdGuard DNS \(Family\)"/);
    assert.doesNotMatch(dnsResolversSource, /https:\/\/family\.adguard-dns\.com\/dns-query/);
   assert.match(dnsResolversSource, /name: "AdGuard DNS \(Family · TLS\)"[\s\S]*?primaryAddress: "family\.adguard-dns\.com"/);
    assert.doesNotMatch(dnsSettingsSource, /DNS_NEXTDNS_RESOLVER_PRESET/);
    assert.doesNotMatch(dnsResolversSource, /name: "NextDNS",\s*type: "plain"/);
   assert.match(dnsResolversSource, /name: "NextDNS \(TLS\)"/);
   assert.match(dnsResolversSource, /primaryAddress: "dns\.nextdns\.io"/);
    assert.doesNotMatch(dnsResolversSource, /name: "Control D \(Family Friendly\)"/);
   assert.match(dnsResolversSource, /name: "Control D \(Family · TLS\)"[\s\S]*?primaryAddress: "family\.freedns\.controld\.com"/);
    assert.doesNotMatch(dnsResolversSource, /https:\/\/freedns\.controld\.com\/family/);
   assert.match(dnsResolversSource, /name: "CleanBrowsing \(Family Filter\)"/);
   assert.match(dnsResolversSource, /primaryAddress: "family-filter-dns\.cleanbrowsing\.org"/);
   assert.match(dnsResolversSource, /OpenDNS \(FamilyShield\)/);
   assert.match(dnsResolversSource, /208\.67\.222\.123/);
   assert.match(dnsResolversSource, /OpenDNS Home does not provide a public DNS-over-TLS endpoint/);
    assert.doesNotMatch(dnsResolversSource, /name: "Cloudflare \(TLS\)"/);
   assert.match(dnsResolversSource, /name: "Cloudflare \(Family\)"[\s\S]*?type: "dot"[\s\S]*?primaryAddress: "family\.cloudflare-dns\.com"/);
   assert.doesNotMatch(privateDnsHookSource, /familyshield\.opendns\.com/);
});
