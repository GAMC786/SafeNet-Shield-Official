import { useEffect, useState } from "react";
import {
  useActivateDnsServer,
  useCreateDnsServer,
  useDeleteDnsServer,
  useDnsServers,
  useUpdateDnsServer,
} from "@/hooks/use-dns";
import type { DnsServer } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Globe, Lock, Pencil, Plus, Save, Server, Trash2, CheckCircle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { usePersistentState } from "@/hooks/use-persistent-state";
import {
  DNS_FAMILY_RESOLVER_PRESETS,
  DNS_NEXTDNS_RESOLVER_PRESET,
} from "@shared/dns-resolvers";
import {
  SAFE_NET_PRIVATE_DNS_EULA_VERSION,
  usePrivateDns,
} from "@/hooks/use-private-dns";
import { PrivateDnsEulaDialog } from "@/components/PrivateDnsEulaDialog";
import { PrivateDnsOneTapDialog } from "@/components/PrivateDnsOneTapDialog";

type ResolverForm = {
  name: string;
  type: DnsServer["type"];
  ipVersion: "ipv4" | "ipv6";
  primaryAddress: string;
  secondaryAddress: string;
};

const resolverPresets = [
  ...DNS_FAMILY_RESOLVER_PRESETS,
  DNS_NEXTDNS_RESOLVER_PRESET,
] as const;

const emptyResolver: ResolverForm = {
  name: "",
  type: "plain",
  ipVersion: "ipv4",
  primaryAddress: "",
  secondaryAddress: "",
};

const PRIVATE_DNS_EULA_STORAGE_KEY = "safenet-private-dns-eula-version";

function hasAcceptedPrivateDnsEula() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PRIVATE_DNS_EULA_STORAGE_KEY) === SAFE_NET_PRIVATE_DNS_EULA_VERSION;
}

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
    const version = ipVersion === "ipv6" ? 6 : 4;
    if (typeof window !== "undefined" && window.location) {
      const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address);
      const ipv6 = address.includes(":") && /^[0-9a-f:]+$/i.test(address);
      return version === 4 ? ipv4 : ipv6;
    }
    return false;
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

