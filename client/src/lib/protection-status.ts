export type ProtectionStatusInput = {
  platform: "android" | "web";
  serverAvailable: boolean;
  privateDnsRunning: boolean;
  firewallEnabled: boolean;
  antivirusEnabled: boolean;
  antivirusVerified: boolean;
};

/**
 * Computes the dashboard's high-level protection indicator without making
 * feature-specific hooks depend on each other.
 *
 * Android uses the native Private DNS result. Browser protection requires both
 * configured server controls and a verified antivirus engine.
 */
export function isProtectionActive(input: ProtectionStatusInput): boolean {
  if (input.platform === "android") {
    return input.privateDnsRunning;
  }

  return input.serverAvailable
    && input.firewallEnabled
    && input.antivirusEnabled
    && input.antivirusVerified;
}