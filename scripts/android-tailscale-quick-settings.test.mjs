import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const manifest = read("../android/app/src/main/AndroidManifest.xml");
const strings = read("../android/app/src/main/res/values/strings.xml");
const tile = read("../android/app/src/main/java/com/safenet/dns/SafeNetTailscaleTileService.java");
const plugin = read("../android/app/src/main/java/com/safenet/dns/SafeNetTailscalePlugin.java");
const vpnService = read("../android/app/src/main/java/com/safenet/dns/SafeNetTailscaleVpnService.java");
const mainActivity = read("../android/app/src/main/java/com/safenet/dns/MainActivity.java");
const app = read("../client/src/App.tsx");
const dashboard = read("../client/src/pages/Dashboard.tsx");

test("Android exposes the SafeNet Tailscale VPN Quick Settings tile", () => {
  assert.match(manifest, /SafeNetTailscaleTileService/);
  assert.match(manifest, /android\.permission\.BIND_QUICK_SETTINGS_TILE/);
  assert.match(manifest, /android\.service\.quicksettings\.action\.QS_TILE/);
  assert.match(manifest, /ic_qs_tailscale/);
  assert.match(strings, /tailscale_vpn_tile_label">SafeNet Tailscale VPN</);
});

test("the tile reflects native tunnel state and routes taps through MainActivity", () => {
  assert.match(tile, /SafeNetTailscalePlugin\.isConnected\(\)/);
  assert.match(tile, /Tile\.STATE_ACTIVE/);
  assert.match(tile, /Tile\.STATE_INACTIVE/);
  assert.match(tile, /setAction\(ACTION_TOGGLE\)/);
  assert.match(tile, /startActivityAndCollapse\(toggleIntent\)/);
  assert.match(plugin, /static boolean isConnected\(\)/);
  assert.match(plugin, /SafeNetTailscaleTileService\.requestTileRefresh\(context\)/);
  assert.match(vpnService, /SafeNetTailscalePlugin\.setConnected\(connected, this\)/);
});

test("Quick Settings toggles preserve App Lock, EULA, and Android VPN consent", () => {
  assert.match(mainActivity, /AppLockManager\.isEnabled\(this\)/);
  assert.match(mainActivity, /AppLockManager\.isSessionAuthenticated\(\)/);
  assert.match(mainActivity, /__safenetHandleTailscaleTileToggle/);
  assert.match(app, /__safenetHandleTailscaleTileToggle/);
  assert.match(app, /setLocation\("\/"\)/);
  assert.match(dashboard, /safenet:tailscale-tile-toggle/);
  assert.match(dashboard, /if \(tailscaleVpn\.status\.connected\)/);
  assert.match(dashboard, /void runTailscaleDisconnect\(\)/);
  assert.match(dashboard, /requestTailscaleConnect\(\)/);
  assert.match(dashboard, /setTailscaleEulaOpen\(true\)/);
});