export default function DnsSettings() {
  const { data: servers, isLoading, isError } = useDnsServers();
  const activateServer = useActivateDnsServer();
  const createServer = useCreateDnsServer();
  const updateServer = useUpdateDnsServer();
  const deleteServer = useDeleteDnsServer();
  const { toast } = useToast();
  const activeDns = servers?.find((server) => server.isActive);
  const privateDns = usePrivateDns(activeDns);
  const [privateDnsEulaOpen, setPrivateDnsEulaOpen] = useState(false);
  const [privateDnsEulaAccepted, setPrivateDnsEulaAccepted] = useState(hasAcceptedPrivateDnsEula);
  const [pendingPrivateDnsServer, setPendingPrivateDnsServer] = useState<DnsServer | null>(null);
  const [pendingPrivateDnsAction, setPendingPrivateDnsAction] = useState<"settings" | "oneTap" | null>(null);
  const [oneTapDialogOpen, setOneTapDialogOpen] = useState(false);
  const [isOpen, setIsOpen] = usePersistentState("safenet-dns-resolver-dialog-open", false);
  const [editingResolver, setEditingResolver] = useState<DnsServer | null>(null);
  const [editingResolverId, setEditingResolverId, clearEditingResolverId] = usePersistentState<number | null>(
    "safenet-dns-resolver-editing-id",
    null,
  );
  const [formData, setFormData, clearFormData] = usePersistentState<ResolverForm>(
    "safenet-dns-resolver-draft",
    emptyResolver,
  );

  useEffect(() => {
    if (!editingResolverId || !servers) return;
    const resolver = servers.find((server) => server.id === editingResolverId);
    if (resolver) {
      setEditingResolver(resolver);
    } else {
      setEditingResolver(null);
      clearEditingResolverId();
    }
  }, [clearEditingResolverId, editingResolverId, servers]);

  const resetForm = () => {
    clearFormData();
    clearEditingResolverId();
    setEditingResolver(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEditDialog = (server: DnsServer) => {
    setEditingResolver(server);
    setEditingResolverId(server.id);
    setFormData({
      name: server.name,
      type: server.type,
      ipVersion: server.ipVersion,
      primaryAddress: server.primaryAddress,
      secondaryAddress: server.secondaryAddress || "",
    });
    setIsOpen(true);
  };

  const handleActivate = async (server: DnsServer) => {
    try {
      await activateServer.mutateAsync(server.id);
      toast({
        title: "DNS resolver activated",
        description: `${server.name} is now the active resolver. Open SafeNet Private DNS to apply it on Android.`,
      });
    } catch (error) {
      toast({
        title: "DNS resolver could not be activated",
        description: error instanceof Error ? error.message : "Unable to activate this DNS resolver.",
        variant: "destructive",
      });
    }
  };

  const handleStartFiltering = async (server: DnsServer) => {
    if (!privateDnsEulaAccepted) {
      setPendingPrivateDnsServer(server);
      setPendingPrivateDnsAction("settings");
      setPrivateDnsEulaOpen(true);
      return;
    }
    try {
      await openPrivateDnsSettings();
    } catch (error) {
      toast({
        title: "Private DNS settings could not be opened",
        description: error instanceof Error ? error.message : "Android did not expose the system Private DNS settings.",
        variant: "destructive",
      });
    }
  };

  const openPrivateDnsSettings = async () => {
    const hostname = privateDns.expectedHostname;
    if (!hostname) {
      toast({
        title: "Private DNS hostname required",
        description: "Use a DNS-over-TLS or DNS-over-HTTPS resolver with a hostname before opening Android settings.",
        variant: "destructive",
      });
      return;
    }
    await privateDns.openSettings();
    toast({
      title: "Android Private DNS settings opened",
      description: `Select ${hostname} as the Private DNS provider, then return to SafeNet.`,
    });
  };

  const applyOneTapNow = async () => {
    try {
      await privateDns.applyOneTap();
      toast({
        title: "Private DNS enabled",
        description: privateDns.expectedHostname
          ? `${privateDns.expectedHostname} is now active through Android Private DNS.`
          : "The selected Private DNS hostname is now active.",
      });
    } catch (error) {
      toast({
        title: "One-tap Private DNS was not applied",
        description: error instanceof Error
          ? error.message
          : "Grant access through ADB or Shizuku, then try again.",
        variant: "destructive",
      });
    }
  };

  const handleOneTap = async () => {
    if (!privateDns.expectedHostname) {
      toast({
        title: "Private DNS hostname required",
        description: "Choose a DNS-over-TLS or DNS-over-HTTPS resolver first.",
        variant: "destructive",
      });
      return;
    }
    if (!privateDns.status?.oneTapAvailable) {
      setOneTapDialogOpen(true);
      return;
    }
    if (!privateDnsEulaAccepted) {
      setPendingPrivateDnsServer(activeDns ?? null);
      setPendingPrivateDnsAction("oneTap");
      setPrivateDnsEulaOpen(true);
      return;
    }
    await applyOneTapNow();
  };

  const handlePrivateDnsEulaAccept = () => {
    try {
      window.localStorage.setItem(PRIVATE_DNS_EULA_STORAGE_KEY, SAFE_NET_PRIVATE_DNS_EULA_VERSION);
    } catch {
      // Acceptance still applies for this session if local storage is unavailable.
    }
    setPrivateDnsEulaAccepted(true);
    setPrivateDnsEulaOpen(false);
    if (pendingPrivateDnsServer) {
      if (pendingPrivateDnsAction === "oneTap") {
        void applyOneTapNow();
      } else {
        void openPrivateDnsSettings();
      }
      setPendingPrivateDnsServer(null);
    }
    setPendingPrivateDnsAction(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = formData.name.trim();
    const primaryAddress = formData.primaryAddress.trim();
    const secondaryAddress = formData.secondaryAddress.trim();
    if (!name || !primaryAddress) {
      toast({
        title: "Resolver details required",
        description: "Enter a resolver name and primary address.",
        variant: "destructive",
      });
      return;
    }
    if (!isValidResolverAddress(formData.type, formData.ipVersion, primaryAddress)) {
      toast({
        title: "Primary address does not match the selection",
        description: formData.type === "plain"
          ? `Enter a valid ${formData.ipVersion === "ipv6" ? "IPv6" : "IPv4"} address.`
          : `Enter a valid ${resolverTypeLabel(formData.type)} endpoint.`,
        variant: "destructive",
      });
      return;
    }
    if (secondaryAddress && !isValidResolverAddress(formData.type, formData.ipVersion, secondaryAddress)) {
      toast({
        title: "Secondary address does not match the selection",
        description: "Use the same protocol and address family as the primary resolver.",
        variant: "destructive",
      });
      return;
    }

    const data = {
      name,
      type: formData.type,
      ipVersion: formData.ipVersion,
      primaryAddress,
      secondaryAddress: secondaryAddress || null,
    };

    try {
      if (editingResolver) {
        const updated = await updateServer.mutateAsync({ id: editingResolver.id, ...data });
      } else {
        await createServer.mutateAsync({
          ...data,
          isActive: false,
          isCustom: true,
        });
      }
      setIsOpen(false);
      resetForm();
      toast({
        title: editingResolver ? "Resolver updated" : "Resolver added",
        description: `${name} is ready to use.`,
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
    if (servers?.some((server) => server.name === preset.name)) {
      toast({
        title: "Resolver already added",
        description: `${preset.name} is already in your resolver list.`,
      });
      return;
    }
    try {
      await createServer.mutateAsync({
        name: preset.name,
        type: preset.type,
        ipVersion: preset.ipVersion,
        primaryAddress: preset.primaryAddress,
        secondaryAddress: preset.secondaryAddress,
        isActive: false,
        isCustom: false,
      });
      toast({
        title: "Resolver added",
        description: `${preset.name} is ready to use.`,
      });
    } catch (error) {
      toast({
        title: "Resolver could not be added",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleRemove = async (server: DnsServer) => {
    if (!window.confirm(`Remove ${server.name} from SafeNet DNS resolvers?`)) return;
    try {
      await deleteServer.mutateAsync(server.id);
      toast({ title: "Resolver removed", description: `${server.name} was removed.` });
    } catch (error) {
      toast({
        title: "Resolver could not be removed",
        description: error instanceof Error ? error.message : "Unable to remove this resolver.",
        variant: "destructive",
      });
    }
  };

  const isSaving = createServer.isPending || updateServer.isPending;
  const isMutating = isSaving || deleteServer.isPending || activateServer.isPending;

  return (
    <div className="space-y-6">
      <PrivateDnsEulaDialog
        open={privateDnsEulaOpen}
        onOpenChange={setPrivateDnsEulaOpen}
        onAccept={handlePrivateDnsEulaAccept}
        onCancel={() => {
          setPendingPrivateDnsServer(null);
          setPendingPrivateDnsAction(null);
          setPrivateDnsEulaOpen(false);
        }}
      />
      <PrivateDnsOneTapDialog
        open={oneTapDialogOpen}
        onOpenChange={setOneTapDialogOpen}
        hostname={privateDns.expectedHostname}
      />
      <Header title="DNS Servers" subtitle="Manage Resolvers" />

      <CyberCard className={privateDns.status?.running ? "border-emerald-500/40 bg-emerald-500/5" : "border-primary/20"}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">
              SafeNet Private DNS
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {!privateDns.supported
                ? "Available in the Android app. SafeNet uses Android Private DNS for encrypted DNS-over-TLS without creating a VPN."
                : privateDns.status?.error
                  || privateDns.status?.message
                  || "Android Private DNS uses encrypted DNS-over-TLS without creating a VPN."}
            </p>
          </div>
          {privateDns.status?.running ? (
            <Button
              type="button"
              variant="outline"
              disabled={privateDns.isBusy}
              onClick={() => void privateDns.openSettings()}
            >
              Change Private DNS
            </Button>
          ) : (
            privateDns.supported ? (
              <Button
                type="button"
                disabled={privateDns.isBusy || !activeDns || !privateDns.expectedHostname}
                onClick={() => {
                  if (activeDns) void handleStartFiltering(activeDns);
                }}
              >
                Open Android settings
              </Button>
            ) : (
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/10 px-3 py-2 text-primary"
              >
                Android app only
              </Badge>
            )
          )}
        </div>
        {privateDns.supported && !privateDns.expectedHostname && (
          <p className="mt-2 text-xs text-destructive">
            The selected resolver does not expose a hostname Android Private DNS can use. Choose a DNS-over-TLS or DNS-over-HTTPS resolver.
          </p>
        )}
        {privateDns.supported && privateDns.expectedHostname && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Optional one-tap control</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {privateDns.status?.oneTapAvailable
                  ? "Protected access is enabled. SafeNet can apply the selected hostname and verify it."
                  : "Keep using Android settings, or grant protected access explicitly through ADB or Shizuku."}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={privateDns.isBusy}
              onClick={() => void handleOneTap()}
              className="shrink-0"
            >
              {privateDns.status?.oneTapAvailable ? "Apply with one tap" : "Set up one-tap"}
            </Button>
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            className="h-auto px-0 py-0 text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setPrivateDnsEulaOpen(true)}
            data-testid="button-view-private-dns-eula"
          >
            View SafeNet Private DNS EULA
          </Button>
        </div>
      </CyberCard>

      <CyberCard className="border-primary/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-3">
              <Globe className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-white">Resolver management</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Maintain your trusted resolver list and activate a resolver only when you want to use it.
              </p>
            </div>
          </div>
          <Button
            onClick={openCreateDialog}
            disabled={isMutating}
            className="w-full bg-primary font-bold text-primary-foreground hover:bg-primary/90 sm:w-auto"
          >
            <Plus className="mr-2 h-4 w-4" /> Add a Resolver
          </Button>
        </div>
        <div className="mt-5 border-t border-white/10 pt-5">
          <div className="mb-3">
            <h3 className="font-display text-sm font-bold uppercase tracking-wider text-white">Popular resolvers</h3>
            <p className="mt-1 text-xs text-muted-foreground">Add a trusted provider without entering its addresses manually.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {resolverPresets.map((preset) => {
              const isAdded = servers?.some((server) => server.name === preset.name) ?? false;
              return (
                <div key={preset.name} className="flex flex-col justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-white">{preset.name}</h4>
                       <Badge variant="outline" className="shrink-0 text-[10px]">{resolverTypeLabel(preset.type)}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{preset.description}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={isAdded ? "outline" : "default"}
                    className="w-full"
                    disabled={isAdded || isMutating}
                    onClick={() => void handleAddPreset(preset)}
                    data-testid={`button-add-${preset.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`}
                  >
                    {isAdded ? <><CheckCircle className="mr-1 h-4 w-4" /> Added</> : <><Plus className="mr-1 h-4 w-4" /> Add</>}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </CyberCard>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="bg-card text-foreground sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="font-display tracking-wider">
              {editingResolver ? "Edit Resolver" : "Add a Resolver"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="resolver-name">Resolver name</Label>
              <Input
                id="resolver-name"
                data-testid="input-resolver-name"
                value={formData.name}
                onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                placeholder="My secure resolver"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Protocol</Label>
              <Select
                value={formData.type}
                onValueChange={(value: DnsServer["type"]) => setFormData({
                  ...formData,
                  type: value,
                  primaryAddress: "",
                  secondaryAddress: "",
                })}
              >
                <SelectTrigger data-testid="select-resolver-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plain">Plain DNS</SelectItem>
                  <SelectItem value="doh">DNS over HTTPS</SelectItem>
                  <SelectItem value="dot">DNS over TLS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.type === "plain" && (
              <div className="space-y-2">
                <Label>Address family</Label>
                <Select
                  value={formData.ipVersion}
                  onValueChange={(value: ResolverForm["ipVersion"]) => setFormData({
                    ...formData,
                    ipVersion: value,
                    primaryAddress: "",
                    secondaryAddress: "",
                  })}
                >
                  <SelectTrigger data-testid="select-resolver-ip-version">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ipv4">IPv4</SelectItem>
                    <SelectItem value="ipv6">IPv6</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose whether this plain resolver uses IPv4 or IPv6 addresses.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="resolver-primary">Primary address</Label>
              <Input
                id="resolver-primary"
                data-testid="input-resolver-primary"
                value={formData.primaryAddress}
                onChange={(event) => setFormData({ ...formData, primaryAddress: event.target.value })}
                placeholder={resolverAddressPlaceholder(formData.type, formData.ipVersion)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resolver-secondary">Secondary address (optional)</Label>
              <Input
                id="resolver-secondary"
                data-testid="input-resolver-secondary"
                value={formData.secondaryAddress}
                onChange={(event) => setFormData({ ...formData, secondaryAddress: event.target.value })}
                placeholder={resolverAddressPlaceholder(formData.type, formData.ipVersion)}
              />
            </div>
            <Button type="submit" disabled={isSaving} className="w-full">
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {isSaving ? "Saving..." : editingResolver ? "Save Changes" : "Add Resolver"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <CyberCard className="py-10 text-center text-muted-foreground">Loading resolvers...</CyberCard>
      ) : isError ? (
        <CyberCard className="border-destructive/40 py-10 text-center text-destructive">
          Resolvers are temporarily unavailable. Refresh to try again.
        </CyberCard>
      ) : !servers?.length ? (
        <CyberCard className="py-12 text-center text-muted-foreground">
          <Server className="mx-auto mb-4 h-12 w-12 opacity-50" />
          <p>No resolvers configured yet.</p>
        </CyberCard>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
          {servers.map((server) => (
            <CyberCard
              key={server.id}
              className={`flex flex-col gap-4 border-l-4 md:flex-row md:items-center md:justify-between ${
                server.isActive ? "border-l-primary bg-primary/5" : "border-l-transparent"
              }`}
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className={`rounded-lg p-3 ${server.isActive ? "bg-primary/20 text-primary" : "bg-white/5 text-muted-foreground"}`}>
                  {server.type === "doh" ? <Globe className="h-6 w-6" /> : server.type === "dot" ? <Lock className="h-6 w-6" /> : <Server className="h-6 w-6" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-white">{server.name}</h3>
                    {server.isActive && (
                      <Badge className="bg-emerald-600 text-white">
                        <CheckCircle className="mr-1 h-3 w-3" /> Active
                      </Badge>
                    )}
                    {server.isCustom && <Badge variant="outline">Custom</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{resolverTypeLabel(server.type)}</p>
                   {server.type === "plain" && (
                     <p className="mt-1 text-xs font-mono uppercase tracking-wider text-primary">{server.ipVersion}</p>
                   )}
                  <p className="mt-1 break-all font-mono text-sm text-muted-foreground">
                    {server.primaryAddress}
                    {server.secondaryAddress && <span className="opacity-50"> • {server.secondaryAddress}</span>}
                  </p>
                </div>
              </div>

              <div className="grid w-full grid-cols-2 gap-2 md:w-auto md:min-w-[300px] lg:grid-cols-3">
                <Button
                  variant={server.isActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => void handleActivate(server)}
                  disabled={server.isActive || isMutating}
                  className={server.isActive ? "bg-emerald-600 text-white hover:bg-emerald-700" : "text-primary"}
                >
                  {activateServer.isPending && !server.isActive ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  {server.isActive ? "Active" : "Use This"}
                </Button>
                {privateDns.supported && server.isActive && !privateDns.status?.running && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleStartFiltering(server)}
                    disabled={privateDns.isBusy || isMutating || !privateDns.expectedHostname}
                    className="text-primary"
                  >
                    Open Private DNS
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditDialog(server)}
                  disabled={isMutating}
                  aria-label={`Edit ${server.name}`}
                >
                  <Pencil className="mr-1 h-4 w-4" /> Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleRemove(server)}
                  disabled={isMutating}
                  aria-label={`Remove ${server.name}`}
                >
                  <Trash2 className="mr-1 h-4 w-4" /> Remove
                </Button>
              </div>
            </CyberCard>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}