import assert from "node:assert/strict";
import test from "node:test";
import { isProtectionActive } from "./protection-status";

const webDefaults = {
  platform: "web" as const,
  serverAvailable: true,
  privateDnsRunning: false,
  localDnsVpnRunning: false,
  firewallEnabled: true,
  antivirusEnabled: true,
  antivirusVerified: true,
};

test("browser protection requires every independent protection dependency", () => {
  assert.equal(isProtectionActive(webDefaults), true);
  assert.equal(isProtectionActive({ ...webDefaults, firewallEnabled: false }), false);
  assert.equal(isProtectionActive({ ...webDefaults, antivirusEnabled: false }), false);
  assert.equal(isProtectionActive({ ...webDefaults, antivirusVerified: false }), false);
  assert.equal(isProtectionActive({ ...webDefaults, serverAvailable: false }), false);
});

test("Android protection follows Private DNS or the local DNS VPN", () => {
  const android = {
    ...webDefaults,
    platform: "android" as const,
    privateDnsRunning: true,
    firewallEnabled: false,
    antivirusEnabled: false,
    antivirusVerified: false,
  };

  assert.equal(isProtectionActive(android), true);
  assert.equal(isProtectionActive({ ...android, privateDnsRunning: false }), false);
  assert.equal(isProtectionActive({ ...android, privateDnsRunning: false, localDnsVpnRunning: true }), true);
});