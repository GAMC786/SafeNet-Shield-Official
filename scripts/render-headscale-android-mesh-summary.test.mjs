import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";

const scriptPath = new URL(
  "./render-headscale-android-mesh-summary.mjs",
  import.meta.url,
);

function render(evidence, extraArgs = []) {
  const directory = mkdtempSync(join(tmpdir(), "headscale-summary-"));
  const evidencePath = evidence
    ? join(directory, "result.txt")
    : undefined;
  const outputPath = join(directory, "summary.md");
  if (evidencePath) writeFileSync(evidencePath, evidence);
  const result = spawnSync(
    process.execPath,
    [
      scriptPath.pathname,
      "--output",
      outputPath,
      ...(evidencePath ? ["--evidence", evidencePath] : []),
      "--evidence-url",
      "https://github.example/release/assets",
      ...extraArgs,
    ],
    { encoding: "utf8" },
  );
  const summary = readFileSync(outputPath, "utf8");
  return { directory, result, summary };
}

test("renders PASS identity, visibility, status, and owner comparison", () => {
  const fixture = render(
    [
      "result=PASS",
      "node_name=safenet-phone",
      "node_owner=safenet",
      "node_online=true",
      "headplane_node_name=safenet-phone",
      "headplane_node_visibility=visible",
      "headplane_node_status=online",
      "headplane_node_owner=safenet",
      "raw_response=DO_NOT_COPY",
      "headplane_node_api_token=DO_NOT_COPY",
    ].join("\n"),
  );
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.match(fixture.summary, /Result:\*\* `PASS`/);
    assert.match(fixture.summary, /Headscale `safenet-phone`; Headplane `safenet-phone`/);
    assert.match(fixture.summary, /Headplane visibility:\*\* `visible`/);
    assert.match(fixture.summary, /Headplane status:\*\* `online`/);
    assert.match(fixture.summary, /Owner comparison:.*result `PASS`/);
    assert.match(fixture.summary, /https:\/\/github\.example\/release\/assets/);
    assert.doesNotMatch(fixture.summary, /DO_NOT_COPY|token/i);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("renders bounded BLOCKED categories without raw evidence", () => {
  const fixture = render(
    [
      "result=BLOCKED",
      "failure_category=HEADPLANE_OWNER_MISMATCH",
      "node_name=safenet-phone",
      "node_owner=safenet",
      "headplane_node_visibility=visible",
      "headplane_node_status=online",
      "headplane_node_owner=other-owner",
      "raw_response=DO_NOT_COPY",
      "headplane_node_api_token=DO_NOT_COPY",
    ].join("\n"),
  );
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.match(fixture.summary, /Result:\*\* `BLOCKED`/);
    assert.match(fixture.summary, /Blocker:\*\* `HEADPLANE_OWNER_MISMATCH`/);
    assert.match(fixture.summary, /Owner comparison:.*result `MISMATCH`/);
    assert.doesNotMatch(fixture.summary, /DO_NOT_COPY|token/i);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("missing evidence is an explicit bounded BLOCKED result", () => {
  const fixture = render("");
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.match(fixture.summary, /Result:\*\* `BLOCKED`/);
    assert.match(fixture.summary, /Blocker:\*\* `HEADSCALE_MESH_EVIDENCE_MISSING`/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});