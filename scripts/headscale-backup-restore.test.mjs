import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const checker = "ops/headscale/backup-restore-check.sh";
const identityChecker = "ops/headscale/verify-restored-identities.sh";

function runChecker(args) {
  return spawnSync("bash", [checker, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function runIdentityChecker(args) {
  return new Promise((resolve) => {
    const child = spawn("bash", [identityChecker, ...args], {
      encoding: "utf8",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "headscale-backup-"));
  const source = join(root, "source");
  const identity = join(root, "identity.env");
  await mkdir(join(source, "headscale/lib"), { recursive: true });
  await mkdir(join(source, "headplane/data"), { recursive: true });
  await mkdir(join(source, "caddy/data"), { recursive: true });
  await writeFile(join(source, "headscale/lib/db.sqlite"), "fixture-node-state\n");
  await writeFile(join(source, "headscale/lib/noise_private.key"), "fixture-noise-key\n");
  await writeFile(join(source, "headscale/lib/derp_server_private.key"), "fixture-derp-key\n");
  await writeFile(join(source, "headplane/data/headplane.sqlite"), "fixture-headplane-state\n");
  await writeFile(join(source, "caddy/data/acme.json"), "fixture-certificate-data\n");
  await writeFile(
    identity,
    [
      "android_node_name=safenet-phone",
      "android_node_id=node-android",
      "android_node_public_key=nodekey:android",
      "approved_peer_name=always-on-peer",
      "approved_peer_id=node-peer",
      "approved_peer_public_key=nodekey:peer",
      "approved_peer_address=100.64.0.2",
      "",
    ].join("\n"),
  );
  return { root, source, identity };
}

test("backup archive restores all persistent state and bounded identities", async () => {
  const { root, source, identity } = await fixture();
  const archive = join(root, "safenet-headscale-state.tar.gz");
  const createResult = join(root, "create-result.txt");

  const created = runChecker([
    "create",
    "--source",
    source,
    "--output",
    archive,
    "--identity",
    identity,
    "--result",
    createResult,
  ]);
  assert.equal(created.status, 0, created.stderr);
  assert.match(await readFile(createResult, "utf8"), /result=PASS/);

  const restored = join(root, "replacement");
  const restoreResult = join(root, "restore-result.txt");
  const checked = runChecker([
    "restore-check",
    "--archive",
    archive,
    "--target",
    restored,
    "--identity",
    identity,
    "--result",
    restoreResult,
  ]);
  assert.equal(checked.status, 0, checked.stderr);
  const evidence = await readFile(restoreResult, "utf8");
  assert.match(evidence, /headscale_state=RESTORED/);
  assert.match(evidence, /headplane_state=RESTORED/);
  assert.match(evidence, /caddy_certificate_data=RESTORED/);
  assert.match(evidence, /android_node_identity=RETAINED_IN_MANIFEST/);
  assert.match(evidence, /approved_peer_identity=RETAINED_IN_MANIFEST/);
  assert.match(evidence, /mesh_proof=REQUIRED_AFTER_STARTUP/);
  assert.equal(
    await readFile(join(restored, "headscale/lib/db.sqlite"), "utf8"),
    "fixture-node-state\n",
  );
  assert.equal(
    await readFile(join(restored, "caddy/data/acme.json"), "utf8"),
    "fixture-certificate-data\n",
  );
});

test("restore check refuses a target that could overwrite a live host", async () => {
  const { root, source, identity } = await fixture();
  const archive = join(root, "safenet-headscale-state.tar.gz");
  assert.equal(
    runChecker(["create", "--source", source, "--output", archive, "--identity", identity]).status,
    0,
  );
  const target = join(root, "replacement");
  await mkdir(target);
  const checked = runChecker([
    "restore-check",
    "--archive",
    archive,
    "--target",
    target,
    "--identity",
    identity,
  ]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /must not already exist/);
});

test("live identity check compares both retained nodes without leaking the API key", async () => {
  const { root, identity } = await fixture();
  const apiKey = "fixture-restore-api-key";
  const apiKeyFile = join(root, "api-key");
  const resultFile = join(root, "identity-result.txt");
  await writeFile(apiKeyFile, `${apiKey}\n`);

  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
    assert.equal(request.url, "/api/v1/node");
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        nodes: [
          {
            id: "node-android",
            name: "safenet-phone",
            nodeKey: "nodekey:android",
            user: { name: "safenet" },
            online: true,
            ipAddresses: ["100.64.0.1"],
          },
          {
            id: "node-peer",
            name: "always-on-peer",
            nodeKey: "nodekey:peer",
            online: true,
            ipAddresses: ["100.64.0.2"],
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const checked = await runIdentityChecker([
      "--url",
      `http://127.0.0.1:${port}`,
      "--api-key-file",
      apiKeyFile,
      "--identity",
      identity,
      "--result",
      resultFile,
    ]);
    assert.equal(checked.status, 0, checked.stderr);
    const evidence = await readFile(resultFile, "utf8");
    assert.match(evidence, /result=PASS/);
    assert.match(evidence, /android_node_identity=PASS/);
    assert.match(evidence, /approved_peer_identity=PASS/);
    assert.doesNotMatch(evidence, new RegExp(apiKey));
    assert.doesNotMatch(checked.stdout, new RegExp(apiKey));
    assert.doesNotMatch(checked.stderr, new RegExp(apiKey));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});