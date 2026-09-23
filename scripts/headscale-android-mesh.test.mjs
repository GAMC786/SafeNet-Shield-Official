import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
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

function readDirectoryContents(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    return entry.isDirectory()
      ? readDirectoryContents(entryPath)
      : [readFileSync(entryPath, "utf8")];
  });
}

function createFakeAdb(directory) {
  const binDirectory = join(directory, "bin");
  mkdirSync(binDirectory);
  const adbPath = join(binDirectory, "adb");
  writeFileSync(
    adbPath,
    `#!/usr/bin/env bash
set -eu
case "$*" in
  "start-server") ;;
  "devices -l") printf 'List of devices attached\\nfixture-phone\\tdevice product/fixture model/Fixture\\n' ;;
  "devices") printf 'List of devices attached\\nfixture-phone\\tdevice\\n' ;;
  *"get-state") printf 'device\\n' ;;
  *"shell getprop ro.kernel.qemu") printf '0\\n' ;;
  *"shell getprop ro.product.manufacturer") printf 'Fixture Manufacturer\\n' ;;
  *"shell getprop ro.product.model") printf 'Fixture Phone\\n' ;;
  *"shell getprop ro.build.version.release") printf '15\\n' ;;
  *"shell getprop ro.build.version.sdk") printf '35\\n' ;;
  *"shell pm path "*) printf 'package:/data/app/fixture.apk\\n' ;;
  *"shell dumpsys package "*) printf 'versionName=fixture-client-1.0\\n' ;;
  *"shell ip -o link") printf '1: lo: <LOOPBACK>\\n2: tailscale0: <UP>\\n' ;;
  *"shell ip route get "*) printf '100.64.0.2 dev tailscale0 src 100.64.0.1\\n' ;;
  *"shell ping "*) printf '3 packets transmitted, 3 packets received, 0.0%% packet loss\\n' ;;
  *) printf 'unexpected fake adb invocation: %s\\n' "$*" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(adbPath, 0o755);
  return binDirectory;
}

async function startFixtureServer(headplaneResponse) {
  const requests = [];
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    requests.push({
      authorization: request.headers.authorization,
      path: requestUrl.pathname,
      node: requestUrl.searchParams.get("node"),
    });

    let fixture = {
      status: 200,
      body: JSON.stringify({ ok: true }),
      contentType: "application/json",
    };
    if (requestUrl.pathname === "/api/v1/node") {
      fixture = {
        status: 200,
        body: JSON.stringify({
          nodes: [
            {
              name: "safenet-phone",
              user: "safenet",
              online: true,
              ipAddresses: ["100.64.0.1"],
              rawSentinel: "RAW_HEADSCALE_FIXTURE_MUST_NOT_LEAK",
            },
          ],
        }),
      };
    } else if (requestUrl.pathname === "/api/headscale/node-status") {
      fixture = {
        ...headplaneResponse,
        body:
          typeof headplaneResponse.body === "string"
            ? headplaneResponse.body
            : JSON.stringify(headplaneResponse.body),
      };
    }

    response.writeHead(fixture.status, {
      "content-type": fixture.contentType ?? "application/json",
    });
    response.end(fixture.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function runFixtureCase(headplaneResponse, { withAdb = false } = {}) {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "headscale-android-mesh-fixture-"));
  const server = await startFixtureServer(headplaneResponse);
  const binDirectory = withAdb ? createFakeAdb(fixtureDirectory) : null;
  const token = "fixture-headplane-bearer-token";
  const apiKey = "fixture-headscale-api-key";
  const environment = {
    PATH: [binDirectory, process.env.PATH].filter(Boolean).join(":"),
    HEADSCALE_URL: server.baseUrl,
    HEADPLANE_URL: `${server.baseUrl}/headplane`,
    HEADSCALE_DERP_URL: `${server.baseUrl}/derp`,
    HEADPLANE_NODE_API_URL: `${server.baseUrl}/api/headscale/node-status`,
    HEADSCALE_API_KEY: apiKey,
    HEADPLANE_NODE_API_TOKEN: token,
    HEADSCALE_ANDROID_NODE_NAME: "safenet-phone",
    HEADSCALE_ANDROID_PEER_ADDRESS: "100.64.0.2",
    HEADSCALE_ANDROID_LOGIN_SERVER_CONFIRMED: "pass",
    HEADSCALE_PERSISTENT_STATE_CONFIRMED: "pass",
  };
  const output = mkdtempSync(join(fixtureDirectory, "output-"));
  const child = spawn(
    "bash",
    [scriptPath.pathname, "--output", output, "--serial", "fixture-phone"],
    { env: { ...process.env, ...environment } },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  await server.close();
  return { fixtureDirectory, output, result, requests: server.requests, token, apiKey };
}

function assertNoSensitiveFixtureData(output, token, apiKey) {
  const generatedEvidence = readDirectoryContents(output).join("\n");
  assert.doesNotMatch(generatedEvidence, new RegExp(token));
  assert.doesNotMatch(generatedEvidence, new RegExp(apiKey));
  assert.doesNotMatch(
    generatedEvidence,
    /RAW_(?:HEADSCALE|HEADPLANE)_FIXTURE_MUST_NOT_LEAK/,
  );
  assert.doesNotMatch(generatedEvidence, /Authorization:\s*Bearer/i);
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
  assert.match(script, /HEADPLANE_NODE_API_URL/);
  assert.match(script, /HEADPLANE_NODE_API_TOKEN/);
  assert.match(script, /HEADPLANE_NODE_API_AUTH_FAILED/);
  assert.match(script, /HEADPLANE_NODE_API_UNSUPPORTED/);
  assert.match(script, /HEADPLANE_NODE_NOT_VISIBLE/);
  assert.doesNotMatch(script, /HEADSCALE_HEADPLANE_NODE_STATUS/);
  assert.doesNotMatch(script, /HEADSCALE_HEADPLANE_NODE_OWNER/);
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

test("authenticated Headplane fixture matches the documented node contract", async () => {
  const fixture = await runFixtureCase(
    {
      status: 200,
      body: {
        node: {
          name: "safenet-phone",
          visibility: "visible",
          owner: "safenet",
          status: "online",
          rawSentinel: "RAW_HEADPLANE_FIXTURE_MUST_NOT_LEAK",
        },
      },
    },
    { withAdb: true },
  );
  try {
    assert.equal(fixture.result.status, 0, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const evidence = readFileSync(join(fixture.output, "result.txt"), "utf8");
    assert.match(evidence, /^result=PASS$/m);
    assert.match(evidence, /^headplane_node_visibility=visible$/m);
    assert.match(evidence, /^headplane_node_status=online$/m);
    assert.match(evidence, /^headplane_node_owner=safenet$/m);
    const nodeRequest = fixture.requests.find(
      (request) => request.path === "/api/headscale/node-status",
    );
    assert.deepEqual(nodeRequest, {
      authorization: `Bearer ${fixture.token}`,
      path: "/api/headscale/node-status",
      node: "safenet-phone",
    });
    assertNoSensitiveFixtureData(fixture.output, fixture.token, fixture.apiKey);
    assert.equal(
      readdirSync(fixture.output).includes(".headplane-node-response.json"),
      false,
    );
    assert.equal(
      readdirSync(fixture.output).includes(".headscale-node-response.json"),
      false,
    );
  } finally {
    rmSync(fixture.fixtureDirectory, { recursive: true, force: true });
  }
});

for (const status of [401, 403]) {
  test(`Headplane authentication failure ${status} remains bounded BLOCKED evidence`, async () => {
    const fixture = await runFixtureCase({
      status,
      body: {
        error: "authentication failure",
        rawSentinel: "RAW_HEADPLANE_FIXTURE_MUST_NOT_LEAK",
      },
    });
    try {
      assert.equal(fixture.result.status, 78, `${fixture.result.stdout}\n${fixture.result.stderr}`);
      const evidence = readFileSync(join(fixture.output, "result.txt"), "utf8");
      assert.match(evidence, /^result=BLOCKED$/m);
      assert.match(evidence, /^failure_category=HEADPLANE_NODE_API_AUTH_FAILED$/m);
      assertNoSensitiveFixtureData(fixture.output, fixture.token, fixture.apiKey);
    } finally {
      rmSync(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  });
}

for (const status of [404, 405, 501]) {
  test(`unsupported Headplane response ${status} remains bounded BLOCKED evidence`, async () => {
    const fixture = await runFixtureCase({
      status,
      body: {
        error: "unsupported endpoint",
        rawSentinel: "RAW_HEADPLANE_FIXTURE_MUST_NOT_LEAK",
      },
    });
    try {
      assert.equal(fixture.result.status, 78, `${fixture.result.stdout}\n${fixture.result.stderr}`);
      const evidence = readFileSync(join(fixture.output, "result.txt"), "utf8");
      assert.match(evidence, /^result=BLOCKED$/m);
      assert.match(evidence, /^failure_category=HEADPLANE_NODE_API_UNSUPPORTED$/m);
      assertNoSensitiveFixtureData(fixture.output, fixture.token, fixture.apiKey);
    } finally {
      rmSync(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  });
}

test("malformed Headplane JSON is rejected without preserving the raw response", async () => {
  const fixture = await runFixtureCase({
    status: 200,
    body: '{"node":{"name":"safenet-phone","visibility":"visible"',
  });
  try {
    assert.equal(fixture.result.status, 78, `${fixture.result.stdout}\n${fixture.result.stderr}`);
    const evidence = readFileSync(join(fixture.output, "result.txt"), "utf8");
    assert.match(evidence, /^failure_category=HEADPLANE_NODE_API_UNSUPPORTED$/m);
    assertNoSensitiveFixtureData(fixture.output, fixture.token, fixture.apiKey);
  } finally {
    rmSync(fixture.fixtureDirectory, { recursive: true, force: true });
  }
});

for (const [label, node, category] of [
  [
    "visibility mismatch",
    { name: "safenet-phone", visibility: "hidden", owner: "safenet", status: "online" },
    "HEADPLANE_NODE_NOT_VISIBLE",
  ],
  [
    "owner mismatch",
    { name: "safenet-phone", visibility: "visible", owner: "other-owner", status: "online" },
    "HEADPLANE_OWNER_MISMATCH",
  ],
  [
    "status mismatch",
    { name: "safenet-phone", visibility: "visible", owner: "safenet", status: "offline" },
    "HEADPLANE_STATUS_MISMATCH",
  ],
]) {
  test(`Headplane ${label} is bounded BLOCKED evidence`, async () => {
    const fixture = await runFixtureCase({ status: 200, body: { node } });
    try {
      assert.equal(fixture.result.status, 78, `${fixture.result.stdout}\n${fixture.result.stderr}`);
      const evidence = readFileSync(join(fixture.output, "result.txt"), "utf8");
      assert.match(evidence, /^result=BLOCKED$/m);
      assert.match(evidence, new RegExp(`^failure_category=${category}$`, "m"));
      assertNoSensitiveFixtureData(fixture.output, fixture.token, fixture.apiKey);
    } finally {
      rmSync(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  });
}

test("configured URLs without an API key block before making network calls", () => {
  const { output, result } = runWithEnvironment({
    HEADSCALE_URL: "https://headscale.example.test",
    HEADPLANE_URL: "https://headplane.example.test",
    HEADSCALE_DERP_URL: "https://derp.example.test",
    HEADPLANE_NODE_API_URL: "https://headplane.example.test/api/safenet/node-status",
    HEADPLANE_NODE_API_TOKEN: "test-headplane-token",
    HEADSCALE_ANDROID_NODE_NAME: "phone",
    HEADSCALE_ANDROID_PEER_ADDRESS: "100.64.0.2",
    HEADSCALE_ANDROID_LOGIN_SERVER_CONFIRMED: "pass",
    HEADSCALE_PERSISTENT_STATE_CONFIRMED: "pass",
  });
  try {
    assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
    const evidence = readFileSync(join(output, "result.txt"), "utf8");
    assert.match(evidence, /^failure_category=CONTROL_PLANE_API_KEY_MISSING$/m);
    assert.match(evidence, /^headscale_url=https:\/\/headscale\.example\.test$/m);
    assert.doesNotMatch(evidence, /test-api-key|test-headplane-token|Bearer/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});