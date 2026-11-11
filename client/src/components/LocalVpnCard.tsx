import { useState } from "react";
import { Globe2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CyberCard } from "@/components/CyberCard";
import { useLocalVpn } from "@/hooks/use-local-vpn";
import { usePrivateDns } from "@/hooks/use-private-dns";
import { useDnsServers } from "@/hooks/use-dns";

export function LocalVpnCard() {
  const vpn = useLocalVpn();
  const { data: dnsServers } = useDnsServers();
  const activeDns = dnsServers?.find((server) => server.isActive);
  const privateDns = usePrivateDns(activeDns);
  const [mode, setMode] = useState<"local" | "system">("local");
  const [message, setMessage] = useState<string | null>(null);

  const chooseSystemMode = async () => {
    setMode("system");
    if (vpn.connected) await vpn.stop();
  };

  const configureSystemDns = async () => {
    setMessage(null);
    try {
      if (!privateDns.expectedHostname) {
        setMessage("This resolver cannot be configured through Android Private DNS. Use Local VPN instead.");
        return;
      }
      const result = privateDns.status?.oneTapAvailable
        ? await privateDns.applyOneTap()
        : await privateDns.openSettings();
      setMessage(result?.message ?? `Choose Private DNS provider hostname: ${privateDns.expectedHostname}`);
    } catch {
      setMessage(`Open Android Private DNS settings and enter ${privateDns.expectedHostname}.`);
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
              Protects this phone only. Filters DNS-based in-app ads and trackers through your selected DNS server; no VPN server is required.
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
          <Button
            disabled={!vpn.supported || vpn.busy || (!vpn.connected && !activeDns)}
            onClick={() => void (vpn.connected ? vpn.stop() : activeDns && vpn.start(activeDns))}
          >
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
            Active DNS server: {activeDns?.name ?? "None selected"}
            {privateDns.expectedHostname
              ? ` · Android Private DNS hostname: ${privateDns.expectedHostname}`
              : activeDns?.type === "sdns"
                ? " · SDNS stamps are not supported by Android Private DNS."
                : ""}
          </p>
        )}
        {mode === "local" && (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Selected DNS server: {activeDns?.name ?? "No active DNS server selected"}</p>
            {vpn.connected && <p>Stop and restart protection after changing the active DNS server.</p>}
          </div>
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
