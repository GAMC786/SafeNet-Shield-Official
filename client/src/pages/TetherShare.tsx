import { useTetherShare } from "@/hooks/use-tether-share";
import {
  useCreateDnsServer,
  useDeleteDnsServer,
  useDnsServers,
  useUpdateDnsServer,
} from "@/hooks/use-dns";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
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
  Share2,
  ShieldCheck,
  Smartphone,
  Square,
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
import {
  DNS_FAMILY_RESOLVER_PRESETS,
  DNS_NEXTDNS_RESOLVER_PRESET,
} from "@shared/dns-resolvers";

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

const resolverPresets = [
  ...DNS_FAMILY_RESOLVER_PRESETS,
  DNS_NEXTDNS_RESOLVER_PRESET,
] as const;

const resolverProtocols: Array<{
  type: DnsServer["type"];
  label: string;
  description: string;
}> = [
  { type: "plain", label: "Plain DNS", description: "IP addresses for devices that support standard DNS." },
  { type: "doh", label: "DNS over HTTPS (DoH)", description: "Encrypted HTTPS resolver URLs." },
  { type: "dot", label: "DNS over TLS (DoT)", description: "Encrypted resolver hostnames for TLS-capable devices." },
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
  const { supported, status, isBusy, start, stop, openWifiSettings } = useTetherShare();
  const { data: dnsServers } = useDnsServers();
  const { toast } = useToast();
  const running = status?.running === true;
  const starting = status?.starting === true || isBusy;
  const createResolver = useCreateDnsServer();
  const updateResolver = useUpdateDnsServer();
  const deleteResolver = useDeleteDnsServer();
  const [resolverDialogOpen, setResolverDialogOpen] = useState(false);
  const [editingResolver, setEditingResolver] = useState<DnsServer | null>(null);
  const [resolverForm, setResolverForm] = useState<ResolverForm>(emptyResolver);
  const isResolverMutating = createResolver.isPending || updateResolver.isPending || deleteResolver.isPending;

  useEffect(() => {
    if (!editingResolver) return;
    const currentResolver = dnsServers?.find((server) => server.id === editingResolver.id);
    if (currentResolver) setEditingResolver(currentResolver);
  }, [dnsServers, editingResolver]);

  const resetResolverForm = () => {
    setResolverForm(emptyResolver);
    setEditingResolver(null);
  };

  const openCreateResolver = () => {
    resetResolverForm();
    setResolverDialogOpen(true);
  };

  const openEditResolver = (server: DnsServer) => {
    setEditingResolver(server);
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
          isActive: !dnsServers?.length,
          isCustom: true,
        });
      }
      setResolverDialogOpen(false);
      resetResolverForm();
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

  const handleAddPreset = async (preset: (typeof resolverPresets)[number]) => {
    if (dnsServers?.some((server) => server.name === preset.name)) {
      toast({
        title: "Resolver already added",
        description: `${preset.name} is already in your resolver list.`,
      });
      return;
    }
    try {
      await createResolver.mutateAsync({
        name: preset.name,
        type: preset.type,
        ipVersion: preset.ipVersion,
        primaryAddress: preset.primaryAddress,
        secondaryAddress: preset.secondaryAddress,
        isActive: !dnsServers?.length,
        isCustom: false,
      });
      toast({ title: "Resolver added", description: `${preset.name} is ready for Internet Share devices.` });
    } catch (error) {
      toast({
        title: "Resolver could not be added",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleRemoveResolver = async (server: DnsServer) => {
    if (!window.confirm(`Remove ${server.name} from Internet Share DNS resolvers?`)) return;
    try {
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

  const handleToggle = async () => {
    if (!supported) {
      toast({
        title: "Android device required",
        description: "Internet Share uses Android Wi-Fi Direct and can be started from the SafeNet Android APK.",
      });
      return;
    }
    try {
      await (running ? stop() : start());
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
            <div>
              <h2 className="font-semibold text-white">Internet Share needs attention</h2>
              <p className="mt-1 text-sm text-destructive" role="alert">{status.lastError}</p>
            </div>
          </div>
        </CyberCard>
      )}

      <CyberCard glow className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-transparent to-transparent">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
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
          <Button
            type="button"
            size="lg"
            variant={running ? "destructive" : "default"}
            disabled={starting}
            onClick={() => void handleToggle()}
            data-testid="button-tether-toggle"
          >
            {starting ? "Starting…" : running ? <><Square className="mr-2 h-4 w-4 fill-current" /> Stop sharing</> : <><Share2 className="mr-2 h-4 w-4" /> Start sharing</>}
          </Button>
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
                    Add, edit, or remove
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Manage the resolvers available for connected Internet Share devices. Plain DNS, DoH, and DoT are kept in separate sections.
                </p>
              </div>
              <Button type="button" size="sm" onClick={openCreateResolver} disabled={isResolverMutating} className="w-full sm:w-auto">
                <Plus className="mr-2 h-4 w-4" /> Add resolver
              </Button>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              {resolverProtocols.map((protocol) => {
                const configuredResolvers = dnsServers?.filter((server) => server.type === protocol.type) ?? [];
                const recommendedResolvers = resolverPresets.filter((preset) => preset.type === protocol.type);
                return (
                  <div key={protocol.type} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-sm font-bold text-white">{protocol.label}</h3>
                      <Badge variant="outline" className="text-[10px] uppercase">{configuredResolvers.length}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{protocol.description}</p>

                    <div className="mt-3 space-y-2">
                      {configuredResolvers.length ? configuredResolvers.map((server) => (
                        <div
                          key={server.id}
                          className={`rounded-lg border p-3 ${server.isActive ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/10 bg-white/[0.03]"}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">{server.name}</p>
                              <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{server.primaryAddress}</p>
                              {server.secondaryAddress && (
                                <p className="break-all font-mono text-[11px] text-muted-foreground">{server.secondaryAddress}</p>
                              )}
                            </div>
                            {server.isActive && <Badge className="shrink-0 bg-emerald-600 text-[10px] text-white">Active</Badge>}
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
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
                      )) : (
                        <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs text-muted-foreground">
                          No {protocol.label} resolver configured.
                        </p>
                      )}
                    </div>

                    {recommendedResolvers.length > 0 && (
                      <div className="mt-3 border-t border-white/10 pt-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recommended</p>
                        <div className="mt-2 space-y-2">
                          {recommendedResolvers.map((preset) => {
                            const isAdded = dnsServers?.some((server) => server.name === preset.name) ?? false;
                            return (
                              <div key={preset.name} className="rounded-lg border border-white/10 p-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-semibold text-white">{preset.name}</p>
                                  <Badge variant="outline" className="text-[9px] uppercase">{preset.type}</Badge>
                                </div>
                                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{preset.description}</p>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={isAdded ? "outline" : "default"}
                                  className="mt-2 w-full"
                                  disabled={isAdded || isResolverMutating}
                                  onClick={() => void handleAddPreset(preset)}
                                >
                                  {isAdded ? "Added" : <><Plus className="mr-1 h-3.5 w-3.5" /> Add</>}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-sky-200">
                Internet Share does not change DNS automatically. Set one of the resolvers above on each connected device that joins this network.
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