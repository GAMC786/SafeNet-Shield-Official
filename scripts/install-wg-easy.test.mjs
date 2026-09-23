import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";

const installerPath = new URL("./install-wg-easy.sh", import.meta.url);
const installer = await readFile(installerPath, "utf8");
const verifierPath = new URL("./verify-wg-easy-peer.sh", import.meta.url);
const verifier = await readFile(verifierPath, "utf8");

test("WG-Easy installer is valid shell and keeps the required host contract", () => {
  execFileSync("bash", ["-n", installerPath.pathname]);

  assert.match(installer, /raw\.githubusercontent\.com\/wg-easy\/wg-easy\/master\/docker-compose\.yml/);
  assert.match(installer, /\/etc\/wireguard/);
  assert.match(installer, /51820:51820\/udp/);
  assert.match(installer, /51821:51821\/tcp/);
  assert.match(installer, /docker volume inspect/);
  assert.match(installer, /docker compose/);
  assert.match(installer, /ufw allow 51820\/udp/);
  assert.match(installer, /firewall-cmd --permanent --add-port=51820\/udp/);
  assert.match(installer, /WG_EASY_URL/);
  assert.match(installer, /WG_EASY_WIREGUARD_ENDPOINT/);
  assert.match(installer, /verify-wg-easy-peer\.sh/);
  assert.match(installer, /WG_EASY_VERIFY_TUNNEL/);
});

test("WG-Easy installer can be invoked directly on a host", async () => {
  const mode = (await stat(installerPath)).mode;
  assert.ok((mode & 0o111) !== 0, "installer must have an executable bit");
});

test("the disposable-peer verifier keeps the tunnel proof separate from admin health", () => {
  execFileSync("bash", ["-n", verifierPath.pathname]);
  assert.match(verifier, /POST.*api\/client|--data.*expiresAt/);
  assert.match(verifier, /api\/client\/\$\{CLIENT_ID\}\/configuration/);
  assert.match(verifier, /wg show.*latest-handshakes/);
  assert.match(verifier, /docker exec.*latest-handshakes/);
  assert.match(verifier, /--request DELETE.*api\/client\/\$\{CLIENT_ID\}/);
  assert.match(verifier, /private key stay in a mode-600 temporary file/);
  assert.doesNotMatch(verifier, /echo.*private_key|echo.*CONFIG_FILE/);
});