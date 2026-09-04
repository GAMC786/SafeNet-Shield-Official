import { useState } from "react";
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

type ResolverForm = {
  name: string;
  type: DnsServer["type"];
  primaryAddress: string;
  secondaryAddress: string;
};

const emptyResolver: ResolverForm = {
  name: "",
  type: "plain",
  primaryAddress: "",
  secondaryAddress: "",
};

function resolverTypeLabel(type: DnsServer["type"]) {
  return type === "doh" ? "DNS over HTTPS" : type === "dot" ? "DNS over TLS" : "Plain DNS";
}

export default function DnsSettings() {
  const { data: servers, isLoading, isError } = useDnsServers();
  const activateServer = useActivateDnsServer();
  const createServer = useCreateDnsServer();
  const updateServer = useUpdateDnsServer();
  const deleteServer = useDeleteDnsServer();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [editingResolver, setEditingResolver] = useState<DnsServer | null>(null);
  const [formData, setFormData] = useState<ResolverForm>(emptyResolver);

  const resetForm = () => {
    setFormData(emptyResolver);
    setEditingResolver(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEditDialog = (server: DnsServer) => {
    setEditingResolver(server);
    setFormData({
      name: server.name,
      type: server.type,
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
        description: `${server.name} is now the active SafeNet resolver.`,
      });
    } catch (error) {
      toast({
        title: "DNS resolver could not be activated",
        description: error instanceof Error ? error.message : "Unable to activate this DNS resolver.",
        variant: "destructive",
      });
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = formData.name.trim();
    const primaryAddress = formData.primaryAddress.trim();
    if (!name || !primaryAddress) {
      toast({
        title: "Resolver details required",
        description: "Enter a resolver name and primary address.",
        variant: "destructive",
      });
      return;
    }

    const data = {
      name,
      type: formData.type,
      primaryAddress,
      secondaryAddress: formData.secondaryAddress.trim() || null,
    };

    try {
      if (editingResolver) {
        await updateServer.mutateAsync({ id: editingResolver.id, ...data });
      } else {
        await createServer.mutateAsync({
          ...data,
          isActive: !servers?.length,
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
      <Header title="DNS Servers" subtitle="Manage Resolver" />

      <CyberCard className="border-primary/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-3">
              <Globe className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-white">Resolver management</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose the active DNS path or maintain your own trusted resolver list.
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
                onValueChange={(value: DnsServer["type"]) => setFormData({ ...formData, type: value })}
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
            <div className="space-y-2">
              <Label htmlFor="resolver-primary">Primary address</Label>
              <Input
                id="resolver-primary"
                data-testid="input-resolver-primary"
                value={formData.primaryAddress}
                onChange={(event) => setFormData({ ...formData, primaryAddress: event.target.value })}
                placeholder="https://resolver.example/dns-query"
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
                placeholder="Optional fallback address"
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
          <Button onClick={openCreateDialog} className="mt-4">
            <Plus className="mr-2 h-4 w-4" /> Add a Resolver
          </Button>
        </CyberCard>
      ) : (
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
                  <p className="mt-1 break-all font-mono text-sm text-muted-foreground">
                    {server.primaryAddress}
                    {server.secondaryAddress && <span className="opacity-50"> • {server.secondaryAddress}</span>}
                  </p>
                </div>
              </div>

              <div className="grid w-full grid-cols-3 gap-2 md:w-auto md:min-w-[300px]">
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
      )}
    </div>
  );
}