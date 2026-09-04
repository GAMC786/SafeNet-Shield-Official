export const DEFAULT_DNS_RESOLVER = {
  name: "SafeNet Default",
  type: "doh" as const,
  primaryAddress: "https://dns.google/dns-query",
  secondaryAddress: "https://cloudflare-dns.com/dns-query",
  isActive: true,
  isCustom: false,
} as const;