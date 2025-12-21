import { useState } from "react";
import { 
  useAntivirusSettings, useUpdateAntivirusSettings,
  useThreatFeeds, useCreateThreatFeed, useUpdateThreatFeed, useDeleteThreatFeed,
  useAntivirusEvents, useResolveAntivirusEvent, useAntivirusStats
} from "@/hooks/use-antivirus";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Shield, Bug, AlertTriangle, Database, Plus, Trash2, Check, RefreshCw, Settings, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

export default function Antivirus() {
  const { data: settings } = useAntivirusSettings();
  const updateSettings = useUpdateAntivirusSettings();
  const { data: feeds } = useThreatFeeds();
  const createFeed = useCreateThreatFeed();
  const updateFeed = useUpdateThreatFeed();
  const deleteFeed = useDeleteThreatFeed();
  const { data: events } = useAntivirusEvents();
  const resolveEvent = useResolveAntivirusEvent();
  const { data: stats } = useAntivirusStats();

  const [isFeedDialogOpen, setIsFeedDialogOpen] = useState(false);
  const [newFeed, setNewFeed] = useState({
    name: "",
    type: "malware" as "malware" | "phishing" | "ransomware" | "botnet" | "spam",
    url: "",
    isEnabled: true,
  });

  const handleAddFeed = () => {
    if (!newFeed.name || !newFeed.type) return;
    createFeed.mutate(newFeed, {
      onSuccess: () => {
        setIsFeedDialogOpen(false);
        setNewFeed({ name: "", type: "malware", url: "", isEnabled: true });
      }
    });
  };

  const getThreatTypeColor = (type: string) => {
    switch (type) {
      case "malware": return "bg-destructive/20 text-destructive border-destructive/30";
      case "phishing": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "ransomware": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      case "botnet": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-destructive text-destructive-foreground";
      case "high": return "bg-orange-500 text-white";
      case "medium": return "bg-yellow-500 text-black";
      case "low": return "bg-blue-500 text-white";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-6">
      <Header 
        title="Built-In Antivirus" 
        subtitle="DNS-Aware Threat Protection" 
        status={settings?.isEnabled ? "active" : "inactive"}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CyberCard className="bg-gradient-to-br from-destructive/10 to-transparent border-destructive/20">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-destructive/20 rounded-lg">
              <Bug className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-display font-bold text-destructive" data-testid="text-total-threats">
                {stats?.totalThreats || 0}
              </p>
              <p className="text-sm text-muted-foreground">Total Threats Detected</p>
            </div>
          </div>
        </CyberCard>

        <CyberCard className="bg-gradient-to-br from-primary/10 to-transparent border-primary/20">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/20 rounded-lg">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-display font-bold text-primary" data-testid="text-blocked-today">
                {stats?.blockedToday || 0}
              </p>
              <p className="text-sm text-muted-foreground">Blocked Today</p>
            </div>
          </div>
        </CyberCard>

        <CyberCard className="bg-gradient-to-br from-accent/10 to-transparent border-accent/20">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-accent/20 rounded-lg">
              <Database className="w-6 h-6 text-accent" />
            </div>
            <div>
              <p className="text-2xl font-display font-bold text-accent" data-testid="text-active-feeds">
                {stats?.activeFeeds || 0}
              </p>
              <p className="text-sm text-muted-foreground">Active Threat Feeds</p>
            </div>
          </div>
        </CyberCard>
      </div>

      <Tabs defaultValue="dashboard" className="w-full" orientation="vertical">
        <div className="flex flex-col md:flex-row gap-6">
          <TabsList className="flex flex-col h-auto bg-card border border-white/5 p-2 md:w-48 shrink-0">
            <TabsTrigger value="dashboard" className="w-full justify-start font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <Activity className="w-4 h-4 mr-2" /> Dashboard
            </TabsTrigger>
            <TabsTrigger value="feeds" className="w-full justify-start font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <Database className="w-4 h-4 mr-2" /> Threat Feeds
            </TabsTrigger>
            <TabsTrigger value="events" className="w-full justify-start font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <AlertTriangle className="w-4 h-4 mr-2" /> Threat Log
            </TabsTrigger>
            <TabsTrigger value="settings" className="w-full justify-start font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              <Settings className="w-4 h-4 mr-2" /> Settings
            </TabsTrigger>
          </TabsList>

          <div className="flex-1">
            <TabsContent value="dashboard" className="mt-0 space-y-4">
              <CyberCard>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-display text-lg tracking-wider">Protection Status</h3>
                  <Switch
                    checked={settings?.isEnabled ?? false}
                    onCheckedChange={(checked) => updateSettings.mutate({ isEnabled: checked })}
                    data-testid="switch-antivirus-enabled"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg">
                    <span className="text-sm">Malware Blocking</span>
                    <Switch
                      checked={settings?.malwareDomainBlocking ?? true}
                      onCheckedChange={(checked) => updateSettings.mutate({ malwareDomainBlocking: checked })}
                      data-testid="switch-malware-protection"
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg">
                    <span className="text-sm">Phishing Protection</span>
                    <Switch
                      checked={settings?.phishingProtection ?? true}
                      onCheckedChange={(checked) => updateSettings.mutate({ phishingProtection: checked })}
                      data-testid="switch-phishing-protection"
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg">
                    <span className="text-sm">Real-time Protection</span>
                    <Switch
                      checked={settings?.realTimeProtection ?? true}
                      onCheckedChange={(checked) => updateSettings.mutate({ realTimeProtection: checked })}
                      data-testid="switch-realtime-scanning"
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg">
                    <span className="text-sm">Auto-Quarantine</span>
                    <Switch
                      checked={settings?.autoQuarantine ?? true}
                      onCheckedChange={(checked) => updateSettings.mutate({ autoQuarantine: checked })}
                      data-testid="switch-auto-update"
                    />
                  </div>
                </div>
              </CyberCard>

              <CyberCard>
                <h3 className="font-display text-lg tracking-wider mb-4">Recent Threats</h3>
                <div className="space-y-2">
                  {events?.slice(0, 5).map((event) => (
                    <div key={event.id} className="flex items-center justify-between p-3 bg-background/50 rounded-lg" data-testid={`threat-event-${event.id}`}>
                      <div className="flex items-center gap-3">
                        <AlertTriangle className={`w-4 h-4 ${event.severity === 'critical' ? 'text-destructive' : 'text-yellow-500'}`} />
                        <div>
                          <p className="text-sm font-medium">{event.domain}</p>
                          <p className="text-xs text-muted-foreground">{event.threatType}</p>
                        </div>
                      </div>
                      <Badge className={getSeverityColor(event.severity || 'medium')} variant="secondary">
                        {event.severity}
                      </Badge>
                    </div>
                  )) || (
                    <p className="text-center text-muted-foreground py-4">No threats detected</p>
                  )}
                </div>
              </CyberCard>
            </TabsContent>

            <TabsContent value="feeds" className="mt-0 space-y-4">
              <div className="flex justify-end">
                <Dialog open={isFeedDialogOpen} onOpenChange={setIsFeedDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="bg-primary hover:bg-primary/90" data-testid="button-add-feed">
                      <Plus className="w-4 h-4 mr-2" /> Add Feed
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="bg-card border-border">
                    <DialogHeader>
                      <DialogTitle className="font-display tracking-wider">Add Threat Feed</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 mt-4">
                      <div className="space-y-2">
                        <Label>Feed Name</Label>
                        <Input
                          value={newFeed.name}
                          onChange={(e) => setNewFeed({ ...newFeed, name: e.target.value })}
                          placeholder="e.g., Custom Malware List"
                          className="bg-background border-border"
                          data-testid="input-feed-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select value={newFeed.type} onValueChange={(v) => setNewFeed({ ...newFeed, type: v as typeof newFeed.type })}>
                          <SelectTrigger className="bg-background border-border" data-testid="select-feed-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            <SelectItem value="malware">Malware</SelectItem>
                            <SelectItem value="phishing">Phishing</SelectItem>
                            <SelectItem value="ransomware">Ransomware</SelectItem>
                            <SelectItem value="botnet">Botnet</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Feed URL (optional)</Label>
                        <Input
                          value={newFeed.url || ""}
                          onChange={(e) => setNewFeed({ ...newFeed, url: e.target.value })}
                          placeholder="https://..."
                          className="bg-background border-border"
                          data-testid="input-feed-url"
                        />
                      </div>
                      <Button onClick={handleAddFeed} className="w-full" data-testid="button-confirm-add-feed">
                        Add Feed
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <CyberCard>
                <div className="space-y-3">
                  {feeds?.map((feed) => (
                    <div key={feed.id} className="flex items-center justify-between p-4 bg-background/50 rounded-lg" data-testid={`feed-${feed.id}`}>
                      <div className="flex items-center gap-4">
                        <Switch
                          checked={feed.isEnabled ?? false}
                          onCheckedChange={(checked) => updateFeed.mutate({ id: feed.id, data: { isEnabled: checked } })}
                          data-testid={`switch-feed-${feed.id}`}
                        />
                        <div>
                          <p className="font-medium">{feed.name}</p>
                          {feed.url && <p className="text-xs text-muted-foreground truncate max-w-xs">{feed.url}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge className={getThreatTypeColor(feed.type)} variant="outline">
                          {feed.type}
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteFeed.mutate(feed.id)}
                          data-testid={`button-delete-feed-${feed.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  )) || (
                    <p className="text-center text-muted-foreground py-8">No threat feeds configured</p>
                  )}
                </div>
              </CyberCard>
            </TabsContent>

            <TabsContent value="events" className="mt-0 space-y-4">
              <CyberCard>
                <div className="space-y-3">
                  {events?.length ? events.map((event) => (
                    <div key={event.id} className={`flex items-center justify-between p-4 rounded-lg ${event.isResolved ? 'bg-muted/30' : 'bg-background/50'}`} data-testid={`event-${event.id}`}>
                      <div className="flex items-center gap-4">
                        <div className={`p-2 rounded-lg ${event.isResolved ? 'bg-green-500/20' : 'bg-destructive/20'}`}>
                          {event.isResolved ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-destructive" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{event.domain}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{event.threatType}</span>
                            <span>|</span>
                            <span>{event.sourceIp}</span>
                            {event.timestamp && (
                              <>
                                <span>|</span>
                                <span>{format(new Date(event.timestamp), "MMM d, HH:mm")}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge className={getSeverityColor(event.severity || 'medium')} variant="secondary">
                          {event.severity}
                        </Badge>
                        {!event.isResolved && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => resolveEvent.mutate(event.id)}
                            data-testid={`button-resolve-${event.id}`}
                          >
                            <Check className="w-3 h-3 mr-1" /> Resolve
                          </Button>
                        )}
                      </div>
                    </div>
                  )) : (
                    <p className="text-center text-muted-foreground py-8">No threat events recorded</p>
                  )}
                </div>
              </CyberCard>
            </TabsContent>

            <TabsContent value="settings" className="mt-0 space-y-4">
              <CyberCard>
                <h3 className="font-display text-lg tracking-wider mb-4">Antivirus Configuration</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-background/50 rounded-lg">
                    <div>
                      <p className="font-medium">Enable Antivirus Protection</p>
                      <p className="text-sm text-muted-foreground">Block connections to known malicious domains</p>
                    </div>
                    <Switch
                      checked={settings?.isEnabled ?? false}
                      onCheckedChange={(checked) => updateSettings.mutate({ isEnabled: checked })}
                      data-testid="switch-main-enabled"
                    />
                  </div>
                  
                  <div className="flex items-center justify-between p-4 bg-background/50 rounded-lg">
                    <div>
                      <p className="font-medium">Malware Domain Blocking</p>
                      <p className="text-sm text-muted-foreground">Block domains known to distribute malware</p>
                    </div>
                    <Switch
                      checked={settings?.malwareDomainBlocking ?? true}
                      onCheckedChange={(checked) => updateSettings.mutate({ malwareDomainBlocking: checked })}
                      data-testid="switch-malware-settings"
                    />
                  </div>
                  
                  <div className="flex items-center justify-between p-4 bg-background/50 rounded-lg">
                    <div>
                      <p className="font-medium">Phishing Site Blocking</p>
                      <p className="text-sm text-muted-foreground">Block sites attempting to steal credentials</p>
                    </div>
                    <Switch
                      checked={settings?.phishingProtection ?? true}
                      onCheckedChange={(checked) => updateSettings.mutate({ phishingProtection: checked })}
                      data-testid="switch-phishing-settings"
                    />
                  </div>
                  
                  <div className="flex items-center justify-between p-4 bg-background/50 rounded-lg">
                    <div>
                      <p className="font-medium">Real-time DNS Scanning</p>
                      <p className="text-sm text-muted-foreground">Analyze DNS queries in real-time for threats</p>
                    </div>
                    <Switch
                      checked={settings?.realTimeProtection ?? true}
                      onCheckedChange={(checked) => updateSettings.mutate({ realTimeProtection: checked })}
                      data-testid="switch-realtime-settings"
                    />
                  </div>
                  
                  <div className="flex items-center justify-between p-4 bg-background/50 rounded-lg">
                    <div>
                      <p className="font-medium">Auto-Quarantine Threats</p>
                      <p className="text-sm text-muted-foreground">Automatically quarantine detected threats</p>
                    </div>
                    <Switch
                      checked={settings?.autoQuarantine ?? true}
                      onCheckedChange={(checked) => updateSettings.mutate({ autoQuarantine: checked })}
                      data-testid="switch-autoupdate-settings"
                    />
                  </div>

                  <div className="pt-4 border-t border-border">
                    <Button variant="outline" className="w-full" data-testid="button-update-feeds">
                      <RefreshCw className="w-4 h-4 mr-2" /> Update All Feeds Now
                    </Button>
                  </div>
                </div>
              </CyberCard>
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
