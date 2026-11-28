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

test("Android manifest routes the configured Supabase callback to MainActivity", () => {
  assert.match(
    manifest,
    /<data\s+android:scheme="com\.safenet\.dns"\s+android:host="callback"\s*\/>/,
  );
  assert.match(manifest, /android:name="\.MainActivity"[\s\S]*?android:exported="true"/);
});

test("the Android app exchanges the configured Supabase callback for a session", () => {
  assert.match(appSource, /CapacitorApp\.addListener\("appUrlOpen"/);
  assert.match(appSource, /CapacitorApp\.getLaunchUrl\(\)/);
  assert.match(appSource, /new URL\("com\.safenet\.dns:\/\/callback"\)/);
  assert.match(appSource, /if \(!isAndroidNative \|\| returnTo !== `\$\{basePath\}\/`\)/);
  assert.match(appSource, /callback\.protocol !== "com\.safenet\.dns:"/);
  assert.match(appSource, /callback\.hostname !== "callback"/);
  assert.match(appSource, /callback\.searchParams\.get\("code"\)/);
  assert.match(appSource, /supabase\.auth\.exchangeCodeForSession\(code\)/);
  assert.match(appSource, /getSupabaseCallbackUrl\(returnTo\)/);
  assert.match(appSource, /Continue with Google/);
});
