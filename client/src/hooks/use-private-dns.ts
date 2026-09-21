import { useCallback, useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { DnsServer } from "@shared/schema";
import { enqueueNativeCommand } from "@/lib/native-command-queue";
import { SafeNetVpn } from "@/hooks/use-vpn";

export const SAFE_NET_PRIVATE_DNS_EULA_VERSION = "1.0";

export type PrivateDnsStatus = {
  supported: boolean;
  running: boolean;
  mode: "off" | "automatic" | "hostname" | "unknown";
  hostname: string | null;
  expectedHostname: string | null;
  message: string;
  error?: string | null;
};

/**
 * Android Private DNS accepts a DNS-over-TLS hostname, not an IP address or
 * DNS-over-HTTPS URL. Most encrypted resolver providers use the same hostname
 * for DoH and DoT, so a configured DoH endpoint can still be used here.
 */
export function privateDnsHostnameForServer(server: DnsServer | null | undefined): string | null {
  if (!server) return null;
  if (server.type === "dot") {
    return normalizeHostname(server.primaryAddress);
  }
  if (server.type === "doh") {
    try {
      return new URL(server.primaryAddress).hostname || null;
    } catch {
      return null;
    }
  }
  const normalizedAddress = server.primaryAddress.trim().toLowerCase();
  if (/^45\.90\.(28|30)\.\d{1,3}$/.test(normalizedAddress)) {
    return "dns.nextdns.io";
  }
  if (normalizedAddress === "208.67.222.123" || normalizedAddress === "208.67.220.123") {
    return "familyshield.opendns.com";
  }
  return null;
}

function normalizeHostname(value: string) {
  const trimmed = value.trim().replace(/\.$/, "");
  if (!trimmed || trimmed.includes("/") || trimmed.includes(" ")) return null;
  if (trimmed.includes(":")) {
    const portMatch = trimmed.match(/^([^:]+):\d{1,5}$/);
    if (!portMatch) return null;
    return portMatch[1].toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function usePrivateDns(server: DnsServer | null | undefined) {
  const supported = Capacitor.getPlatform() === "android";
  const expectedHostname = useMemo(() => privateDnsHostnameForServer(server), [server]);
  const [status, setStatus] = useState<PrivateDnsStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported) return null;
    try {
      const nextStatus = await enqueueNativeCommand(() =>
        SafeNetVpn.getPrivateDnsStatus({ expectedHostname: expectedHostname ?? "" }),
      );
      setStatus(nextStatus);
      return nextStatus;
    } catch {
      const unavailable: PrivateDnsStatus = {
        supported: true,
        running: false,
        mode: "unknown",
        hostname: null,
        expectedHostname,
        message: "Android Private DNS status is unavailable.",
        error: "Android Private DNS status is unavailable.",
      };
      setStatus(unavailable);
      return unavailable;
    }
  }, [expectedHostname, supported]);

  useEffect(() => {
    if (!supported) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(interval);
  }, [refresh, supported]);

  const openSettings = useCallback(async () => {
    if (!supported) return null;
    setIsBusy(true);
    try {
      const nextStatus = await enqueueNativeCommand(() =>
        SafeNetVpn.openPrivateDnsSettings({ expectedHostname: expectedHostname ?? "" }),
      );
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, [expectedHostname, supported]);

  return { supported, expectedHostname, status, isBusy, refresh, openSettings };
}