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
const uiInstrumentation = await readFile(
  new URL("../android/app/src/androidTest/java/com/safenet/dns/SafeNetVpnUiInstrumentationTest.java", import.meta.url),
  "utf8",
);
const physicalConnectivityScript = await readFile(
  new URL("./android-physical-connectivity-test.sh", import.meta.url),
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
  assert.match(instrumentation, /ordinary_https=PASS/);
  assert.match(instrumentation, /default_route=PASS/);
  assert.match(instrumentation, /category=ROUTE/);
  assert.match(instrumentation, /category=DNS/);
  assert.match(instrumentation, /classifyWireGuardFailure/);
});

test("WireGuard instrumentation uses the shipped bridge and Android VPN transport", () => {
  assert.match(
    instrumentation,
    /window\.Capacitor\.Plugins\.SafeNetVpn\.startWireGuard/,
  );
  assert.match(instrumentation, /wireguardGatewayOwner/);
  assert.match(instrumentation, /NetworkCapabilities\.TRANSPORT_VPN/);
  assert.match(instrumentation, /WIREGUARD_SMOKE result=PASS/);
  assert.match(instrumentation, /checkOrdinaryConnectivity\(\)/);
});

test("physical validation records resolver modes, internet reachability, and dashboard handoff", () => {
  assert.match(physicalConnectivityScript, /publicResolverModesKeepOrdinaryHttpsReachable/);
  assert.match(physicalConnectivityScript, /PHYSICAL_DNS_MODE mode=plain result=PASS/);
  assert.match(physicalConnectivityScript, /PHYSICAL_DNS_MODE mode=doh result=PASS/);
  assert.match(physicalConnectivityScript, /PHYSICAL_DNS_MODE mode=dot result=PASS/);
  assert.match(physicalConnectivityScript, /PHYSICAL_VPN_SWITCH result=PASS/);
  assert.match(uiInstrumentation, /dashboardSwitchesBetweenDnsAndWireGuardWithoutManualTeardown/);
  assert.match(uiInstrumentation, /dns_to_wireguard=PASS wireguard_to_dns=PASS/);
});