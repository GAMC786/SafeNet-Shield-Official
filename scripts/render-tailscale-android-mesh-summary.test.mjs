import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

const renderer = new URL("./render-tailscale-android-mesh-summary.mjs", import.meta.url).pathname;
test("renders bounded Tailscale summary without secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "tailscale-summary-"));
  try {
    const evidence = join(dir, "result.txt"), output = join(dir, "summary.md");
    writeFileSync(evidence, "result=PASS\ndevice_name=phone\ndevice_online=true\nstatus_device_online=online\nclient_package=com.tailscale.ipn\nstatus_token=secret\n");
    const result = spawnSync("node", [renderer, "--output", output, "--evidence", evidence], { encoding: "utf8" });
    assert.equal(result.status, 0);
    const summary = readFileSync(output, "utf8");
    assert.match(summary, /Tailscale Android peer verification/);
    assert.match(summary, /phone/);
    assert.doesNotMatch(summary, /secret|status_token/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});