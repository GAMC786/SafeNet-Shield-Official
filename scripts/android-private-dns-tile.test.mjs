import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
const tileService = readFileSync(
  new URL("../android/app/src/main/java/com/safenet/dns/SafeNetPrivateDnsTileService.java", import.meta.url),
  "utf8",
);
const protectionStatus = readFileSync(
  new URL("../android/app/src/main/java/com/safenet/dns/SafeNetProtectionStatus.java", import.meta.url),
  "utf8",
);

test("Android exposes a SafeNet Private DNS Quick Settings tile", () => {
  assert.match(manifest, /SafeNetPrivateDnsTileService/);
  assert.match(manifest, /BIND_QUICK_SETTINGS_TILE/);
  assert.match(manifest, /android\.service\.quicksettings\.action\.QS_TILE/);
  assert.match(manifest, /private_dns_tile_label/);
});

test("the tile uses verified Private DNS state and opens system settings", () => {
  assert.match(tileService, /private_dns_tile_label/);
  assert.match(tileService, /SafeNetProtectionStatus\.isPrivateDnsActive/);
  assert.match(tileService, /PRIVATE_DNS_SETTINGS/);
  assert.match(tileService, /STATE_ACTIVE/);
  assert.match(tileService, /STATE_INACTIVE/);
  assert.match(protectionStatus, /static boolean isPrivateDnsActive/);
});