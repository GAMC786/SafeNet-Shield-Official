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
const indexHtml = readFileSync(path.join(clientRoot, "index.html"), "utf8");
const appSource = readFileSync(path.join(clientRoot, "src/App.tsx"), "utf8");
const mainSource = readFileSync(path.join(clientRoot, "src/main.tsx"), "utf8");
const soundtrackSource = readFileSync(
  path.join(clientRoot, "src/components/SoundtrackControl.tsx"),
  "utf8",
);

test("the app mounts directly without a startup loader", () => {
  assert.match(indexHtml, /id="dashboard-fallback"/);
  assert.match(indexHtml, /Command Center/);
  assert.match(indexHtml, /id="safenet-soundtrack-audio"/);
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

test("the soundtrack is configured as a persistent loop with an ended fallback", () => {
  assert.match(indexHtml, /id="safenet-soundtrack-audio"/);
  assert.match(indexHtml, /\bloop\b/);
  assert.match(indexHtml, /\bautoplay\b/);
  assert.match(soundtrackSource, /audio\.loop\s*=\s*true/);
  assert.match(soundtrackSource, /addEventListener\("ended", handleAudioEnded\)/);
  assert.match(soundtrackSource, /audio\.currentTime\s*=\s*0/);
  assert.match(soundtrackSource, /void audio\.play\(\)\.catch/);
});