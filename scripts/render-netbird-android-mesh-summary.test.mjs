import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

const renderer = new URL("./render-netbird-android-mesh-summary.mjs", import.meta.url).pathname;
test("renders bounded NetBird summary without secrets or raw fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "netbird-summary-"));
  try {
    const evidence = join(dir, "result.txt"), output = join(dir, "summary.md");
    writeFileSync(evidence, "result=PASS\npeer_name=phone\npeer_owner=safenet\npeer_online=true\nstatus_peer_online=online\nclient_package=com.netbird.client\napi_token=secret\n");
    const result = spawnSync("node", [renderer, "--output", output, "--evidence", evidence], { encoding: "utf8" });
    assert.equal(result.status, 0);
    const summary = readFileSync(output, "utf8");
    assert.match(summary, /NetBird Android peer verification/);
    assert.match(summary, /phone/);
    assert.doesNotMatch(summary, /secret|api_token/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});