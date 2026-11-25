export type ProtectionStatusInput = {
  platform: "android" | "web";
  serverAvailable: boolean;
  privateDnsRunning: boolean;
  localDnsVpnRunning: boolean;
  firewallEnabled: boolean;
  antivirusEnabled: boolean;
  antivirusVerified: boolean;
};

/**
 * Computes the dashboard's high-level protection indicator without making
 * feature-specific hooks depend on each other.
 *
 * Android protection follows either native Private DNS or SafeNet's DNS-only
 * VPN. Browser protection requires configured server controls and a verified
 * antivirus engine.
 */
export function isProtectionActive(input: ProtectionStatusInput): boolean {
  if (input.platform === "android") {
    return input.privateDnsRunning || input.localDnsVpnRunning;
  }

  return input.serverAvailable
    && input.firewallEnabled
    && input.antivirusEnabled
    && input.antivirusVerified;
}