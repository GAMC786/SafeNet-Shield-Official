import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const smokeScript = readFileSync(
  new URL("./android-smoke-test.sh", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const uiInstrumentation = readFileSync(
  new URL(
    "../android/app/src/androidTest/java/com/safenet/dns/SafeNetVpnUiInstrumentationTest.java",
    import.meta.url,
  ),
  "utf8",
).replace(/\r\n/g, "\n");
const workflow = readFileSync(
  new URL("../.github/workflows/build.yml", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

test("Android smoke requires packaged connectivity recovery evidence", () => {
  assert.match(
    smokeScript,
    /-e clerk-origin "\$clerk_origin"/,
    "the smoke must pass the authenticated API origin to instrumentation",
  );
  assert.match(
    smokeScript,
    /connectivity-recovery-logcat\.txt/,
    "the smoke must preserve connectivity recovery logcat",
  );
  assert.match(
    smokeScript,
    /CONNECTIVITY_RECOVERY result=PASS/,
    "the smoke must require the recovery pass marker",
  );
  assert.match(
    smokeScript,
    /connectivity_recovery=%s/,
    "the release result must expose the recovery status",
  );
});

test("packaged recovery test covers outage, offline DNS filtering, and API recovery", () => {
  assert.match(
    uiInstrumentation,
    /packagedAppRecoversAfterNetworkLoss/,
    "the packaged recovery instrumentation test is missing",
  );
  assert.match(
    uiInstrumentation,
    /cmd connectivity airplane-mode "\s*\+\s*\(enabled \? "enable" : "disable"\)/,
    "the test must disable and restore Android network access",
  );
  assert.match(
    uiInstrumentation,
    /No internet connection/,
    "the test must assert the WebView offline banner",
  );
  assert.match(
    uiInstrumentation,
    /Offline DNS filtering must refuse a blocked domain/,
    "the test must prove the offline firewall remains usable",
  );
  assert.match(
    uiInstrumentation,
    /authenticated API status must recover after reconnecting/,
    "the test must prove API-backed recovery",
  );
  assert.match(
    uiInstrumentation,
    /Connectivity recovery must not emit browser errors/,
    "the test must reject browser errors during recovery",
  );
});

test("release summary publishes connectivity recovery status", () => {
  const summaryStart = workflow.indexOf(
    "      - name: Publish release Android smoke summary",
  );
  const summaryEnd = workflow.indexOf(
    "\n      - name: Upload release Android smoke evidence",
    summaryStart,
  );
  assert.notEqual(summaryStart, -1, "release smoke summary is missing");
  assert.notEqual(summaryEnd, -1, "release smoke summary boundary is missing");
  const summary = workflow.slice(summaryStart, summaryEnd);
  assert.match(summary, /connectivity_recovery/);
  assert.match(summary, /Internet loss and recovery/);
});