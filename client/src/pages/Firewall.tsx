import { useState } from "react";
import { useBlocklists, useCreateBlocklist, useDeleteBlocklist } from "@/hooks/use-blocklists";
import { useFirewallRules, useCreateFirewallRule, useDeleteFirewallRule } from "@/hooks/use-firewall-rules";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Shield, List, Search, Trash2, Plus, Ban, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Firewall() {
  const { data: blocklists } = useBlocklists();
  const createBlock = useCreateBlocklist();
  const deleteBlock = useDeleteBlocklist();
  
  const { data: rules } = useFirewallRules();
  const createRule = useCreateFirewallRule();
  const deleteRule = useDeleteFirewallRule();

  const [newDomain, setNewDomain] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false);
  const [newRule, setNewRule] = useState({
    name: "",
    sourceInterface: "lan",
    sourceAddress: "Any",
    destinationInterface: "wan",
    destinationAddress: "Any",
    service: "dns",
    action: "deny" as const,
  });

  const handleAddDomain = () => {
    if (!newDomain) return;
    createBlock.mutate({
      type: "domain",
      content: newDomain,
      category: "custom",
      isActive: true
    });
    setNewDomain("");
  };

  const handleAddKeyword = () => {
    if (!newKeyword) return;
    createBlock.mutate({
      type: "keyword",
      content: newKeyword,
      category: "custom",
      isActive: true
    });
    setNewKeyword("");
  };

  const handleAddRule = () => {
    if (!newRule.name) return;
    createRule.mutate(newRule);
    setIsRuleDialogOpen(false);
    setNewRule({
      name: "",
      sourceInterface: "lan",
      sourceAddress: "Any",
      destinationInterface: "wan",
      destinationAddress: "Any",
      service: "dns",
      action: "deny",
    });
  };

  const domains = blocklists?.filter(b => b.type === "domain") || [];
  const keywords = blocklists?.filter(b => b.type === "keyword") || [];

  return (
    <div className="space-y-6">
      <Header 
        title="Firewall Rules" 
        subtitle="Access Control Lists" 
        status="active"
      />

      <CyberCard className="bg-gradient-to-r from-destructive/10 to-transparent border-destructive/20">
        <div className="flex items-center gap-4">
          <div className="p-4 bg-destructive/20 rounded-full shadow-[0_0_20px_var(--destructive)]">
            <Ban className="w-8 h-8 text-destructive" />
          </div>
          <div>
            <h2 className="text-xl font-display font-bold text-white">AI Shield Active</h2>
            <p className="text-muted-foreground">Real-time content analysis and blocking is enabled. {blocklists?.length || 0} active custom rules.</p>
          </div>
        </div>
      </CyberCard>

      <Tabs defaultValue="rules" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-card border border-white/5 h-12">
          <TabsTrigger value="rules" className="font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            Access Rules
          </TabsTrigger>
          <TabsTrigger value="domains" className="font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            Domain Blacklist
          </TabsTrigger>
          <TabsTrigger value="keywords" className="font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            Keyword Filtering
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-6 space-y-4">
          <div className="flex justify-end mb-4">
            <Dialog open={isRuleDialogOpen} onOpenChange={setIsRuleDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
                  <Plus className="w-4 h-4 mr-2" /> New Rule
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border text-foreground sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle className="font-display tracking-wider">Create Firewall Rule</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Rule Name</Label>
                    <Input
                      value={newRule.name}
                      onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                      placeholder="e.g., Block DNS"
                      className="bg-background border-border"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Source Interface</Label>
                      <Select value={newRule.sourceInterface} onValueChange={(v: any) => setNewRule({ ...newRule, sourceInterface: v })}>
                        <SelectTrigger className="bg-background border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          <SelectItem value="lan">LAN</SelectItem>
                          <SelectItem value="wan">WAN</SelectItem>
                          <SelectItem value="any">Any</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Dest. Interface</Label>
                      <Select value={newRule.destinationInterface} onValueChange={(v: any) => setNewRule({ ...newRule, destinationInterface: v })}>
                        <SelectTrigger className="bg-background border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          <SelectItem value="lan">LAN</SelectItem>
                          <SelectItem value="wan">WAN</SelectItem>
                          <SelectItem value="any">Any</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Service</Label>
                      <Select value={newRule.service} onValueChange={(v: any) => setNewRule({ ...newRule, service: v })}>
                        <SelectTrigger className="bg-background border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          <SelectItem value="dns">DNS</SelectItem>
                          <SelectItem value="http">HTTP</SelectItem>
                          <SelectItem value="https">HTTPS</SelectItem>
                          <SelectItem value="all">All</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Action</Label>
                      <Select value={newRule.action} onValueChange={(v: any) => setNewRule({ ...newRule, action: v })}>
                        <SelectTrigger className="bg-background border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          <SelectItem value="allow">Allow</SelectItem>
                          <SelectItem value="deny">Deny</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button onClick={handleAddRule} className="w-full bg-primary hover:bg-primary/90" disabled={createRule.isPending || !newRule.name}>
                    {createRule.isPending ? "Creating..." : "Create Rule"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-3">
            {rules && rules.length > 0 ? (
              rules.map(rule => (
                <CyberCard key={rule.id} className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Zap className={`w-4 h-4 ${rule.action === "deny" ? "text-destructive" : "text-primary"}`} />
                        <h4 className="font-display font-bold text-white">{rule.name}</h4>
                        <Badge variant={rule.action === "deny" ? "destructive" : "default"} className="text-xs">
                          {rule.action.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-1">
                        {rule.sourceInterface} → {rule.destinationInterface} | Service: {rule.service}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteRule.mutate(rule.id)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CyberCard>
              ))
            ) : (
              <CyberCard className="text-center py-8 text-muted-foreground">
                No firewall rules configured. Create one to block DNS or other services.
              </CyberCard>
            )}
          </div>
        </TabsContent>

        <TabsContent value="domains" className="mt-6 space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Enter domain to block (e.g. ads.example.com)" 
                className="pl-10 bg-card border-border font-mono"
                value={newDomain}
                onChange={e => setNewDomain(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddDomain()}
              />
            </div>
            <Button onClick={handleAddDomain} className="bg-destructive hover:bg-destructive/80 text-white font-bold">
              <Plus className="w-4 h-4 mr-2" /> Block
            </Button>
          </div>

          <div className="grid gap-2">
            {domains.map(item => (
              <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-white/5 hover:border-destructive/30 transition-colors group">
                <div className="flex items-center gap-3">
                  <Shield className="w-4 h-4 text-destructive" />
                  <span className="font-mono text-sm">{item.content}</span>
                  <Badge variant="secondary" className="text-[10px] bg-white/5 text-muted-foreground">CUSTOM</Badge>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={() => deleteBlock.mutate(item.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            {domains.length === 0 && (
              <p className="text-center py-8 text-muted-foreground font-mono text-sm">No domains blocked yet.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="keywords" className="mt-6 space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <List className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Enter keyword to block (e.g. gambling)" 
                className="pl-10 bg-card border-border font-mono"
                value={newKeyword}
                onChange={e => setNewKeyword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddKeyword()}
              />
            </div>
            <Button onClick={handleAddKeyword} className="bg-destructive hover:bg-destructive/80 text-white font-bold">
              <Plus className="w-4 h-4 mr-2" /> Filter
            </Button>
          </div>

          <div className="grid gap-2">
            {keywords.map(item => (
              <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-white/5 hover:border-destructive/30 transition-colors group">
                <div className="flex items-center gap-3">
                  <List className="w-4 h-4 text-destructive" />
                  <span className="font-mono text-sm">{item.content}</span>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={() => deleteBlock.mutate(item.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            {keywords.length === 0 && (
              <p className="text-center py-8 text-muted-foreground font-mono text-sm">No keywords filtered yet.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
