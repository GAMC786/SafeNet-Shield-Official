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
const physicalConnectivityScript = readFileSync(
  new URL("./android-physical-connectivity-test.sh", import.meta.url),
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

test("packaged resolver recovery covers bounded DoH and DoT outage phases", () => {
  assert.match(
    uiInstrumentation,
    /dohAndDotRecoverAfterNetworkLoss/,
    "the protocol recovery instrumentation test is missing",
  );
  assert.match(
    uiInstrumentation,
    /RESOLVER_RECOVERY_CYCLES\s*=\s*2/,
    "the protocol recovery test must run at least two cycles",
  );
  assert.match(
    uiInstrumentation,
    /for\s*\(int cycle = 1; cycle <= RESOLVER_RECOVERY_CYCLES; cycle\+\+\)/,
    "the protocol recovery test must number every outage cycle",
  );
  assert.match(
    uiInstrumentation,
    /DOH_DOT_RECOVERY protocol=" \+ protocol/,
    "the test must emit protocol-specific resolver recovery evidence",
  );
  assert.match(
    uiInstrumentation,
    /" result=PASS cycle=" \+ cycle/,
    "resolver evidence must identify the cycle number",
  );
  assert.match(
    uiInstrumentation,
    /offline filtering must refuse the blocked domain/,
    "the test must keep offline resolver filtering fail-closed",
  );
  assert.match(
    smokeScript,
    /resolver-recovery-result\.txt/,
    "the smoke must archive protocol-specific resolver results",
  );
  assert.match(
    smokeScript,
    /doh_recovery=%s/,
    "the release result must expose DoH recovery status",
  );
  assert.match(
    smokeScript,
    /dot_recovery=%s/,
    "the release result must expose DoT recovery status",
  );
  assert.match(
    smokeScript,
    /REQUIRED_RESOLVER_RECOVERY_CYCLES=2/,
    "the smoke must require two resolver recovery cycles",
  );
  assert.match(
    smokeScript,
    /doh_recovery_cycles=%s/,
    "the release result must expose DoH cycle evidence",
  );
  assert.match(
    smokeScript,
    /dot_recovery_cycles=%s/,
    "the release result must expose DoT cycle evidence",
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
  assert.match(summary, /DoH outage recovery/);
  assert.match(summary, /DoT outage recovery/);
});

test("physical-device recovery rejects unavailable or emulated targets", () => {
  assert.match(
    physicalConnectivityScript,
    /failure_class=DEVICE_ACCESS/,
    "device-access limitations must be recorded separately from app failures",
  );
  assert.match(
    physicalConnectivityScript,
    /EMULATOR_TARGET|EMULATOR_ONLY/,
    "the physical lane must not accept an emulator as physical evidence",
  );
  assert.match(
    physicalConnectivityScript,
    /--resolver-mode public/,
    "physical devices must use reachable public resolvers rather than 10.0.2.2",
  );
});

test("workflow exposes and publishes the physical-device recovery lane", () => {
  assert.match(
    workflow,
    /android_connectivity_physical_validation:/,
    "manual workflow input for physical connectivity validation is missing",
  );
  assert.match(
    workflow,
    /android-connectivity-physical:/,
    "dedicated physical connectivity job is missing",
  );
  assert.match(
    workflow,
    /android-physical-device/,
    "physical connectivity job must target a dedicated device runner label",
  );
  assert.match(
    workflow,
    /SafeNet-DNS-Android-connectivity-physical-evidence/,
    "physical connectivity evidence artifact is missing",
  );
});
