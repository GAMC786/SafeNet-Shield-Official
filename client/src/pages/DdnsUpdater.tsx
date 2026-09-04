import { useState } from "react";
import { useDdnsUpdaters, useCreateDdnsUpdater, useDeleteDdnsUpdater, useUpdateDdnsUpdater, usePublicIp } from "@/hooks/use-ddns";
import { useDnsServers } from "@/hooks/use-dns";
import { DDNS_DEFAULT_INTERVAL_MS, DDNS_MIN_INTERVAL_MS, type PublicDdnsUpdater } from "@shared/schema";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Globe, Plus, Pencil, Trash2, Clock, Wifi, Server, AlertTriangle, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function DdnsUpdater() {
  const { data: updaters, isLoading } = useDdnsUpdaters();
  const { data: publicIpData } = usePublicIp();
  const { data: dnsServers } = useDnsServers();
  const createUpdater = useCreateDdnsUpdater();
  const deleteUpdater = useDeleteDdnsUpdater();
  const updateUpdater = useUpdateDdnsUpdater();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [editingUpdater, setEditingUpdater] = useState<PublicDdnsUpdater | null>(null);
  const activeDnsServer = dnsServers?.find((server) => server.isActive);

  const isAutoMode = Boolean(updaters?.length && updaters.every((updater) => updater.isEnabled !== false));
  const [isSwitchingToAuto, setIsSwitchingToAuto] = useState(false);

  const handleAutoModeToggle = async () => {
    if (!updaters?.length || isSwitchingToAuto) return;
    const nextAutoMode = !isAutoMode;
    setIsSwitchingToAuto(true);
    try {
      for (const updater of updaters) {
        if ((updater.isEnabled !== false) !== nextAutoMode) {
          await updateUpdater.mutateAsync({
            id: updater.id,
            data: { isEnabled: nextAutoMode },
          });
        }
      }
      toast({
        title: nextAutoMode ? "Automatic updates enabled" : "Automatic updates paused",
        description: nextAutoMode
          ? "All configured DDNS resolvers will update automatically."
          : "DDNS provider updates are paused until auto mode is enabled again.",
      });
    } catch (error) {
      toast({
        title: "Auto mode could not be changed",
        description: error instanceof Error ? error.message : "Unable to change automatic updates.",
        variant: "destructive",
      });
    } finally {
      setIsSwitchingToAuto(false);
    }
  };

  const [formData, setFormData] = useState<{
    hostname: string;
    provider: PublicDdnsUpdater["provider"];
    apiKey: string;
    customUrl: string;
    updateInterval: number;
    isEnabled: boolean;
  }>({
    hostname: "",
    provider: "duckdns" as "duckdns" | "noip" | "dynu" | "dnsomatic" | "iplink",
    apiKey: "",
    customUrl: "",
    updateInterval: DDNS_DEFAULT_INTERVAL_MS,
    isEnabled: true,
  });

  const resetForm = () => {
    setFormData({
      hostname: "",
      provider: "duckdns",
      apiKey: "",
      customUrl: "",
      updateInterval: DDNS_DEFAULT_INTERVAL_MS,
      isEnabled: true,
    });
    setEditingUpdater(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEditDialog = (updater: PublicDdnsUpdater) => {
    setEditingUpdater(updater);
    setFormData({
      hostname: updater.hostname,
      provider: updater.provider,
      apiKey: "",
      customUrl: "",
      updateInterval: updater.updateInterval || DDNS_DEFAULT_INTERVAL_MS,
      isEnabled: updater.isEnabled !== false,
    });
    setIsOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUpdater) {
        const { apiKey, customUrl, ...updaterData } = formData;
        await updateUpdater.mutateAsync({
          id: editingUpdater.id,
          data: {
            ...updaterData,
            ...(apiKey.trim() ? { apiKey } : {}),
            ...(customUrl.trim() ? { customUrl } : {}),
          },
        });
      } else {
        await createUpdater.mutateAsync(formData);
      }
      setIsOpen(false);
      resetForm();
      toast({
        title: editingUpdater ? "DDNS updater updated" : "DDNS updater added",
        description: editingUpdater
          ? `${formData.hostname} was updated successfully.`
          : `${formData.hostname} is ready for automatic updates.`,
      });
    } catch (error) {
      toast({
        title: editingUpdater ? "DDNS updater not saved" : "DDNS updater not created",
        description: error instanceof Error ? error.message : "Unable to save this DDNS updater.",
        variant: "destructive",
      });
    }
  };

  const handleUpdaterToggle = async (updater: PublicDdnsUpdater) => {
    const nextEnabled = updater.isEnabled === false;
    try {
      await updateUpdater.mutateAsync({
        id: updater.id,
        data: { isEnabled: nextEnabled },
      });
      toast({
        title: `${updater.hostname} ${nextEnabled ? "enabled" : "disabled"}`,
        description: nextEnabled
          ? "This updater will run on its configured schedule."
          : "This updater is paused until you enable it again.",
      });
    } catch {
      // The mutation hook restores the previous state and reports the error.
    }
  };

  const handleDeleteUpdater = async (updater: PublicDdnsUpdater) => {
    if (!window.confirm(`Delete the DDNS updater for ${updater.hostname}?`)) return;
    try {
      await deleteUpdater.mutateAsync(updater.id);
      toast({
        title: "DDNS updater deleted",
        description: `${updater.hostname} was removed.`,
      });
    } catch {
      // The mutation hook reports the error.
    }
  };

  return (
    <div className="space-y-6">
      <Header
          title="DDNS"
        subtitle="Auto-Update DNS Records"
      />

      <CyberCard className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/20 rounded-lg">
              <Wifi className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Your Public IP Address</p>
              <p className="text-2xl font-mono font-bold text-white" data-testid="text-public-ip">
                {publicIpData?.ip || "Loading..."}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            Auto-detected
          </Badge>
        </div>
      </CyberCard>

      <CyberCard className="border-primary/20">
        <div className="flex items-start gap-3">
          <div className="p-3 rounded-lg bg-primary/10">
            <Server className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Active DNS Resolver</p>
            <p className="font-display font-bold text-white">
              {activeDnsServer?.name || "No resolver selected"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              DDNS status refreshes every 500 ms. Provider updates use the authenticated
              SafeNet API, and custom IP Link endpoints require HTTPS.
            </p>
          </div>
        </div>
      </CyberCard>

      <div className="flex gap-2 justify-end mb-6">
        <Button
          variant={isAutoMode ? "default" : "outline"}
          onClick={() => void handleAutoModeToggle()}
          disabled={isSwitchingToAuto || updateUpdater.isPending || !updaters?.length}
          aria-pressed={isAutoMode}
          className="flex items-center gap-2"
        >
          <Zap className="w-4 h-4" />
          {isSwitchingToAuto ? "Switching..." : isAutoMode ? "Auto Mode On" : "Switch to Auto"}
        </Button>
        <Dialog open={isOpen} onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
              <Plus className="w-4 h-4 mr-2" /> Add DDNS
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border text-foreground sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="font-display tracking-wider">
                {editingUpdater ? "Edit DDNS Updater" : "New DDNS Updater"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Hostname</Label>
                <Input
                  value={formData.hostname}
                  onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                  placeholder="example.duckdns.org"
                  className="bg-background border-border font-mono"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={formData.provider}
                  onValueChange={(v: any) => setFormData({ ...formData, provider: v })}
                >
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="duckdns">DuckDNS</SelectItem>
                    <SelectItem value="noip">No-IP</SelectItem>
                    <SelectItem value="dynu">Dynu</SelectItem>
                     <SelectItem value="cloudflare">Cloudflare</SelectItem>
                    <SelectItem value="dnsomatic">DNS-O-MATIC</SelectItem>
                    <SelectItem value="iplink">IP Link (Custom URL)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.provider === "iplink" && (
                <div className="space-y-2">
                  <Label>Update URL</Label>
                  <Input
                    value={formData.customUrl}
                    onChange={(e) => setFormData({ ...formData, customUrl: e.target.value })}
                     placeholder={
                       editingUpdater
                         ? "Leave blank to keep the current URL"
                         : "https://example.com/update?ip={ip}&host={hostname}"
                     }
                    className="bg-background border-border font-mono text-xs"
                     required={!editingUpdater}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use {"{ip}"} and {"{hostname}"} as placeholders
                  </p>
                </div>
              )}

              <div className="space-y-2">
                   <Label>{formData.provider === "iplink" ? "Auth Token (optional)" : "API Key / Token"}</Label>
                <Input
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                     placeholder={
                       editingUpdater
                         ? "Leave blank to keep the current key"
                         : formData.provider === "iplink"
                           ? "Optional auth token"
                           : "Your API key"
                     }
                  type="password"
                  className="bg-background border-border font-mono"
                     required={!editingUpdater && formData.provider !== "iplink"}
                />
              </div>

              <div className="space-y-2">
                 <Label>Update Interval (milliseconds)</Label>
                <Input
                  value={formData.updateInterval}
                  onChange={(e) => setFormData({ ...formData, updateInterval: parseInt(e.target.value, 10) || DDNS_MIN_INTERVAL_MS })}
                  type="number"
                  min={DDNS_MIN_INTERVAL_MS}
                  step="1000"
                  className="bg-background border-border"
                />
              </div>

               <Button
                 type="submit"
                 className="w-full bg-primary hover:bg-primary/90"
                 disabled={createUpdater.isPending || updateUpdater.isPending}
               >
                 {createUpdater.isPending || updateUpdater.isPending
                   ? "Saving..."
                   : editingUpdater
                     ? "Save Changes"
                     : "Create"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <CyberCard className="text-center py-8 text-muted-foreground">Loading...</CyberCard>
      ) : updaters?.length === 0 ? (
        <CyberCard className="text-center py-12 text-muted-foreground">
          <Globe className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No DDNS updaters configured</p>
        </CyberCard>
      ) : (
        <div className="grid gap-4">
          {updaters?.map((updater) => (
            <CyberCard key={updater.id} className="p-4">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-display font-bold text-white flex items-center gap-2">
                    <Globe className="w-5 h-5 text-primary" />
                    {updater.hostname}
                  </h3>
                  <p className="text-sm text-muted-foreground font-mono mt-1">{updater.provider.toUpperCase()}</p>
                </div>
                <Badge variant={updater.isEnabled ? "default" : "secondary"}>
                  {updater.isEnabled ? "Active" : "Inactive"}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Last IP</p>
                  <p className="font-mono text-primary">{updater.lastIpAddress || "Never"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Update</p>
                  <p className="text-xs text-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {updater.lastUpdateTime ? new Date(updater.lastUpdateTime).toLocaleString() : "Never"}
                  </p>
                </div>
              </div>

               {updater.lastFailureMessage && (
                 <div
                   role="alert"
                   data-testid={`ddns-failure-${updater.id}`}
                   className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-3 text-sm text-destructive"
                 >
                   <div className="flex items-start gap-2">
                     <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                     <div className="min-w-0">
                       <p className="font-semibold">Last update failed</p>
                       <p className="mt-1 break-words">{updater.lastFailureMessage}</p>
                       {updater.lastFailureTime && (
                         <p className="mt-1 text-xs text-destructive/80">
                           {new Date(updater.lastFailureTime).toLocaleString()}
                         </p>
                       )}
                     </div>
                   </div>
                 </div>
               )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleUpdaterToggle(updater)}
                  disabled={updateUpdater.isPending}
                  aria-label={`${updater.isEnabled ? "Disable" : "Enable"} ${updater.hostname}`}
                  aria-pressed={updater.isEnabled ?? false}
                  className={cn(
                    "min-h-10 flex-1 border-2 font-semibold transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                    updater.isEnabled
                      ? "border-amber-400/60 bg-amber-500/15 text-amber-200 hover:border-amber-300 hover:bg-amber-500/25"
                      : "border-primary/60 bg-primary/15 text-primary hover:border-primary hover:bg-primary/25"
                  )}
                >
                  {updater.isEnabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditDialog(updater)}
                  aria-label={`Edit ${updater.hostname}`}
                  disabled={updateUpdater.isPending || deleteUpdater.isPending}
                  className="min-h-10 border-primary/30 text-primary hover:border-primary hover:bg-primary/10"
                >
                  <Pencil className="w-4 h-4" />
                  <span className="sr-only">Edit</span>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleDeleteUpdater(updater)}
                  aria-label={`Delete ${updater.hostname}`}
                  disabled={updateUpdater.isPending || deleteUpdater.isPending}
                  className="flex-1"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CyberCard>
          ))}
        </div>
      )}
    </div>
  );
}
