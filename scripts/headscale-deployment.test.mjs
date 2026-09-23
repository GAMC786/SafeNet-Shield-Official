import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("persistent Headscale proof bundle keeps state and public mesh ports", async () => {
  const [compose, headscaleConfig, headplaneConfig, caddyfile, runbook, backupChecker, identityChecker] = await Promise.all([
    readFile("ops/headscale/compose.yaml", "utf8"),
    readFile("ops/headscale/headscale/config.yaml.example", "utf8"),
    readFile("ops/headscale/headplane/config.yaml.example", "utf8"),
    readFile("ops/headscale/Caddyfile", "utf8"),
    readFile("ops/headscale/README.md", "utf8"),
    readFile("ops/headscale/backup-restore-check.sh", "utf8"),
    readFile("ops/headscale/verify-restored-identities.sh", "utf8"),
  ]);

  assert.match(compose, /headscale\/lib:\/var\/lib\/headscale/);
  assert.match(compose, /headplane\/data:\/var\/lib\/headplane/);
  assert.match(compose, /caddy\/data:\/data/);
  assert.match(compose, /"3478:3478\/udp"/);
  assert.match(compose, /"443:443"/);
  assert.match(compose, /headscale:0\.29\.2/);
  assert.match(compose, /headplane:0\.7\.1/);
  assert.match(compose, /headscale_api_key/);
  assert.match(compose, /headplane_cookie_secret/);
  assert.match(headscaleConfig, /enabled: true/);
  assert.match(headscaleConfig, /stun_listen_addr: 0\.0\.0\.0:3478/);
  assert.match(headscaleConfig, /path: \/var\/lib\/headscale\/db\.sqlite/);
  assert.match(headplaneConfig, /data_path: \/var\/lib\/headplane/);
  assert.match(headplaneConfig, /api_key_path: \/run\/secrets\/headscale_api_key/);
  assert.match(caddyfile, /reverse_proxy headscale:8080/);
  assert.match(caddyfile, /reverse_proxy headplane:3000/);
  assert.match(runbook, /approved peer/);
  assert.match(runbook, /safenet-phone/);
  assert.match(runbook, /restore-check/);
  assert.match(runbook, /caddy\/data/);
  assert.match(backupChecker, /android_node_identity=RETAINED_IN_MANIFEST/);
  assert.match(backupChecker, /target must not already exist/);
  assert.match(identityChecker, /Authorization: Bearer/);
  assert.match(identityChecker, /raw_response=REMOVED/);
  assert.match(identityChecker, /approved_peer_identity=PASS/);
});