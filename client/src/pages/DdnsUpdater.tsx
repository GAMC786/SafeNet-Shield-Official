import { useState } from "react";
import { useDdnsUpdaters, useCreateDdnsUpdater, useDeleteDdnsUpdater, useUpdateDdnsUpdater, usePublicIp, useUpdateDdnsWithIp } from "@/hooks/use-ddns";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Globe, Plus, Trash2, RefreshCw, Check, Clock, Wifi } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export default function DdnsUpdater() {
  const { data: updaters, isLoading } = useDdnsUpdaters();
  const { data: publicIpData } = usePublicIp();
  const createUpdater = useCreateDdnsUpdater();
  const deleteUpdater = useDeleteDdnsUpdater();
  const updateUpdater = useUpdateDdnsUpdater();
  const updateWithIp = useUpdateDdnsWithIp();
  const [isOpen, setIsOpen] = useState(false);

  const [formData, setFormData] = useState({
    hostname: "",
    provider: "duckdns" as "duckdns" | "noip" | "dynu" | "dnsomatic" | "iplink",
    apiKey: "",
    customUrl: "",
    updateInterval: 3600,
    isEnabled: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createUpdater.mutateAsync(formData);
    setIsOpen(false);
    setFormData({
      hostname: "",
      provider: "duckdns",
      apiKey: "",
      customUrl: "",
      updateInterval: 3600,
      isEnabled: true,
    });
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

      <div className="flex gap-2 justify-end mb-6">
        <Button
          variant="outline"
          onClick={() => publicIpData?.ip && updateWithIp.mutate(publicIpData.ip)}
          disabled={updateWithIp.isPending || !publicIpData?.ip}
          className="flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> {updateWithIp.isPending ? "Updating..." : "Update Now"}
        </Button>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
              <Plus className="w-4 h-4 mr-2" /> Add DDNS
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border text-foreground sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="font-display tracking-wider">New DDNS Updater</DialogTitle>
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
                    placeholder="https://example.com/update?ip={ip}&host={hostname}"
                    className="bg-background border-border font-mono text-xs"
                    required
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
                  placeholder={formData.provider === "iplink" ? "Optional auth token" : "Your API key"}
                  type="password"
                  className="bg-background border-border font-mono"
                  required={formData.provider !== "iplink"}
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

              <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={createUpdater.isPending}>
                {createUpdater.isPending ? "Creating..." : "Create"}
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
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteUpdater.mutate(updater.id)}
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
