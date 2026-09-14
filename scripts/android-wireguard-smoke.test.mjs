import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const smokeScript = await readFile(
  new URL("./android-smoke-test.sh", import.meta.url),
  "utf8",
);
const instrumentation = await readFile(
  new URL("../android/app/src/androidTest/java/com/safenet/dns/SafeNetVpnInstrumentationTest.java", import.meta.url),
  "utf8",
);

test("Android smoke runs the configured WireGuard release check", () => {
  assert.match(
    smokeScript,
    /configuredWireGuardStartsTunnelAndReportsSafeNetGateway/,
  );
  assert.match(smokeScript, /wireguard-result\.txt/);
  assert.match(smokeScript, /wireguard-failure-category\.txt/);
  assert.match(smokeScript, /category=CONFIGURATION/);
  assert.match(smokeScript, /category=PERMISSION/);
  assert.match(smokeScript, /GATEWAY_CONNECTIVITY/);
});

test("WireGuard instrumentation uses the shipped bridge and Android VPN transport", () => {
  assert.match(
    instrumentation,
    /window\.Capacitor\.Plugins\.SafeNetVpn\.startWireGuard/,
  );
  assert.match(instrumentation, /wireguardGatewayOwner/);
  assert.match(instrumentation, /NetworkCapabilities\.TRANSPORT_VPN/);
  assert.match(instrumentation, /WIREGUARD_SMOKE result=PASS/);
});