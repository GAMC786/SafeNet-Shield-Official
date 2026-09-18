import { useTetherShare } from "@/hooks/use-tether-share";
import {
  useCreateDnsServer,
  useDeleteDnsServer,
  useDnsServers,
  useActivateDnsServer,
  useUpdateDnsServer,
} from "@/hooks/use-dns";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe2,
  LockKeyhole,
  Pencil,
  Plus,
  Router,
  Save,
  Settings2,
  Share2,
  ShieldCheck,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import type { DnsServer } from "@shared/schema";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useDnsProtection } from "@/hooks/use-vpn";

type ResolverForm = {
  name: string;
  type: DnsServer["type"];
  ipVersion: "ipv4" | "ipv6";
  primaryAddress: string;
  secondaryAddress: string;
};

const emptyResolver: ResolverForm = {
  name: "",
  type: "plain",
  ipVersion: "ipv4",
  primaryAddress: "",
  secondaryAddress: "",
};

const resolverProtocols: Array<{
  type: DnsServer["type"];
  label: string;
  shortLabel: string;
  description: string;
}> = [
  { type: "plain", label: "Plain DNS", shortLabel: "Plain", description: "Standard DNS addresses for connected devices." },
  { type: "doh", label: "DNS over HTTPS", shortLabel: "DoH", description: "Encrypted DNS resolver URLs." },
  { type: "dot", label: "DNS over TLS", shortLabel: "DoT", description: "Encrypted DNS resolver hostnames." },
];

function resolverTypeLabel(type: DnsServer["type"]) {
  return type === "doh" ? "DNS over HTTPS" : type === "dot" ? "DNS over TLS" : "Plain DNS";
}

function resolverAddressPlaceholder(type: DnsServer["type"], ipVersion: ResolverForm["ipVersion"]) {
  if (type === "doh") return "https://dns.google/dns-query";
  if (type === "dot") return "dns.google";
  return ipVersion === "ipv6" ? "2001:4860:4860::8888" : "1.1.1.1";
}

function isValidResolverAddress(
  type: DnsServer["type"],
  ipVersion: ResolverForm["ipVersion"],
  address: string,
) {
  if (type === "plain") {
    const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address);
    const ipv6 = address.includes(":") && /^[0-9a-f:]+$/i.test(address);
    return ipVersion === "ipv4" ? ipv4 : ipv6;
  }
  if (type === "doh") {
    try {
      return new URL(address).protocol === "https:";
    } catch {
      return false;
    }
  }
  return /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(address) || address.includes(":");
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left transition-colors hover:border-primary/40"
      onClick={async () => {
        await navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      aria-label={`Copy ${label}`}
    >
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="block truncate font-mono text-sm text-white">{value}</span>
      </span>
      {copied ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : <Copy className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />}
    </button>
  );
}

