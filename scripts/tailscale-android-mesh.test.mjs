import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

const scriptPath = new URL("./tailscale-android-mesh-evidence.sh", import.meta.url);
const script = readFileSync(scriptPath, "utf8");
test("Tailscale evidence is fail-closed and redacts credentials", () => {
  assert.match(script, /TAILSCALE_STATUS_URL/);
  assert.match(script, /Authorization: Bearer/);
  assert.match(script, /status=\["online","offline","unknown"\]/);
  assert.match(script, /TAILSCALE_ANDROID_PACKAGE/);
  assert.match(script, /DEFAULT_CLIENT_PACKAGE="com\.tailscale\.ipn"/);
  assert.match(script, /ANDROID_EMULATOR_TARGET/);
  assert.match(script, /PEER_ROUTE_NOT_MESH/);
  assert.doesNotMatch(script, /printf .*TAILSCALE_STATUS_TOKEN/);
});
test("missing Tailscale configuration writes bounded BLOCKED evidence", () => {
  const out = mkdtempSync(join(tmpdir(), "tailscale-mesh-"));
  try {
    const result = spawnSync("bash", [scriptPath.pathname, "--output", out], { encoding: "utf8" });
    assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
    const evidence = readFileSync(join(out, "result.txt"), "utf8");
    assert.match(evidence, /^validation_mode=tailscale-android-mesh$/m);
    assert.match(evidence, /^result=BLOCKED$/m);
    assert.match(evidence, /^failure_category=STATUS_API_UNCONFIGURED$/m);
  } finally { rmSync(out, { recursive: true, force: true }); }
});