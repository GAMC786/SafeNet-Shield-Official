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
    description: "Standard public endpoints; use a profile URL in DNS Settings for custom NextDNS policies.",
    addresses: [
      "45.90.28.0",
      "45.90.30.0",
      "2a07:a8c0::",
      "2a07:a8c1::",
    ],
  },
  {
    id: "control-d",
    name: "Control D",
    description: "Free unfiltered public resolver endpoints.",
    addresses: [
      "76.76.2.0",
      "76.76.10.0",
      "2606:1a40::0",
      "2606:1a40:1::0",
    ],
  },
  {
    id: "opendns",
    name: "OpenDNS",
    description: "OpenDNS standard resolvers.",
    addresses: [
      "208.67.222.222",
      "208.67.220.220",
    ],
  },
  {
    id: "adguard-dns",
    name: "AdGuard DNS",
    description: "AdGuard public unfiltered DNS resolvers.",
    addresses: [
      "94.140.14.140",
      "94.140.14.141",
      "2a10:50c0::1:ff",
      "2a10:50c0::2:ff",
    ],
  },
] as const;