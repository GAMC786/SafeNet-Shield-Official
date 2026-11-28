import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { CyberCard } from "@/components/CyberCard";
import { LocalVpnEulaDialog } from "@/components/LocalVpnEulaDialog";
import { useFirewallConfig } from "@/hooks/use-firewall-config";
import { useDnsServers } from "@/hooks/use-dns";
import { useLocalVpn } from "@/hooks/use-local-vpn";
import { SafeNetVpn } from "@/hooks/use-vpn";
import { enqueueNativeCommand } from "@/lib/native-command-queue";
import { usePersistentState } from "@/hooks/use-persistent-state";

const LOCAL_VPN_EULA_VERSION = "2026-11-25-access-rules";

export function LocalDnsVpnCard() {
  const { data: dnsServers } = useDnsServers();
  const firewallConfigQuery = useFirewallConfig();
  const activeDns = dnsServers?.find((server) => server.isActive);
  const localVpn = useLocalVpn();
  const appliedResolverKey = useRef<string | null>(null);
  const recoveryAttemptedKey = useRef<string | null>(null);
  const [eulaOpen, setEulaOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [acceptedEulaVersion, setAcceptedEulaVersion] = usePersistentState<string | null>(
    "safenet-local-vpn-eula-version",
    null,
  );

  const resolverKey = activeDns
    ? `${activeDns.type}|${activeDns.primaryAddress}|${activeDns.secondaryAddress ?? ""}`
    : null;

  const start = async () => {
    if (!activeDns) return;
    setPreparing(true);
    setStartError(null);
    try {
      const refreshedConfig = await firewallConfigQuery.refetch();
      if (!refreshedConfig.data) {
        throw refreshedConfig.error ?? new Error("Could not load the latest firewall rules.");
      }
      await enqueueNativeCommand(() =>
        SafeNetVpn.syncFirewallConfig({ config: refreshedConfig.data! }),
      );
      const status = await localVpn.start({
        type: activeDns.type,
        primaryAddress: activeDns.primaryAddress,
        secondaryAddress: activeDns.secondaryAddress,
      });
      if (!status?.connected) {
        throw new Error(localVpn.error || "SafeNet could not start its local VPN.");
      }
      appliedResolverKey.current = resolverKey;
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Could not prepare phone DNS protection.");
    } finally {
      setPreparing(false);
    }
  };

  useEffect(() => {
    if (!localVpn.shouldRecover || localVpn.connected) {
      recoveryAttemptedKey.current = null;
      return;
    }
    if (
      localVpn.error ||
      preparing ||
      localVpn.busy ||
      !activeDns ||
      !resolverKey ||
      recoveryAttemptedKey.current === resolverKey
    ) {
      return;
    }
    recoveryAttemptedKey.current = resolverKey;
    appliedResolverKey.current = resolverKey;
    void start();
  }, [
    activeDns,
    localVpn.busy,
    localVpn.connected,
    localVpn.error,
    localVpn.shouldRecover,
    preparing,
    resolverKey,
  ]);

  useEffect(() => {
    if (!localVpn.connected || !activeDns || !resolverKey || appliedResolverKey.current === resolverKey) return;
    appliedResolverKey.current = resolverKey;
    void start();
  }, [activeDns, localVpn.connected, resolverKey]);

  const toggle = (enabled: boolean) => {
    if (enabled) {
      if (!activeDns) return;
      if (acceptedEulaVersion !== LOCAL_VPN_EULA_VERSION) {
        setEulaOpen(true);
        return;
      }
      void start();
      return;
    }
    void localVpn.stop();
  };

  const statusText = !localVpn.supported
    ? "Available in the SafeNet Android app."
    : preparing || localVpn.busy
      ? "Updating DNS protection…"
      : localVpn.connected
        ? `Filtering direct DNS requests through ${activeDns?.name ?? "the selected resolver"}.`
        : localVpn.shouldRecover
          ? "Reconnecting phone DNS protection…"
        : activeDns
          ? "Off · turn on to filter direct DNS traffic on this phone."
          : "Select a DNS resolver before enabling phone protection.";

  return (
    <CyberCard className="w-full">
      <LocalVpnEulaDialog
        open={eulaOpen}
        onOpenChange={setEulaOpen}
        onCancel={() => setEulaOpen(false)}
        onAccept={() => {
          setAcceptedEulaVersion(LOCAL_VPN_EULA_VERSION);
          setEulaOpen(false);
          void start();
        }}
      />
      <div className="space-y-3 rounded-lg border border-cyan-300/20 bg-cyan-300/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-cyan-300" />
            SafeNet DNS-only VPN
          </div>
          <Badge variant="outline" className={localVpn.connected
            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
            : "border-white/15 text-muted-foreground"}>
            {!localVpn.supported ? "Android only" : localVpn.connected ? "Active" : "Off"}
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-background/30 p-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Filter DNS on this phone</p>
            <p aria-live="polite" className="text-xs text-muted-foreground">{statusText}</p>
          </div>
          <Switch
            checked={localVpn.connected}
            disabled={!localVpn.supported || preparing || localVpn.busy || (!activeDns && !localVpn.connected)}
            onCheckedChange={toggle}
            aria-label="SafeNet DNS-only VPN"
            data-testid="switch-local-dns-vpn"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          SafeNet captures direct UDP/TCP DNS on port 53 and sends it through the selected resolver.
          Apps using their own encrypted DNS or another VPN may bypass this protection. Enabling it
          replaces any other active Android VPN; it is not a remote VPN service.
        </p>
        {(startError || localVpn.error || (localVpn.supported && !activeDns && !localVpn.connected)) && (
          <p role="status" data-testid="local-dns-vpn-error" className="text-xs text-amber-200">
            {startError ?? localVpn.error ?? "Choose a DNS provider on Firewall or DNS Servers first."}
          </p>
        )}
      </div>
    </CyberCard>
  );
}
