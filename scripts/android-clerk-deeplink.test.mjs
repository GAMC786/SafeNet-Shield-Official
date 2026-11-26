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

test("Android manifest routes the Supabase callback deep link to MainActivity", () => {
  assert.match(
    manifest,
    /<data\s+android:scheme="safenet"\s+android:host="auth"\s+android:path="\/callback"\s*\/>/,
  );
  assert.match(manifest, /android:name="\.MainActivity"[\s\S]*?android:exported="true"/);
});

test("the Android app exchanges Supabase callback links for a session", () => {
  assert.match(appSource, /CapacitorApp\.addListener\("appUrlOpen"/);
  assert.match(appSource, /CapacitorApp\.getLaunchUrl\(\)/);
  assert.match(appSource, /callback\.protocol !== "safenet:"/);
  assert.match(appSource, /supabase\.auth\.exchangeCodeForSession\(callbackUrl\)/);
  assert.match(appSource, /getSupabaseCallbackUrl\(returnTo\)/);
  assert.match(appSource, /Continue with Google/);
});
