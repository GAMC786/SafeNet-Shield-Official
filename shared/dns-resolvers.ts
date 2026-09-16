export const DEFAULT_DNS_RESOLVER = {
  name: "SafeNet Default",
  type: "doh" as const,
  ipVersion: "ipv4" as const,
  primaryAddress: "https://dns.google/dns-query",
  secondaryAddress: "https://cloudflare-dns.com/dns-query",
  isActive: true,
  isCustom: false,
} as const;

export type DnsProviderAccessRule = {
  id: string;
  name: string;
  description: string;
  addresses: readonly string[];
};

/**
 * Public resolver addresses used by the Firewall Access Rules presets.
 *
 * These are address-based rules because Android evaluates firewall rules
 * against the destination IP of a DNS packet. Encrypted resolver hostnames
 * and profile-specific URLs remain configurable in DNS Settings.
 */
export const DNS_PROVIDER_ACCESS_RULES: readonly DnsProviderAccessRule[] = [
  {
    id: "nextdns",
    name: "NextDNS",
    description: "Family protection is profile-based; configure a family-safe NextDNS profile URL in DNS Settings.",
    addresses: [
      "45.90.28.0",
      "45.90.30.0",
      "2a07:a8c0::",
      "2a07:a8c1::",
    ],
  },
  {
    id: "control-d",
    name: "Control D Family",
    description: "Control D Family Friendly free resolver preset.",
    addresses: [
      "76.76.2.4",
      "76.76.10.4",
      "2606:1a40::4",
      "2606:1a40:1::4",
    ],
  },
  {
    id: "opendns",
    name: "OpenDNS FamilyShield",
    description: "OpenDNS FamilyShield resolvers for adult-content protection.",
    addresses: [
      "208.67.222.123",
      "208.67.220.123",
    ],
  },
  {
    id: "adguard-dns",
    name: "AdGuard DNS Family",
    description: "AdGuard family protection with adult-content blocking and Safe Search where supported.",
    addresses: [
      "94.140.14.15",
      "94.140.15.16",
      "2a10:50c0::bad1:ff",
      "2a10:50c0::bad2:ff",
    ],
  },
] as const;