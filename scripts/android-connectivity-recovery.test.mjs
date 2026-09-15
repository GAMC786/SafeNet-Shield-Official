import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

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

const resolverAggregationStart = smokeScript.indexOf(
  "# Keep only bounded, protocol-specific failure records.",
);
const resolverAggregationEnd = smokeScript.indexOf(
  "\ncapture connectivity-recovery-logcat",
  resolverAggregationStart,
);
const resolverAggregation = smokeScript.slice(
  resolverAggregationStart,
  resolverAggregationEnd,
);
const finalResultStart = smokeScript.indexOf(
  "fixture_process_failed=0",
  resolverAggregationEnd,
);
const finalResultEnd = smokeScript.indexOf(
  '\n\nif [[ "$test_failed"',
  finalResultStart,
);
const finalResultAggregation = smokeScript.slice(
  finalResultStart,
  finalResultEnd,
);

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
    workflow,
    /android_resolver_failure_validation:/,
    "manual workflow must expose the controlled resolver failure validation",
  );
  assert.match(
    workflow,
    /ANDROID_SMOKE_RESOLVER_FAILURE_VALIDATION/,
    "the hosted smoke lane must receive the resolver failure validation switch",
  );
  assert.match(
    workflow,
    /name: Run browser UI tests\s+if: env\.ANDROID_SMOKE_RESOLVER_FAILURE_VALIDATION != 'true'/,
    "the focused hosted failure proof must not be blocked by unrelated browser checks",
  );
  assert.match(
    smokeScript,
    /ANDROID_SMOKE_RESOLVER_FAILURE_VALIDATION requires fixture resolver mode/,
    "controlled resolver failure validation must stay on the credential-free fixture",
  );
  assert.match(
    smokeScript,
    /doh_secondary="https:\/\/203\.0\.113\.7\/dns-query"/,
    "controlled resolver failure validation must use the documentation-only address",
  );
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
    /phase=" \+ phase/,
    "resolver failure evidence must identify the failed phase",
  );
  assert.match(
    uiInstrumentation,
    /failure_category=.*resolverFailureCategory\(failure\).*elapsed_ms=/s,
    "resolver failure evidence must include a category and elapsed time",
  );
  assert.match(
    uiInstrumentation,
    /TLS_FAILURE|ROUTE_FAILURE|TIMEOUT|FIXTURE_FAILURE/,
    "resolver failure classification must distinguish common failure causes",
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
    /resolver-recovery-failures\.txt/,
    "the smoke must archive bounded protocol-specific failure records",
  );
  assert.match(
    smokeScript,
    /doh_recovery_failure_category=%s/,
    "the release result must expose the DoH failure category",
  );
  assert.match(
    smokeScript,
    /dot_recovery_failure_category=%s/,
    "the release result must expose the DoT failure category",
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

test("resolver failure markers survive smoke aggregation without leaking credentials", () => {
  assert.notEqual(resolverAggregationStart, -1, "resolver aggregation is missing");
  assert.notEqual(resolverAggregationEnd, -1, "resolver aggregation boundary is missing");
  assert.notEqual(finalResultStart, -1, "final result aggregation is missing");
  assert.notEqual(finalResultEnd, -1, "final result aggregation boundary is missing");

  const evidenceDirectory = mkdtempSync(join(tmpdir(), "android-resolver-aggregation-"));
  try {
    writeFileSync(
      join(evidenceDirectory, "resolver-recovery-logcat.txt"),
      [
        "I/SafeNetResolverRecovery(123): DOH_DOT_RECOVERY protocol=doh result=PASS cycle=1",
        "I/SafeNetResolverRecovery(123): DOH_DOT_RECOVERY protocol=dot result=PASS cycle=1",
        "DOH_DOT_RECOVERY protocol=doh phase=cycle-1-tls result=FAIL failure_category=TLS_FAILURE elapsed_ms=37",
        "DOH_DOT_RECOVERY protocol=dot phase=cycle-1-route result=FAIL failure_category=ROUTE_FAILURE elapsed_ms=512",
        "I/SafeNetResolverRecovery(123): DOH_DOT_RECOVERY protocol=doh result=PASS cycle=2",
        "I/SafeNetResolverRecovery(123): DOH_DOT_RECOVERY protocol=dot result=PASS cycle=2",
        "DOH_DOT_RECOVERY protocol=doh phase=cycle-2-timeout result=FAIL failure_category=TIMEOUT elapsed_ms=60000",
        "DOH_DOT_RECOVERY protocol=dot phase=cycle-2-fixture result=FAIL failure_category=FIXTURE_FAILURE elapsed_ms=19",
        "DOH_DOT_RECOVERY protocol=doh phase=cycle-3-malformed result=FAIL failure_category=TIMEOUT elapsed_ms=not-a-number",
        "DOH_DOT_RECOVERY protocol=dot phase=https://user:secret@example.invalid/dns-query result=FAIL failure_category=ROUTE_FAILURE elapsed_ms=23",
        "DOH_DOT_RECOVERY protocol=doh phase=cycle-3-credential result=FAIL failure_category=TLS_FAILURE elapsed_ms=41 resolver=https://user:secret@example.invalid/dns-query",
      ].join("\n") + "\n",
    );

    const shell = [
      "set -euo pipefail",
      `output_dir=${JSON.stringify(evidenceDirectory)}`,
      "REQUIRED_RESOLVER_RECOVERY_CYCLES=2",
      "adb_args=()",
      "capture() { :; }",
      "test_failed=0",
      "instrumentation_status=0",
      "serial=synthetic-device",
      "apk_path=/tmp/synthetic-release.apk",
      "validation_mode=fixture",
      "device_kind=emulator",
      "resolver_mode=fixture",
      "coverage_label=resolver-recovery",
      "connectivity_recovery_status=PASS",
      "ai_shield_status=PASS",
      "fixture_pid=$$",
      resolverAggregation,
      finalResultAggregation,
    ].join("\n");
    const result = spawnSync("bash", ["-e", "-u", "-o", "pipefail", "-c", shell], {
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `smoke aggregation harness failed:\n${result.stdout}\n${result.stderr}`,
    );

    const failures = readFileSync(
      join(evidenceDirectory, "resolver-recovery-failures.txt"),
      "utf8",
    );
    const resolverResult = readFileSync(
      join(evidenceDirectory, "resolver-recovery-result.txt"),
      "utf8",
    );
    const resultFile = readFileSync(join(evidenceDirectory, "result.txt"), "utf8");

    assert.equal((failures.match(/^DOH_DOT_RECOVERY /gm) ?? []).length, 4);
    assert.match(failures, /failure_category=TLS_FAILURE elapsed_ms=37/);
    assert.match(failures, /failure_category=ROUTE_FAILURE elapsed_ms=512/);
    assert.match(failures, /failure_category=TIMEOUT elapsed_ms=60000/);
    assert.match(failures, /failure_category=FIXTURE_FAILURE elapsed_ms=19/);
    assert.doesNotMatch(failures, /not-a-number|secret|example\.invalid/);

    for (const output of [resolverResult, resultFile]) {
      assert.match(output, /doh_recovery=PASS/);
      assert.match(output, /dot_recovery=PASS/);
      assert.match(output, /doh_recovery_cycles=2/);
      assert.match(output, /dot_recovery_cycles=2/);
      assert.match(output, /doh_recovery_failure_category=TLS_FAILURE/);
      assert.match(output, /doh_recovery_failure_phase=cycle-1-tls/);
      assert.match(output, /doh_recovery_failure_elapsed_ms=37/);
      assert.match(output, /dot_recovery_failure_category=ROUTE_FAILURE/);
      assert.match(output, /dot_recovery_failure_phase=cycle-1-route/);
      assert.match(output, /dot_recovery_failure_elapsed_ms=512/);
      assert.doesNotMatch(output, /TIMEOUT|FIXTURE_FAILURE|secret|example\.invalid/);
    }
  } finally {
    rmSync(evidenceDirectory, { recursive: true, force: true });
  }
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
  assert.match(summary, /DoH failure detail/);
  assert.match(summary, /DoT failure detail/);
});

test("release summary separates Android SDK blockers from resolver proof", () => {
  const summaryStart = workflow.indexOf(
    "      - name: Publish release Android smoke summary",
  );
  const summaryEnd = workflow.indexOf(
    "\n      - name: Upload release Android smoke evidence",
    summaryStart,
  );
  const summary = workflow.slice(summaryStart, summaryEnd);
  assert.match(
    workflow,
    /android_sdk_setup_category: \$\{\{ steps\.android-sdk-setup-report\.outputs\.category \}\}/,
    "the Android build must export the SDK infrastructure category",
  );
  assert.match(
    summary,
    /ANDROID_SDK_SETUP_FAILURE/,
    "the release smoke summary must preserve the SDK setup category",
  );
  assert.match(
    summary,
    /resolver_proof_status="NOT_RUN"/,
    "the result record must distinguish a blocked resolver proof",
  );
  assert.match(
    summary,
    /Resolver smoke proof.*NOT_RUN.*blocked/,
    "the human summary must explain why resolver proof was skipped",
  );
  assert.match(
    workflow,
    /if: always\(\) && startsWith\(github\.ref, 'refs\/tags\/v'\) && needs\.build-android\.result != 'cancelled'/,
    "the release smoke summary must run when the build job fails",
  );
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
