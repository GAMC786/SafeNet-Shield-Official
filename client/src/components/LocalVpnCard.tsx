import { useState } from "react";
import { Globe2, ShieldCheck } from "lucide-react";
import type { DnsServer } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CyberCard } from "@/components/CyberCard";
import { useLocalVpn } from "@/hooks/use-local-vpn";
import { usePrivateDns } from "@/hooks/use-private-dns";

const familyDns = {
  id: -1,
  name: "AdGuard DNS Family",
  type: "dot",
  ipVersion: "ipv4",
  primaryAddress: "family.adguard-dns.com",
  secondaryAddress: null,
  isActive: true,
  isCustom: true,
} as DnsServer;

export function LocalVpnCard() {
  const vpn = useLocalVpn();
  const privateDns = usePrivateDns(familyDns);
  const [mode, setMode] = useState<"local" | "system">("local");
  const [message, setMessage] = useState<string | null>(null);

  const chooseSystemMode = async () => {
    setMode("system");
    if (vpn.connected) await vpn.stop();
  };

  const configureSystemDns = async () => {
    setMessage(null);
    try {
      const result = privateDns.status?.oneTapAvailable
        ? await privateDns.applyOneTap()
        : await privateDns.openSettings();
      setMessage(result?.message ?? "Choose Private DNS provider hostname: family.adguard-dns.com");
    } catch {
      setMessage("Open Android Private DNS settings and enter family.adguard-dns.com.");
    }
  };

  return (
    <CyberCard className="w-full">
      <div className="space-y-4 rounded-lg border border-white/10 bg-background/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" />
              SafeNet Local VPN
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Protects this phone only. Filters DNS-based in-app ads and trackers through AdGuard Family; no VPN server is required.
            </p>
          </div>
          <Badge variant="outline">
            {!vpn.supported ? "Android only" : vpn.connected ? "Protected" : "Disconnected"}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={mode === "local" ? "default" : "outline"} onClick={() => setMode("local")}>
            Local VPN
          </Button>
          <Button size="sm" variant={mode === "system" ? "default" : "outline"} onClick={() => void chooseSystemMode()}>
            System / Private DNS
          </Button>
        </div>
        {mode === "local" ? (
          <Button disabled={!vpn.supported || vpn.busy} onClick={() => void (vpn.connected ? vpn.stop() : vpn.start())}>
            {vpn.busy ? "Working…" : vpn.connected ? "Stop protection" : "Protect this phone"}
          </Button>
        ) : (
          <Button disabled={!privateDns.supported || privateDns.isBusy} variant="outline" onClick={() => void configureSystemDns()}>
            <Globe2 className="mr-2 h-4 w-4" />
            Configure Android Private DNS
          </Button>
        )}
        {(vpn.error || message) && <p role="status" className="text-xs text-destructive">{vpn.error ?? message}</p>}
        {mode === "system" && (
          <p className="text-xs text-muted-foreground">
            Android Private DNS hostname: family.adguard-dns.com
          </p>
        )}
        {mode === "local" && (
          <p className="text-xs text-muted-foreground">
            Apps using their own DNS-over-HTTPS or DNS-over-TLS may bypass ad filtering.
          </p>
        )}
      </div>
    </CyberCard>
  );
}
