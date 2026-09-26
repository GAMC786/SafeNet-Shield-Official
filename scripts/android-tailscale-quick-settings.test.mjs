import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const manifest = read("../android/app/src/main/AndroidManifest.xml");
const strings = read("../android/app/src/main/res/values/strings.xml");
const tile = read("../android/app/src/main/java/com/safenet/dns/SafeNetWindscribeTileService.java");
const plugin = read("../android/app/src/main/java/com/safenet/dns/SafeNetWindscribePlugin.java");
const mainActivity = read("../android/app/src/main/java/com/safenet/dns/MainActivity.java");
const app = read("../client/src/App.tsx");
const windscribeCard = read("../client/src/components/WindscribeVpnCard.tsx");
const windscribeEulaDialog = read("../client/src/components/WindscribeEulaDialog.tsx");

test("Android exposes the SafeNet Windscribe VPN Quick Settings tile", () => {
  assert.match(manifest, /SafeNetWindscribeTileService/);
  assert.match(manifest, /android\.permission\.BIND_QUICK_SETTINGS_TILE/);
  assert.match(manifest, /android\.service\.quicksettings\.action\.QS_TILE/);
  assert.match(manifest, /GoBackend\$VpnService/);
  assert.match(manifest, /ic_qs_windscribe/);
  assert.match(strings, /windscribe_vpn_tile_label">SafeNet Windscribe VPN</);
});

test("the tile reflects native tunnel state and routes taps through MainActivity", () => {
  assert.match(tile, /SafeNetWindscribePlugin\.isConnected\(\)/);
  assert.match(tile, /Tile\.STATE_ACTIVE/);
  assert.match(tile, /Tile\.STATE_INACTIVE/);
  assert.match(tile, /setAction\(ACTION_TOGGLE\)/);
  assert.match(tile, /startActivityAndCollapse\(toggleIntent\)/);
  assert.match(plugin, /static boolean isConnected\(\)/);
  assert.match(plugin, /SafeNetWindscribeTileService\.requestTileRefresh\(context\)/);
  assert.match(plugin, /onStateChange\(State state\)/);
});

test("Windscribe VPN connections require accepting the official EULA", () => {
  assert.match(windscribeCard, /!windscribeEulaAccepted/);
  assert.match(windscribeCard, /pendingConnectAfterEula\.current = true/);
  assert.match(windscribeCard, /link-windscribe-eula/);
  assert.match(windscribeCard, /WINDSCRIBE_EULA_STORAGE_KEY/);
  assert.match(windscribeEulaDialog, /https:\/\/windscribe\.com\/terms\/eula/);
  assert.match(windscribeEulaDialog, /data-testid="dialog-windscribe-eula"/);
  assert.match(windscribeEulaDialog, /Agree &amp; Connect/);
});

test("Quick Settings toggles preserve App Lock and Android VPN consent", () => {
  assert.match(mainActivity, /AppLockManager\.isEnabled\(this\)/);
  assert.match(mainActivity, /AppLockManager\.isSessionAuthenticated\(\)/);
  assert.match(mainActivity, /__safenetHandleWindscribeTileToggle/);
  assert.match(app, /__safenetHandleWindscribeTileToggle/);
  assert.match(app, /setLocation\("\/"\)/);
  assert.match(windscribeCard, /safenet:windscribe-tile-toggle/);
  assert.match(windscribeCard, /if \(connected\) \{\s+void perform\(vpn\.disconnect\);/);
  assert.match(windscribeCard, /void perform\(vpn\.connect\)/);
  assert.match(plugin, /VpnService\.prepare/);
  assert.match(plugin, /vpnConsentResult/);
});