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
    description: "FamilyShield uses plain DNS; OpenDNS Home does not provide a public DNS-over-TLS endpoint.",
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

export type DnsResolverPreset = {
  name: string;
  type: "plain" | "doh" | "dot";
  ipVersion: "ipv4" | "ipv6";
  primaryAddress: string;
  secondaryAddress: string | null;
  description: string;
};

/**
 * Fixed family-safe resolver configurations that can be activated by SafeNet.
 * NextDNS is intentionally not included: its family policy is stored in a
 * user-specific profile and requires a profile URL rather than a shared IP.
 */
export const DNS_FAMILY_RESOLVER_PRESETS: readonly DnsResolverPreset[] = [
  {
    name: "Cloudflare (TLS)",
    type: "dot",
    ipVersion: "ipv4",
    primaryAddress: "one.one.one.one",
    secondaryAddress: null,
    description: "Cloudflare's standard DNS-over-TLS resolver without family filtering.",
  },
  {
    name: "Cloudflare (Family)",
    type: "dot",
    ipVersion: "ipv4",
    primaryAddress: "family.cloudflare-dns.com",
    secondaryAddress: null,
    description: "Blocks malware, phishing, and adult content. Cloudflare applies filtering while DNS stays encrypted.",
  },
  {
    name: "AdGuard DNS (Family · TLS)",
    type: "dot",
    ipVersion: "ipv4",
    primaryAddress: "family.adguard-dns.com",
    secondaryAddress: null,
    description: "The same family filters over DNS-over-TLS for Android Private DNS.",
  },
  {
    name: "Control D (Family · TLS)",
    type: "dot",
    ipVersion: "ipv4",
    primaryAddress: "family.freedns.controld.com",
    secondaryAddress: null,
    description: "The free Family Friendly resolver over DNS-over-TLS for Android Private DNS.",
  },
  {
    name: "CleanBrowsing (Family Filter)",
    type: "dot",
    ipVersion: "ipv4",
    primaryAddress: "family-filter-dns.cleanbrowsing.org",
    secondaryAddress: null,
    description: "CleanBrowsing's family filter over DNS-over-TLS.",
  },
  {
    name: "OpenDNS (FamilyShield)",
    type: "plain",
    ipVersion: "ipv4",
    primaryAddress: "208.67.222.123",
    secondaryAddress: "208.67.220.123",
    description: "FamilyShield protection over plain DNS; OpenDNS Home has no public DNS-over-TLS endpoint.",
  },
] as const;

/**
 * NextDNS's generic encrypted hostname. Profile-specific filtering uses
 * <profile-id>.dns.nextdns.io; the Android Private DNS card selects that
 * hostname when a NextDNS profile is connected.
 */
export const DNS_NEXTDNS_DOT_RESOLVER_PRESET: DnsResolverPreset = {
  name: "NextDNS (TLS)",
  type: "dot",
  ipVersion: "ipv4",
  primaryAddress: "dns.nextdns.io",
  secondaryAddress: null,
  description: "Encrypted DNS-over-TLS. Connect a NextDNS profile to use its profile-specific settings.",
};