export default function TetherShare() {
  const { supported, status, isBusy, start, stop, openWifiSettings, openAppSettings } = useTetherShare();
  const { data: dnsServers } = useDnsServers();
  const { toast } = useToast();
  const dnsProtection = useDnsProtection();
  const running = status?.running === true;
  const starting = status?.starting === true || isBusy;
  const createResolver = useCreateDnsServer();
  const updateResolver = useUpdateDnsServer();
  const deleteResolver = useDeleteDnsServer();
  const activateResolver = useActivateDnsServer();
  const [resolverDialogOpen, setResolverDialogOpen, clearResolverDialogOpen] = usePersistentState(
    "safenet-tether-resolver-dialog-open",
    false,
  );
  const [editingResolver, setEditingResolver] = useState<DnsServer | null>(null);
  const [editingResolverId, setEditingResolverId, clearEditingResolverId] = usePersistentState<number | null>(
    "safenet-tether-editing-resolver-id",
    null,
  );
  const [resolverForm, setResolverForm, clearResolverForm] = usePersistentState<ResolverForm>(
    "safenet-tether-resolver-draft",
    emptyResolver,
  );
  const [selectedResolverProtocol, setSelectedResolverProtocol] = useState<DnsServer["type"]>("plain");
  const isResolverMutating = createResolver.isPending ||
    updateResolver.isPending ||
    deleteResolver.isPending ||
    activateResolver.isPending;
  const nearbyWifiPermissionRequired =
    status?.lastError?.toLowerCase().includes("nearby wi-fi permission") === true;

  useEffect(() => {
    if (editingResolverId === null) {
      setEditingResolver(null);
      return;
    }
    const currentResolver = dnsServers?.find((server) => server.id === editingResolverId);
    if (currentResolver) setEditingResolver(currentResolver);
  }, [dnsServers, editingResolverId]);

  const resetResolverForm = () => {
    clearResolverForm();
    clearResolverDialogOpen();
    clearEditingResolverId();
    setEditingResolver(null);
  };

  const openCreateResolver = () => {
    resetResolverForm();
    setResolverDialogOpen(true);
  };

  const openEditResolver = (server: DnsServer) => {
    setEditingResolver(server);
    setEditingResolverId(server.id);
    setResolverForm({
      name: server.name,
      type: server.type,
      ipVersion: server.ipVersion,
      primaryAddress: server.primaryAddress,
      secondaryAddress: server.secondaryAddress || "",
    });
    setResolverDialogOpen(true);
  };

  const handleResolverSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = resolverForm.name.trim();
    const primaryAddress = resolverForm.primaryAddress.trim();
    const secondaryAddress = resolverForm.secondaryAddress.trim();

    if (!name || !primaryAddress) {
      toast({
        title: "Resolver details required",
        description: "Enter a resolver name and primary address.",
        variant: "destructive",
      });
      return;
    }
    if (!isValidResolverAddress(resolverForm.type, resolverForm.ipVersion, primaryAddress)) {
      toast({
        title: "Primary address is invalid",
        description: `Enter a valid ${resolverTypeLabel(resolverForm.type)} address.`,
        variant: "destructive",
      });
      return;
    }
    if (secondaryAddress && !isValidResolverAddress(resolverForm.type, resolverForm.ipVersion, secondaryAddress)) {
      toast({
        title: "Secondary address is invalid",
        description: "Use the same protocol and address family as the primary resolver.",
        variant: "destructive",
      });
      return;
    }

    try {
      const data = {
        name,
        type: resolverForm.type,
        ipVersion: resolverForm.ipVersion,
        primaryAddress,
        secondaryAddress: secondaryAddress || null,
      };
      if (editingResolver) {
        await updateResolver.mutateAsync({ id: editingResolver.id, ...data });
      } else {
        await createResolver.mutateAsync({
          ...data,
          isActive: false,
          isCustom: true,
        });
      }
      setResolverDialogOpen(false);
      clearResolverForm();
      clearResolverDialogOpen();
      clearEditingResolverId();
      setEditingResolver(null);
      toast({
        title: editingResolver ? "Resolver updated" : "Resolver added",
        description: `${name} is ready for Internet Share devices.`,
      });
    } catch (error) {
      toast({
        title: editingResolver ? "Resolver could not be updated" : "Resolver could not be added",
        description: error instanceof Error ? error.message : "Please check the resolver details and try again.",
        variant: "destructive",
      });
    }
  };

  const handleRemoveResolver = async (server: DnsServer) => {
    if (!window.confirm(`Remove ${server.name} from Internet Share DNS resolvers?`)) return;
    try {
      if (server.isActive && dnsProtection.status?.running) {
        await dnsProtection.stop();
      }
      await deleteResolver.mutateAsync(server.id);
      toast({ title: "Resolver removed", description: `${server.name} was removed.` });
    } catch (error) {
      toast({
        title: "Resolver could not be removed",
        description: error instanceof Error ? error.message : "Unable to remove this resolver.",
        variant: "destructive",
      });
    }
  };

  const handleActivateResolver = async (server: DnsServer) => {
    if (server.isActive) return;
    try {
      await activateResolver.mutateAsync(server.id);
      toast({
        title: "Resolver activated",
        description: `${server.name} is now the active SafeNet DNS resolver.`,
      });
    } catch (error) {
      toast({
        title: "Resolver could not be activated",
        description: error instanceof Error ? error.message : "Unable to activate this resolver.",
        variant: "destructive",
      });
    }
  };

  const handleToggle = async (nextRunning: boolean) => {
    if (!supported) {
      toast({
        title: "Android device required",
        description: "Internet Share uses Android Wi-Fi Direct and can be started from the SafeNet Android APK.",
      });
      return;
    }
    try {
      await (nextRunning ? start() : stop());
    } catch (error) {
      toast({
        title: "Internet Share could not be changed",
        description: error instanceof Error ? error.message : "Android could not change the sharing state.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <Header
        title="Internet Share"
        subtitle="No-root Wi-Fi Direct gateway"
        status={running ? "sharing" : "not-sharing"}
      />

      {!supported && (
        <CyberCard className="border-yellow-500/20 bg-yellow-500/5">
          <div className="flex items-start gap-3">
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-yellow-300" />
            <div>
              <h2 className="font-semibold text-white">Available in the SafeNet Android APK</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Internet Share uses Android Wi-Fi Direct and cannot be started from a desktop browser.
              </p>
            </div>
          </div>
        </CyberCard>
      )}

      {supported && status?.lastError && (
        <CyberCard className="border-destructive/30 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-white">
                {nearbyWifiPermissionRequired ? "Nearby Wi-Fi permission required" : "Internet Share needs attention"}
              </h2>
              <p className="mt-1 text-sm text-destructive" role="alert">
                {nearbyWifiPermissionRequired
                  ? "Turning on your phone hotspot does not grant SafeNet access to create a Wi-Fi Direct network. Allow Nearby devices in Android app settings, then return and tap Start sharing."
                  : status.lastError}
              </p>
              {nearbyWifiPermissionRequired && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 border-destructive/40 text-white hover:bg-destructive/10"
                  onClick={() => void openAppSettings()}
                >
                  <Settings2 className="mr-2 h-4 w-4" />
                  Open Android permissions
                </Button>
              )}
            </div>
          </div>
        </CyberCard>
      )}

      <CyberCard glow className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-transparent to-transparent">
        <div className="flex flex-col gap-6">
          <div className="flex items-start gap-4">
            <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border ${running ? "border-emerald-400/40 bg-emerald-400/10" : "border-primary/30 bg-primary/10"}`}>
              {running ? <Router className="h-8 w-8 text-emerald-300" /> : <Share2 className="h-8 w-8 text-primary" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-display font-bold text-white">Share this connection</h2>
                {running && <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">Broadcasting</span>}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Create a private Wi-Fi Direct network for nearby devices without root. SafeNet runs a local HTTP proxy so connected devices can use this phone&apos;s Wi-Fi or mobile connection.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 self-center rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <div className="text-right">
              <p className="text-sm font-semibold text-white">
                {starting ? "Updating…" : "Connection sharing"}
              </p>
              <p id="tether-share-toggle-help" className="text-xs text-muted-foreground">
                {starting ? "Applying change" : running ? "Tap to stop" : "Tap to start"}
              </p>
            </div>
            <Switch
              checked={running}
              disabled={!supported || starting}
              onCheckedChange={(checked) => void handleToggle(checked)}
              aria-label={`Share this connection ${running ? "On" : "Off"}`}
              aria-describedby="tether-share-toggle-help"
              data-testid="toggle-tether-sharing"
            />
          </div>
        </div>
      </CyberCard>

      <CyberCard className="border-emerald-400/20 bg-emerald-400/[0.04]">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-bold text-white">Recommended family DNS setup</h2>
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                    Manage active resolver
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Configure Plain DNS, DoH, and DoT options. Select one resolver when you want SafeNet protection to use it.
                </p>
              </div>
              <Button type="button" size="sm" onClick={openCreateResolver} disabled={isResolverMutating} className="w-full sm:w-auto">
                <Plus className="mr-2 h-4 w-4" /> Add resolver
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-lg border border-white/10 bg-black/20 p-1">
              {resolverProtocols.map((protocol) => {
                const resolverCount = dnsServers?.filter((server) => server.type === protocol.type).length ?? 0;
                const selected = selectedResolverProtocol === protocol.type;
                return (
                  <button
                    key={protocol.type}
                    type="button"
                    onClick={() => setSelectedResolverProtocol(protocol.type)}
                    className={`flex items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-semibold transition-colors ${
                      selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/10 hover:text-white"
                    }`}
                    aria-pressed={selected}
                  >
                    <span>{protocol.shortLabel}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${selected ? "bg-black/20" : "bg-white/10"}`}>
                      {resolverCount}
                    </span>
                  </button>
                );
              })}
            </div>

            {resolverProtocols.filter((protocol) => protocol.type === selectedResolverProtocol).map((protocol) => {
              const configuredResolvers = dnsServers?.filter((server) => server.type === protocol.type) ?? [];

              return (
                <div key={protocol.type} className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-display text-sm font-bold text-white">{protocol.label}</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{protocol.description}</p>
                    </div>
                    <Badge variant="outline" className="w-fit text-[10px] uppercase">
                      {configuredResolvers.length} configured
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-2">
                    {configuredResolvers.length ? configuredResolvers.map((server) => (
                      <div
                        key={server.id}
                        className={`rounded-lg border p-3 ${server.isActive ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/10 bg-white/[0.03]"}`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold text-white">{server.name}</p>
                              {server.isActive && <Badge className="bg-emerald-600 text-[10px] text-white">Active</Badge>}
                            </div>
                            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                              {server.primaryAddress}
                              {server.secondaryAddress && ` · ${server.secondaryAddress}`}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            {!server.isActive && (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => void handleActivateResolver(server)}
                                disabled={isResolverMutating}
                                aria-label={`Activate ${server.name}`}
                              >
                                Activate
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openEditResolver(server)}
                              disabled={isResolverMutating}
                              aria-label={`Edit ${server.name}`}
                            >
                              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => void handleRemoveResolver(server)}
                              disabled={isResolverMutating}
                              aria-label={`Remove ${server.name}`}
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-muted-foreground">
                        No {protocol.label} resolver configured.
                      </p>
                    )}
                  </div>

                </div>
              );
            })}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-sky-200">
                No resolver is selected automatically. Activate one only when you want SafeNet protection to use it.
              </p>
              <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                <Link href="/dns">
                  <ExternalLink className="mr-2 h-4 w-4" /> Open DNS Servers
                </Link>
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Internet Share uses a manual HTTP proxy and does not decrypt HTTPS traffic. Keep SafeNet protection enabled on the phone; connected devices still need the proxy settings shown below.
            </p>
          </div>
        </div>

        <Dialog
          open={resolverDialogOpen}
          onOpenChange={(open) => {
            setResolverDialogOpen(open);
            if (!open) resetResolverForm();
          }}
        >
          <DialogContent className="bg-card text-foreground sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle className="font-display tracking-wider">
                {editingResolver ? "Edit Resolver" : "Add Resolver"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleResolverSubmit} className="mt-2 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tether-resolver-name">Resolver name</Label>
                <Input
                  id="tether-resolver-name"
                  value={resolverForm.name}
                  onChange={(event) => setResolverForm({ ...resolverForm, name: event.target.value })}
                  placeholder="Family DNS"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Protocol</Label>
                <Select
                  value={resolverForm.type}
                  onValueChange={(value: DnsServer["type"]) => setResolverForm({
                    ...resolverForm,
                    type: value,
                    primaryAddress: "",
                    secondaryAddress: "",
                  })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="plain">Plain DNS</SelectItem>
                    <SelectItem value="doh">DNS over HTTPS (DoH)</SelectItem>
                    <SelectItem value="dot">DNS over TLS (DoT)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {resolverForm.type === "plain" && (
                <div className="space-y-2">
                  <Label>Address family</Label>
                  <Select
                    value={resolverForm.ipVersion}
                    onValueChange={(value: ResolverForm["ipVersion"]) => setResolverForm({
                      ...resolverForm,
                      ipVersion: value,
                      primaryAddress: "",
                      secondaryAddress: "",
                    })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ipv4">IPv4</SelectItem>
                      <SelectItem value="ipv6">IPv6</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="tether-resolver-primary">Primary address</Label>
                <Input
                  id="tether-resolver-primary"
                  value={resolverForm.primaryAddress}
                  onChange={(event) => setResolverForm({ ...resolverForm, primaryAddress: event.target.value })}
                  placeholder={resolverAddressPlaceholder(resolverForm.type, resolverForm.ipVersion)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tether-resolver-secondary">Secondary address (optional)</Label>
                <Input
                  id="tether-resolver-secondary"
                  value={resolverForm.secondaryAddress}
                  onChange={(event) => setResolverForm({ ...resolverForm, secondaryAddress: event.target.value })}
                  placeholder={resolverAddressPlaceholder(resolverForm.type, resolverForm.ipVersion)}
                />
              </div>
              <Button type="submit" disabled={isResolverMutating} className="w-full">
                <Save className="mr-2 h-4 w-4" />
                {editingResolver ? "Save changes" : "Add resolver"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </CyberCard>

      {running && status && (
        <div className="grid gap-4 md:grid-cols-2">
          <CyberCard className="space-y-4">
            <div className="flex items-center gap-2">
              <Wifi className="h-5 w-5 text-primary" />
              <h3 className="font-display text-lg font-bold text-white">Connect to the network</h3>
            </div>
            <div className="space-y-2">
              <CopyValue value={status.networkName || "SafeNet-Share"} label="Wi-Fi Direct network" />
              <CopyValue value={status.passphrase || "Displayed by Android"} label="Passphrase" />
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={() => void openWifiSettings()}>
              <ExternalLink className="mr-2 h-4 w-4" /> Open Android Wi-Fi settings
            </Button>
          </CyberCard>

          <CyberCard className="space-y-4">
            <div className="flex items-center gap-2">
              <Globe2 className="h-5 w-5 text-sky-300" />
              <h3 className="font-display text-lg font-bold text-white">Proxy settings</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              On each connected device, choose manual proxy settings for this network.
            </p>
            <div className="space-y-2">
              <CopyValue value={status.proxyHost || "192.168.49.1"} label="Proxy host" />
              <CopyValue value={String(status.proxyPort || 8080)} label="Proxy port" />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              HTTPS uses the standard CONNECT tunnel. SafeNet does not inspect encrypted page contents.
            </p>
          </CyberCard>
        </div>
      )}

      <CyberCard className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold text-white">Connected devices</h3>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-muted-foreground">
            {status?.connectedDevices.length || 0} connected
          </span>
        </div>
        {status?.connectedDevices.length ? (
          <div className="space-y-2">
            {status.connectedDevices.map((device) => (
              <div key={device.address} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-3">
                <span className="font-medium text-white">{device.name || "Connected device"}</span>
                <span className="font-mono text-xs text-muted-foreground">{device.address}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center">
            <LockKeyhole className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {running ? "Start by joining the SafeNet-Share network from another device." : "Start Internet Share to create a private device network."}
            </p>
          </div>
        )}
      </CyberCard>

      <CyberCard className="border-white/10 bg-white/[0.03]">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-300" />
          <div className="space-y-2 text-sm text-muted-foreground">
            <h3 className="font-semibold text-white">Use it responsibly</h3>
            <p>
              This feature shares the phone&apos;s existing internet connection. Carrier data limits and hotspot policies still apply. Stop sharing when you are finished.
            </p>
            <p>
              Internet Share is separate from SafeNet&apos;s VPN tunnel. Keep SafeNet protection enabled when you want DNS filtering on the phone itself.
            </p>
          </div>
        </div>
      </CyberCard>
    </div>
  );
}