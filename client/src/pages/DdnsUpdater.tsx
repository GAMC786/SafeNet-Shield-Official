import { useState } from "react";
import { useDdnsUpdaters, useCreateDdnsUpdater, useDeleteDdnsUpdater, useUpdateDdnsUpdater, usePublicIp, useUpdateDdnsWithIp } from "@/hooks/use-ddns";
import type { PublicDdnsUpdater } from "@shared/schema";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Globe, Plus, Pencil, Trash2, RefreshCw, Clock, Wifi } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const ispBrands = [
  { match: /rogers/i, name: "Rogers", mark: "R", color: "bg-red-500/20 text-red-300 border-red-400/40" },
  { match: /telus/i, name: "TELUS", mark: "T", color: "bg-purple-500/20 text-purple-300 border-purple-400/40" },
  { match: /bell/i, name: "Bell", mark: "B", color: "bg-blue-500/20 text-blue-300 border-blue-400/40" },
  { match: /videotron/i, name: "Videotron", mark: "V", color: "bg-orange-500/20 text-orange-300 border-orange-400/40" },
  { match: /cogeco/i, name: "Cogeco", mark: "C", color: "bg-cyan-500/20 text-cyan-300 border-cyan-400/40" },
  { match: /shaw/i, name: "Shaw", mark: "S", color: "bg-green-500/20 text-green-300 border-green-400/40" },
  { match: /sasktel/i, name: "SaskTel", mark: "S", color: "bg-blue-500/20 text-blue-300 border-blue-400/40" },
  { match: /freedom/i, name: "Freedom", mark: "F", color: "bg-yellow-500/20 text-yellow-300 border-yellow-400/40" },
  { match: /starlink/i, name: "Starlink", mark: "✦", color: "bg-white/10 text-white border-white/30" },
  { match: /google/i, name: "Google", mark: "G", color: "bg-blue-500/20 text-blue-300 border-blue-400/40" },
  { match: /cloudflare/i, name: "Cloudflare", mark: "C", color: "bg-orange-500/20 text-orange-300 border-orange-400/40" },
  { match: /microsoft/i, name: "Microsoft", mark: "M", color: "bg-cyan-500/20 text-cyan-300 border-cyan-400/40" },
  { match: /comcast|xfinity/i, name: "Xfinity", mark: "X", color: "bg-purple-500/20 text-purple-300 border-purple-400/40" },
  { match: /at&t|att\b/i, name: "AT&T", mark: "&", color: "bg-blue-500/20 text-blue-300 border-blue-400/40" },
  { match: /verizon/i, name: "Verizon", mark: "V", color: "bg-red-500/20 text-red-300 border-red-400/40" },
  { match: /t-mobile|tmobile/i, name: "T-Mobile", mark: "T", color: "bg-pink-500/20 text-pink-300 border-pink-400/40" },
  { match: /google fiber/i, name: "Google Fiber", mark: "G", color: "bg-blue-500/20 text-blue-300 border-blue-400/40" },
  { match: /teksavvy/i, name: "TekSavvy", mark: "T", color: "bg-orange-500/20 text-orange-300 border-orange-400/40" },
] as const;

function IspBadge({ isp }: { isp?: string }) {
  if (!isp) return null;
  const brand = ispBrands.find((candidate) => candidate.match.test(isp));
  const name = brand?.name || isp;
  const mark = brand?.mark || "ISP";
  const color = brand?.color || "bg-primary/15 text-primary border-primary/30";

  return (
    <div
      className={cn("inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold", color)}
      title={`Detected internet provider: ${isp}`}
      data-testid="detected-isp"
    >
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-black/20 px-1 font-display text-[10px]">
        {mark}
      </span>
      <span>{name}</span>
    </div>
  );
}

export default function DdnsUpdater() {
  const { data: updaters, isLoading } = useDdnsUpdaters();
  const { data: publicIpData } = usePublicIp();
  const createUpdater = useCreateDdnsUpdater();
  const deleteUpdater = useDeleteDdnsUpdater();
  const updateUpdater = useUpdateDdnsUpdater();
  const updateWithIp = useUpdateDdnsWithIp();
  const [isOpen, setIsOpen] = useState(false);
  const [editingUpdater, setEditingUpdater] = useState<PublicDdnsUpdater | null>(null);

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
    updateInterval: 3600,
    isEnabled: true,
  });

  const resetForm = () => {
    setFormData({
      hostname: "",
      provider: "duckdns",
      apiKey: "",
      customUrl: "",
      updateInterval: 3600,
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
      updateInterval: updater.updateInterval || 3600,
      isEnabled: updater.isEnabled !== false,
    });
    setIsOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
              {publicIpData?.isp && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <IspBadge isp={publicIpData.isp} />
                  {publicIpData.organization && publicIpData.organization !== publicIpData.isp && (
                    <span className="text-xs text-muted-foreground">
                      {publicIpData.organization}
                    </span>
                  )}
                  {publicIpData.asn && (
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {publicIpData.asn}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <Badge variant="outline" className="text-xs">
            Auto-detected
          </Badge>
        </div>
      </CyberCard>

      <div className="flex gap-2 justify-end mb-6">
        <Button
          variant="outline"
          onClick={() => publicIpData?.ip && updateWithIp.mutate(publicIpData.ip)}
          disabled={updateWithIp.isPending || !publicIpData?.ip}
          className="flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> {updateWithIp.isPending ? "Updating..." : "Update Now"}
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
                <Label>Update Interval (seconds)</Label>
                <Input
                  value={formData.updateInterval}
                  onChange={(e) => setFormData({ ...formData, updateInterval: parseInt(e.target.value) || 1 })}
                  type="number"
                  min="1"
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

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateUpdater.mutate({ id: updater.id, data: { isEnabled: !updater.isEnabled } })}
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
                  className="min-h-10 border-primary/30 text-primary hover:border-primary hover:bg-primary/10"
                >
                  <Pencil className="w-4 h-4" />
                  <span className="sr-only">Edit</span>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteUpdater.mutate(updater.id)}
                  aria-label={`Delete ${updater.hostname}`}
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
