import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL(
  "../android/app/src/main/AndroidManifest.xml",
  import.meta.url,
);
const appSourcePath = new URL("../client/src/App.tsx", import.meta.url);
const manifest = await readFile(manifestPath, "utf8");
const appSource = await readFile(appSourcePath, "utf8");

test("Android manifest routes the Auth0 callback to MainActivity", () => {
  assert.match(
    manifest,
    /<data\s+android:scheme="safenet"\s+android:host="auth"\s+android:path="\/callback"\s*\/>/,
  );
  assert.match(manifest, /android:name="\.MainActivity"[\s\S]*?android:exported="true"/);
});

test("the Android app completes the Auth0 PKCE callback in the system-browser flow", () => {
  assert.match(appSource, /CapacitorApp\.addListener\("appUrlOpen"/);
  assert.match(appSource, /CapacitorApp\.getLaunchUrl\(\)/);
  assert.match(appSource, /"safenet:\/\/auth\/callback"/);
  assert.match(appSource, /callback\.protocol !== "safenet:"/);
  assert.match(appSource, /callback\.hostname !== "auth"/);
  assert.match(appSource, /callback\.pathname !== "\/callback"/);
  assert.match(appSource, /handleRedirectCallback\(callbackUrl\)/);
  assert.match(appSource, /openUrl: async \(url: string\) => \{ await Browser\.open\(\{ url \}\); \}/);
  assert.match(appSource, /Continue with Google/);
});
