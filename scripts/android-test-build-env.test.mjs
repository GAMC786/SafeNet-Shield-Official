import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const buildScript = await readFile(
  new URL("./build-android.sh", import.meta.url),
  "utf8",
);
const gradle = await readFile(
  new URL("../android/app/build.gradle", import.meta.url),
  "utf8",
);
const apkOnlyWorkflow = await readFile(
  new URL("../.github/workflows/build-apk-only.yml", import.meta.url),
  "utf8",
);
const nativeBuildCheck = await readFile(
  new URL("./check-android-native-build.sh", import.meta.url),
  "utf8",
);

test("test Android builds explicitly select development Supabase credentials", () => {
  assert.match(buildScript, /MOBILE_TEST_BUILD/);
  assert.match(buildScript, /VITE_SUPABASE_URL="\$VITE_SUPABASE_DEVELOPMENT_URL"/);
  assert.match(
    buildScript,
    /VITE_SUPABASE_PUBLISHABLE_KEY="\$VITE_SUPABASE_DEVELOPMENT_PUBLISHABLE_KEY"/,
  );
  assert.match(buildScript, /"authEnvironment": "\$auth_environment"/);
  assert.match(gradle, /testInstall && authEnvironment != "development"/);
  assert.match(nativeBuildCheck, /assembleReleaseAndroidTest[\s\S]*?-PtestInstall=true/);
});

test("production Android builds reject development-auth assets", () => {
  assert.match(
    gradle,
    /!testInstall && authEnvironment != "production"/,
  );
  assert.match(apkOnlyWorkflow, /"authEnvironment": "production"/);
});

test("debug-signed instrumentation builds keep the app separate from the test package", () => {
  assert.match(
    gradle,
    /applicationIdSuffix project\.findProperty\("appLockTestBuildType"\) == "debug"\s*\?\s*"\.debugtest"\s*:\s*"\.test"/,
  );
  assert.match(
    gradle,
    /testBuildType project\.findProperty\("appLockTestBuildType"\) == "debug"\s*\?\s*"debug"\s*:\s*"release"/,
  );
});
