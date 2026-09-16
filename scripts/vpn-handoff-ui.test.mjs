import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardSource = await readFile("client/src/pages/Dashboard.tsx", "utf8");

test("Dashboard switches away from the other Android VPN before starting", () => {
  assert.match(
    dashboardSource,
    /const startDnsProtection = async \(\) => \{[\s\S]*?await vpn\.stopWireGuard\(\);[\s\S]*?await vpn\.start\(/,
  );
  assert.match(
    dashboardSource,
    /const startWireGuardProtection = async \(\) => \{[\s\S]*?await vpn\.stop\(\);[\s\S]*?await vpn\.startWireGuard\(/,
  );
});

test("WireGuard remains actionable while DNS protection is running", () => {
  assert.match(
    dashboardSource,
    /disabled=\{\s*vpn\.isBusy \|\|\s*vpn\.status === null\s*\}/,
  );
  assert.match(
    dashboardSource,
    /Turning on WireGuard will safely switch off SafeNet DNS protection first/,
  );
});