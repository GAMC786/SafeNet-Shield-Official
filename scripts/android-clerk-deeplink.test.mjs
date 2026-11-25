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

test("Android manifest routes the Clerk callback deep link to MainActivity", () => {
  assert.match(
    manifest,
    /<data\s+android:scheme="com\.safenet\.dns"\s+android:host="callback"\s*\/>/,
  );
  assert.match(manifest, /android:name="\.MainActivity"[\s\S]*?android:exported="true"/);
});

test("the Android app forwards Clerk deep links to its SSO callback handler", () => {
  assert.match(appSource, /CapacitorApp\.addListener\("appUrlOpen"/);
  assert.match(appSource, /CapacitorApp\.getLaunchUrl\(\)/);
  assert.match(appSource, /getNativeClerkCallbackTarget/);
  assert.match(appSource, /<AuthenticateWithRedirectCallback\s*\/>/);
  assert.match(appSource, /Continue with Google/);
  assert.match(appSource, /socialButtonsBlockButton:\s*"hidden"/);
});
