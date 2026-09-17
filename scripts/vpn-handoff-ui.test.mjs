import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardSource = await readFile("client/src/pages/Dashboard.tsx", "utf8");

test("Dashboard starts only WireGuard and clears a legacy DNS tunnel first", () => {
  assert.match(
    dashboardSource,
    /const startWireGuardProtection = async \(\) => \{[\s\S]*?await vpn\.stop\(\);[\s\S]*?await vpn\.startWireGuard\(/,
  );
  assert.doesNotMatch(dashboardSource, /const startDnsProtection/);
  assert.doesNotMatch(dashboardSource, /SafeNet VPN On\/Off/);
});

test("WireGuard is the only dashboard VPN control", () => {
  assert.match(
    dashboardSource,
    /disabled=\{\s*vpn\.isBusy \|\|\s*vpn\.status === null\s*\}/,
  );
  assert.match(dashboardSource, /WireGuard is the only VPN path exposed by SafeNet/);
  assert.doesNotMatch(dashboardSource, /dashboard-vpn-card/);
});

test("WireGuard requires the shared EULA before connecting", () => {
  assert.match(dashboardSource, /EulaDialog/);
  assert.match(dashboardSource, /View WireGuard EULA/);
  assert.match(dashboardSource, /!vpn\.status\?\.eulaAccepted/);
  assert.match(dashboardSource, /await vpn\.acceptEula\(\)/);
});