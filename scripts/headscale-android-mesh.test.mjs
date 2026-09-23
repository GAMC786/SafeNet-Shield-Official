import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

const scriptPath = new URL("./headscale-android-mesh-evidence.sh", import.meta.url);
const script = readFileSync(scriptPath, "utf8");

function runWithEnvironment(environment, args = []) {
  const output = mkdtempSync(join(tmpdir(), "headscale-android-mesh-"));
  const result = spawnSync("bash", [scriptPath.pathname, "--output", output, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...environment },
  });
  return { output, result };
}

test("Headscale Android evidence requires every external and client prerequisite", () => {
  assert.match(script, /HEADSCALE_DERP_URL/);
  assert.match(script, /HEADSCALE_ANDROID_NODE_NAME/);
  assert.match(script, /HEADSCALE_ANDROID_PEER_ADDRESS/);
  assert.match(script, /HEADSCALE_ANDROID_LOGIN_SERVER_CONFIRMED/);
  assert.match(script, /HEADSCALE_PERSISTENT_STATE_CONFIRMED/);
  assert.match(script, /CLIENT_NOT_INSTALLED/);
  assert.match(script, /VPN_INTERFACE_MISSING/);
  assert.match(script, /PEER_ROUTE_NOT_MESH/);
  assert.match(script, /result=BLOCKED/);
  assert.match(script, /result=PASS/);
  assert.doesNotMatch(script, /printf .*HEADSCALE_API_KEY/);
  assert.doesNotMatch(script, /echo .*HEADSCALE_API_KEY/);
});

test("missing control-plane configuration writes bounded BLOCKED evidence", () => {
  const { output, result } = runWithEnvironment({});
  try {
    assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
    const evidence = readFileSync(join(output, "result.txt"), "utf8");
    assert.match(evidence, /^evidence_schema_version=1$/m);
    assert.match(evidence, /^result=BLOCKED$/m);
    assert.match(evidence, /^failure_class=INFRASTRUCTURE_PREREQUISITE$/m);
    assert.match(evidence, /^failure_category=CONTROL_PLANE_UNCONFIGURED$/m);
    assert.doesNotMatch(evidence, /HEADSCALE_API_KEY/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("configured URLs without an API key block before making network calls", () => {
  const { output, result } = runWithEnvironment({
    HEADSCALE_URL: "https://headscale.example.test",
    HEADPLANE_URL: "https://headplane.example.test",
    HEADSCALE_DERP_URL: "https://derp.example.test",
    HEADSCALE_ANDROID_NODE_NAME: "phone",
    HEADSCALE_ANDROID_PEER_ADDRESS: "100.64.0.2",
    HEADSCALE_HEADPLANE_NODE_STATUS: "pass",
    HEADSCALE_HEADPLANE_NODE_OWNER: "safenet",
    HEADSCALE_ANDROID_LOGIN_SERVER_CONFIRMED: "pass",
    HEADSCALE_PERSISTENT_STATE_CONFIRMED: "pass",
  });
  try {
    assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
    const evidence = readFileSync(join(output, "result.txt"), "utf8");
    assert.match(evidence, /^failure_category=CONTROL_PLANE_API_KEY_MISSING$/m);
    assert.match(evidence, /^headscale_url=https:\/\/headscale\.example\.test$/m);
    assert.doesNotMatch(evidence, /test-api-key|Bearer/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});