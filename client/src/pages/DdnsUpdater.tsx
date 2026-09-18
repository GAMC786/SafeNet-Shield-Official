import { useEffect, useRef, useState } from "react";
import { useDdnsUpdaters, useCloudflareStatus, useCreateDdnsUpdater, useDeleteDdnsUpdater, useUpdateDdnsUpdater, usePublicIp, useTestDdnsUpdater, useUpdateDdnsUpdaterWithIp } from "@/hooks/use-ddns";
import { useDnsServers } from "@/hooks/use-dns";
import { DDNS_DEFAULT_INTERVAL_MINUTES, DDNS_MIN_INTERVAL_MINUTES, type PublicDdnsUpdater } from "@shared/schema";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Globe, Plus, Pencil, Trash2, Clock, Wifi, Server, AlertTriangle, Loader2, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { usePersistentState } from "@/hooks/use-persistent-state";

function getDdnsHostnameUrl(hostname: string): string {
  const normalizedHostname = hostname.trim();
  return /^https?:\/\//i.test(normalizedHostname)
    ? normalizedHostname
    : `https://${normalizedHostname}`;
}

export default function DdnsUpdater() {
  const { data: updaters, isLoading } = useDdnsUpdaters();
  const cloudflareStatus = useCloudflareStatus();
  const { data: publicIpData } = usePublicIp();
  const { data: dnsServers } = useDnsServers();
  const createUpdater = useCreateDdnsUpdater();
  const deleteUpdater = useDeleteDdnsUpdater();
  const updateUpdater = useUpdateDdnsUpdater();
  const testUpdater = useTestDdnsUpdater();
  const updateDdnsUpdaterWithIp = useUpdateDdnsUpdaterWithIp();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = usePersistentState("safenet-ddns-dialog-open", false);
  const [editingUpdater, setEditingUpdater] = useState<PublicDdnsUpdater | null>(null);
  const [editingUpdaterId, setEditingUpdaterId, clearEditingUpdaterId] = usePersistentState<number | null>(
    "safenet-ddns-editing-id",
    null,
  );
  const [testingUpdaterId, setTestingUpdaterId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, {
    ok: boolean;
    message: string;
    testedAt: number;
  }>>({});
  const activeDnsServer = dnsServers?.find((server) => server.isActive);
  const lastPushedClientIp = useRef<Record<number, string>>({});

  useEffect(() => {
    const clientIp = publicIpData?.ip;
    if (!clientIp || !updaters?.length) return;

    const deviceManagedUpdaters = updaters.filter(
      (updater) => updater.provider === "safenet" && updater.isEnabled !== false,
    );
    for (const updater of deviceManagedUpdaters) {
      if (lastPushedClientIp.current[updater.id] === clientIp) continue;
      lastPushedClientIp.current[updater.id] = clientIp;
      void updateDdnsUpdaterWithIp.mutateAsync({ id: updater.id, clientIp }).catch(() => {
        delete lastPushedClientIp.current[updater.id];
      });
    }
  }, [publicIpData?.ip, updateDdnsUpdaterWithIp.mutateAsync, updaters]);

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
          ? "SafeNet DDNS follows this device's public IP while this page is open; other resolvers use the hosted scheduler."
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

  const [formData, setFormData, clearFormData] = usePersistentState<{
    hostname: string;
    provider: PublicDdnsUpdater["provider"];
    apiKey: string;
    customUrl: string;
    updateIntervalMinutes: number;
    isEnabled: boolean;
  }>("safenet-ddns-draft", {
    hostname: "",
    provider: "safenet" as PublicDdnsUpdater["provider"],
    apiKey: "",
    customUrl: "",
    updateIntervalMinutes: DDNS_DEFAULT_INTERVAL_MINUTES,
    isEnabled: true,
  });

  useEffect(() => {
    if (!editingUpdaterId || !updaters) return;
    const updater = updaters.find((candidate) => candidate.id === editingUpdaterId);
    if (updater) {
      setEditingUpdater(updater);
    } else {
      setEditingUpdater(null);
      clearEditingUpdaterId();
    }
  }, [clearEditingUpdaterId, editingUpdaterId, updaters]);

  const resetForm = () => {
    clearFormData();
    clearEditingUpdaterId();
    setFormData({
      hostname: "",
       provider: "safenet",
      apiKey: "",
      customUrl: "",
      updateIntervalMinutes: DDNS_DEFAULT_INTERVAL_MINUTES,
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
    setEditingUpdaterId(updater.id);
    setFormData({
      hostname: updater.hostname,
      provider: updater.provider,
      apiKey: "",
      customUrl: "",
      updateIntervalMinutes: Math.max(DDNS_MIN_INTERVAL_MINUTES, updater.updateInterval || DDNS_DEFAULT_INTERVAL_MINUTES),
      isEnabled: updater.isEnabled !== false,
    });
    setIsOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      (formData.provider === "cloudflare" || formData.provider === "safenet")
      && cloudflareStatus.data?.ready !== true
    ) {
      toast({
        title: "Active Cloudflare zone required",
        description: cloudflareStatus.data?.message
          || "Add and activate a domain zone in Cloudflare before creating this updater.",
        variant: "destructive",
      });
      return;
    }
    try {
      if (editingUpdater) {
        const { apiKey, customUrl, ...updaterData } = formData;
        await updateUpdater.mutateAsync({
          id: editingUpdater.id,
          data: {
            ...updaterData,
            updateInterval: Math.max(DDNS_MIN_INTERVAL_MINUTES, Math.round(formData.updateIntervalMinutes)),
            ...(apiKey.trim() ? { apiKey } : {}),
            ...(customUrl.trim() ? { customUrl } : {}),
          },
        });
      } else {
        await createUpdater.mutateAsync({
          ...formData,
          updateInterval: Math.max(DDNS_MIN_INTERVAL_MINUTES, Math.round(formData.updateIntervalMinutes)),
        });
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

  const handleTestUpdater = async (updater: PublicDdnsUpdater) => {
    setTestingUpdaterId(updater.id);
    try {
      const result = await testUpdater.mutateAsync({
        id: updater.id,
        clientIp: publicIpData?.ip,
      }) as { message?: string };
      setTestResults((current) => ({
        ...current,
        [updater.id]: {
          ok: true,
          message: result.message || `${updater.provider.toUpperCase()} accepted the forced update.`,
          testedAt: Date.now(),
        },
      }));
      toast({
        title: "DDNS update verification passed",
        description: result.message || `${updater.provider.toUpperCase()} accepted the forced update.`,
      });
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [updater.id]: {
          ok: false,
          message: error instanceof Error ? error.message : "The provider endpoint could not be reached.",
          testedAt: Date.now(),
        },
      }));
      toast({
        title: "DDNS update verification failed",
        description: error instanceof Error ? error.message : "The provider endpoint could not be reached.",
        variant: "destructive",
      });
    } finally {
      setTestingUpdaterId(null);
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
          title="Dynamic DNS"
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
              DDNS status is live and read-only. Provider updates use the authenticated
              SafeNet API, and custom IP Link endpoints must use HTTPS.
            </p>
          </div>
        </div>
      </CyberCard>

      <div className="flex gap-2 justify-end mb-6">
        <Switch
          checked={isAutoMode}
          onCheckedChange={() => void handleAutoModeToggle()}
          disabled={isSwitchingToAuto || updateUpdater.isPending || !updaters?.length}
          aria-label={`DDNS auto mode ${isAutoMode ? "On" : "Off"}`}
          data-testid="switch-ddns-auto-mode"
        />
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
                  data-testid="input-ddns-hostname"
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
                     <SelectItem value="safenet">SafeNet DDNS (Cloudflare DNS)</SelectItem>
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

               {formData.provider === "cloudflare" || formData.provider === "safenet" ? (
                <div
                  className={cn(
                    "rounded-md border p-3 text-sm",
                    cloudflareStatus.data?.ready
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-100",
                  )}
                  role="status"
                >
                   <p className="font-medium">
                     {formData.provider === "safenet" ? "SafeNet DDNS hostname" : "Managed Cloudflare connection"}
                   </p>
                  <p className="mt-1 text-xs opacity-90">
                     {formData.provider === "safenet" && cloudflareStatus.data?.ready === true
                        ? "SafeNet will keep this hostname's A record pointed at your current public IP for NextDNS, Control D, OpenDNS, and AdGuard linked-IP setup."
                       : cloudflareStatus.isLoading
                      ? "Checking the connected Cloudflare account..."
                      : cloudflareStatus.data?.message
                        || cloudflareStatus.error?.message
                        || "Connect Cloudflare in Replit before creating this updater."}
                  </p>
                  {!cloudflareStatus.isLoading && cloudflareStatus.data?.ready !== true && (
                    <a
                      href="https://dash.cloudflare.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block font-medium underline underline-offset-4"
                    >
                      Open Cloudflare dashboard
                    </a>
                  )}
                </div>
              ) : (
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
              )}

              <div className="space-y-2">
                   <Label>Update Interval (minutes)</Label>
                <Input
                   data-testid="input-ddns-interval"
                   value={formData.updateIntervalMinutes}
                   onChange={(e) => setFormData({ ...formData, updateIntervalMinutes: parseInt(e.target.value, 10) || DDNS_MIN_INTERVAL_MINUTES })}
                  type="number"
                    min={DDNS_MIN_INTERVAL_MINUTES}
                   step="1"
                  className="bg-background border-border"
                />
                 <p className="text-xs text-muted-foreground">
                     Provider updates are limited to this interval. Existing secrets are kept when the key or custom URL is left blank.
                 </p>
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
                   <p className="text-sm text-muted-foreground font-mono mt-1">
                     {updater.provider === "safenet" ? "SAFENET DDNS" : updater.provider.toUpperCase()}
                   </p>
                   {updater.provider === "safenet" && (
                   <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                     <p className="text-xs text-muted-foreground">SafeNet DDNS Hostname URL</p>
                     <a
                       href={getDdnsHostnameUrl(updater.hostname)}
                       target="_blank"
                       rel="noreferrer"
                       data-testid={`link-ddns-hostname-${updater.id}`}
                       className="mt-1 inline-flex max-w-full items-center gap-1 break-all font-mono text-sm text-primary underline underline-offset-4 hover:text-primary/80"
                     >
                       <span>{getDdnsHostnameUrl(updater.hostname)}</span>
                       <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                     </a>
                     <p className="mt-2 text-xs text-muted-foreground">
                        Enter the hostname from this URL in NextDNS, Control D, OpenDNS, or AdGuard linked-IP settings.
                     </p>
                   </div>
                   )}
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

               {testResults[updater.id] && (
                 <div
                   role={testResults[updater.id].ok ? "status" : "alert"}
                   data-testid={`ddns-test-result-${updater.id}`}
                   className={cn(
                     "mb-4 rounded-lg border px-3 py-3 text-sm",
                     testResults[updater.id].ok
                       ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                       : "border-destructive/50 bg-destructive/10 text-destructive",
                   )}
                 >
                   <p className="font-semibold">
                     {testResults[updater.id].ok
                       ? "Manual update verification successful"
                       : "Manual update verification unsuccessful"}
                   </p>
                   <p className="mt-1 break-words">{testResults[updater.id].message}</p>
                   <p className="mt-1 text-xs opacity-80">
                     Tested {new Date(testResults[updater.id].testedAt).toLocaleString()}
                   </p>
                 </div>
               )}

              <div className="flex gap-2">
                 <Button
                   variant="outline"
                   size="sm"
                   onClick={() => void handleTestUpdater(updater)}
                   disabled={testingUpdaterId !== null || updateUpdater.isPending}
                    aria-label={`Test DDNS update for ${updater.hostname}`}
                   title={updater.isEnabled === false
                     ? "Manual verification remains available while automatic updates are off."
                     : undefined}
                   className={cn(
                     "min-h-10 flex-1",
                     updater.isEnabled === false
                       ? "border-muted-foreground/40 text-muted-foreground hover:border-muted-foreground/60 hover:bg-muted/10"
                       : "border-sky-400/40 text-sky-300 hover:border-sky-300 hover:bg-sky-400/10",
                   )}
                   data-testid={`button-test-ddns-${updater.id}`}
                 >
                   {testingUpdaterId === updater.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
                   Test
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
