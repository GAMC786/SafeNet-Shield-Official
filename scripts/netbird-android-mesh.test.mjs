import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

const scriptPath = new URL("./netbird-android-mesh-evidence.sh", import.meta.url);
const script = readFileSync(scriptPath, "utf8");
test("NetBird evidence is fail-closed and redacts credentials", () => {
  assert.match(script, /NETBIRD_MANAGEMENT_URL/);
  assert.match(script, /Authorization: Token/);
  assert.match(script, /Authorization: Bearer/);
  assert.match(script, /x\.status==="online"/);
  assert.match(script, /NETBIRD_ANDROID_CLIENT_PACKAGE/);
  assert.match(script, /DEFAULT_CLIENT_PACKAGE="io\.netbird\.client"/);
  assert.match(script, /client_package=.*DEFAULT_CLIENT_PACKAGE/);
  assert.match(script, /ANDROID_EMULATOR_TARGET/);
  assert.match(script, /PEER_ROUTE_NOT_MESH/);
  assert.match(script, /native_safenet_vpn=NOT_IMPLEMENTED/);
  assert.doesNotMatch(script, /printf .*NETBIRD_API_TOKEN/);
  assert.doesNotMatch(script, /echo .*NETBIRD_STATUS_TOKEN/);
});
test("missing NetBird configuration writes bounded BLOCKED evidence", () => {
  const out = mkdtempSync(join(tmpdir(), "netbird-mesh-"));
  try {
    const result = spawnSync("bash", [scriptPath.pathname, "--output", out], { encoding: "utf8" });
    assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
    const evidence = readFileSync(join(out, "result.txt"), "utf8");
    assert.match(evidence, /^validation_mode=netbird-android-mesh$/m);
    assert.match(evidence, /^result=BLOCKED$/m);
    assert.match(evidence, /^failure_category=CONTROL_PLANE_UNCONFIGURED$/m);
  } finally { rmSync(out, { recursive: true, force: true }); }
});