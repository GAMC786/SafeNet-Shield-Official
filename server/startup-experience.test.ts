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
const headerSource = readFileSync(
  path.join(clientRoot, "src/components/Header.tsx"),
  "utf8",
);
const navigationSource = readFileSync(
  path.join(clientRoot, "src/components/Navigation.tsx"),
  "utf8",
);
const soundtrackSource = readFileSync(
  path.join(clientRoot, "src/components/SoundtrackControl.tsx"),
  "utf8",
);
const launchStyleSource = readFileSync(
  path.resolve(process.cwd(), "android/app/src/main/res/values-v31/styles.xml"),
  "utf8",
);

test("the app mounts directly with a Dashboard fallback", () => {
  assert.match(indexHtml, /id="dashboard-fallback"/);
  assert.match(indexHtml, /Command Center/);
  assert.match(indexHtml, /Loading protected network status/);
  assert.match(indexHtml, /Network/);
  assert.match(indexHtml, /Protected/);
  assert.match(indexHtml, /id="safenet-soundtrack-audio"/);
  assert.match(indexHtml, /id="static-soundtrack-toggle"/);
  assert.match(indexHtml, /Soundtrack: On/);
  assert.match(indexHtml, /Soundtrack: Off/);
  assert.doesNotMatch(indexHtml, /SafeNet Shield/);
  assert.doesNotMatch(indexHtml, /safenet-astronaut-loader|safenet-loader|@keyframes/i);
  assert.doesNotMatch(indexHtml, /startup-loader|boot-surface|Connecting to SafeNet|Loading secure server/i);
  assert.doesNotMatch(appSource, /StartupLoader|STARTUP_LOADER|startupLoader/i);
  assert.doesNotMatch(mainSource, /StartupLoader|startupLoader/i);
  assert.doesNotMatch(androidMainActivity, /StartupLoader|startup_loader/i);
});

test("packaged startup mounts immediately without waiting for Clerk configuration", () => {
  assert.match(mainSource, /const buildConfig = getBuildClerkConfig\(\)/);
  assert.match(mainSource, /root\.render\(<App clerkConfig=\{buildConfig\} \/>/);
  assert.match(mainSource, /openDashboardOnLaunch/);
  assert.match(mainSource, /else if \(isPackagedApp\(\)\)/);
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
  assert.match(indexHtml, /\bautoplay\b/);
  assert.match(soundtrackSource, /audio\.loop\s*=\s*true/);
  assert.match(soundtrackSource, /addEventListener\("ended", handleAudioEnded\)/);
  assert.match(soundtrackSource, /audio\.currentTime\s*=\s*0/);
  assert.match(soundtrackSource, /void audio\.play\(\)\.catch/);
  assert.match(soundtrackSource, /setIsPlaying\(!audio\.paused && !audio\.muted\)/);
  assert.match(soundtrackSource, /MUTED_STORAGE_KEY/);
});

test("Android 12+ launch surface does not show the Shield Logo", () => {
  assert.match(launchStyleSource, /windowSplashScreenAnimatedIcon/);
  assert.match(launchStyleSource, /splash_transparent/);
});