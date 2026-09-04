import { useState } from "react";
import { useBlocklists, useCreateBlocklist, useDeleteBlocklist } from "@/hooks/use-blocklists";
import { useUpdateBlocklist } from "@/hooks/use-blocklists";
import { useFirewallRules, useCreateFirewallRule, useUpdateFirewallRule, useDeleteFirewallRule } from "@/hooks/use-firewall-rules";
import type { Blocklist, FirewallRule, InsertFirewallRule } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { List, Search, Pencil, Trash2, Plus, Ban, Zap, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const GOOGLE_GMAIL_DOMAINS = [
  "accounts.google.com",
  "gmail.com",
  "google.com",
  "googleapis.com",
  "gstatic.com",
];

export default function Firewall() {
  const { toast } = useToast();
  const { data: blocklists } = useBlocklists();
  const createBlock = useCreateBlocklist();
  const updateBlock = useUpdateBlocklist();
  const deleteBlock = useDeleteBlocklist();
  
  const { data: rules } = useFirewallRules();
  const createRule = useCreateFirewallRule();
  const updateRule = useUpdateFirewallRule();
  const deleteRule = useDeleteFirewallRule();

  const [newDomain, setNewDomain] = useState("");
  const [newDomainAction, setNewDomainAction] = useState<"allow" | "block">("block");
  const [newKeyword, setNewKeyword] = useState("");
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(null);
  const [editingBlocklist, setEditingBlocklist] = useState<Blocklist | null>(null);
  const [editedBlocklistContent, setEditedBlocklistContent] = useState("");
  const [editedBlocklistAction, setEditedBlocklistAction] = useState<"allow" | "block">("block");
  const [newRule, setNewRule] = useState<InsertFirewallRule>({
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
    const content = newDomain.trim();
    if (!content) return;
    createBlock.mutate({
      type: "domain",
      content,
      category: "custom",
      action: newDomainAction,
      isActive: true
    }, {
      onSuccess: () => toast({
        title: "URL rule added",
        description: `${content} will be ${newDomainAction === "block" ? "blocked" : "allowed"}.`,
      }),
      onError: (error) => toast({
        title: "URL rule could not be added",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      }),
    });
    setNewDomain("");
  };

  const handleAddKeyword = () => {
    if (!newKeyword) return;
    const content = newKeyword.trim();
    if (!content) return;
    createBlock.mutate({
      type: "keyword",
      content,
      category: "custom",
      isActive: true
    }, {
      onSuccess: () => toast({
        title: "Keyword filter added",
        description: `${content} will be filtered from DNS requests.`,
      }),
      onError: (error) => toast({
        title: "Keyword filter could not be added",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      }),
    });
    setNewKeyword("");
  };

  const resetRuleForm = () => {
    setNewRule({
      name: "",
      sourceInterface: "lan",
      sourceAddress: "Any",
      destinationInterface: "wan",
      destinationAddress: "Any",
      service: "dns",
      action: "deny",
    });
    setEditingRule(null);
  };

  const openCreateRuleDialog = () => {
    resetRuleForm();
    setIsRuleDialogOpen(true);
  };

  const openEditRuleDialog = (rule: FirewallRule) => {
    setEditingRule(rule);
    setNewRule({
      name: rule.name,
      sourceInterface: rule.sourceInterface,
      sourceAddress: rule.sourceAddress || "Any",
      destinationInterface: rule.destinationInterface,
      destinationAddress: rule.destinationAddress || "Any",
      service: rule.service,
      action: rule.action,
    });
    setIsRuleDialogOpen(true);
  };

  const handleSaveRule = () => {
    if (!newRule.name) {
      toast({ title: "Firewall rule name required", description: "Enter a name before saving the rule.", variant: "destructive" });
      return;
    }
    const onSuccess = () => {
      setIsRuleDialogOpen(false);
      resetRuleForm();
      toast({
        title: editingRule ? "Firewall rule updated" : "Firewall rule created",
        description: editingRule
          ? "The access rule changes are now active."
          : `${newRule.name} is now active.`,
      });
    };
    if (editingRule) {
      updateRule.mutate({ id: editingRule.id, data: newRule }, { onSuccess });
      return;
    }
    createRule.mutate(newRule, {
      onSuccess,
    });
  };

  const openEditBlocklistDialog = (item: Blocklist) => {
    setEditingBlocklist(item);
    setEditedBlocklistContent(item.content);
    setEditedBlocklistAction(item.action === "allow" ? "allow" : "block");
  };

  const closeEditBlocklistDialog = () => {
    setEditingBlocklist(null);
    setEditedBlocklistContent("");
    setEditedBlocklistAction("block");
  };

  const handleSaveBlocklist = () => {
    const content = editedBlocklistContent.trim();
    if (!editingBlocklist || !content) return;
    updateBlock.mutate(
      {
        id: editingBlocklist.id,
        data: {
          content,
          ...(editingBlocklist.type === "domain" ? { action: editedBlocklistAction } : {}),
        },
      },
      {
        onSuccess: () => {
          const filterType = editingBlocklist.type === "keyword" ? "keyword filter" : "URL rule";
          closeEditBlocklistDialog();
          toast({
            title: `${filterType[0].toUpperCase()}${filterType.slice(1)} updated`,
            description: `${content} is now configured to ${editingBlocklist.type === "domain" ? editedBlocklistAction : "block"} matching requests.`,
          });
        },
        onError: (error) => toast({
          title: "Filter could not be updated",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        }),
      },
    );
  };

  const handleToggleBlocklist = (item: Blocklist) => {
    updateBlock.mutate(
      { id: item.id, data: { isActive: !item.isActive } },
      {
        onSuccess: () => toast({
          title: `${item.type === "keyword" ? "Keyword filter" : "URL rule"} ${item.isActive ? "disabled" : "enabled"}`,
          description: `${item.content} is now ${item.isActive ? "ignored" : "active"} by SafeNet filtering.`,
        }),
        onError: (error) => toast({
          title: "Filter status could not be changed",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        }),
      },
    );
  };

  const handleAllowGoogleServices = async () => {
    try {
      let createdCount = 0;
      let updatedCount = 0;
      let unchangedCount = 0;

      for (const domain of GOOGLE_GMAIL_DOMAINS) {
        const existing = blocklists?.filter((item) => item.type === "domain" && item.content.toLowerCase() === domain) || [];
        if (existing.length > 0) {
          let changed = false;
          for (const item of existing) {
            if (item.action !== "allow" || !item.isActive) {
              await updateBlock.mutateAsync({ id: item.id, data: { action: "allow", isActive: true } });
              changed = true;
            }
          }
          if (changed) {
            updatedCount += 1;
          } else {
            unchangedCount += 1;
          }
        } else {
          await createBlock.mutateAsync({
            type: "domain",
            content: domain,
            category: "google-gmail",
            action: "allow",
            isActive: true,
          });
          createdCount += 1;
        }
      }

      const changedCount = createdCount + updatedCount;
      if (changedCount === 0) {
        toast({
          title: "Google and Gmail access already allowed",
          description: "All required Google and Gmail DNS rules are already active.",
        });
        return;
      }

      toast({
        title: "Google and Gmail access rules updated",
        description: [
          createdCount > 0 ? `${createdCount} rule${createdCount === 1 ? "" : "s"} added` : "",
          updatedCount > 0 ? `${updatedCount} existing rule${updatedCount === 1 ? "" : "s"} enabled` : "",
          unchangedCount > 0 ? `${unchangedCount} already active` : "",
        ].filter(Boolean).join("; ") + ".",
      });
    } catch (error) {
      toast({
        title: "Google and Gmail access could not be allowed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteRule = async (rule: FirewallRule) => {
    if (!window.confirm(`Delete the firewall rule "${rule.name}"?`)) return;
    try {
      await deleteRule.mutateAsync(rule.id);
      toast({ title: "Firewall rule deleted", description: `${rule.name} was removed.` });
    } catch (error) {
      toast({
        title: "Firewall rule could not be deleted",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleToggleRule = (rule: FirewallRule) => {
    updateRule.mutate(
      { id: rule.id, data: { isEnabled: !rule.isEnabled } },
      {
        onSuccess: () => toast({
          title: `Access rule ${rule.isEnabled ? "disabled" : "enabled"}`,
          description: `${rule.name} is now ${rule.isEnabled ? "inactive" : "active"}.`,
        }),
        onError: (error) => toast({
          title: "Access rule status could not be changed",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        }),
      },
    );
  };

  const handleDeleteBlocklist = async (item: Blocklist) => {
    if (!window.confirm(`Delete the ${item.type === "keyword" ? "keyword filter" : "URL rule"} "${item.content}"?`)) return;
    try {
      await deleteBlock.mutateAsync(item.id);
      toast({
        title: item.type === "keyword" ? "Keyword filter deleted" : "URL rule deleted",
        description: `${item.content} was removed.`,
      });
    } catch (error) {
      toast({
        title: "Filter could not be deleted",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
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
          <div className="flex-1">
            <h2 className="text-xl font-display font-bold text-white">DNS Firewall Rules</h2>
            <p className="text-muted-foreground">
              Block domains through SafeNet&apos;s DNS path when the Android VPN is active. {blocklists?.filter((item) => item.isActive).length || 0} active custom rules.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 border-primary/40 text-primary hover:bg-primary/10"
            onClick={() => void handleAllowGoogleServices()}
            disabled={createBlock.isPending || updateBlock.isPending}
          >
            <Check className="mr-2 h-4 w-4" />
            Allow Google &amp; Gmail
          </Button>
        </div>
      </CyberCard>

      <Tabs defaultValue="rules" className="w-full" orientation="vertical">
        <div className="flex flex-col md:flex-row gap-6">
          <TabsList className="flex flex-col h-auto bg-card border border-white/5 p-2 md:w-48 shrink-0">
            <TabsTrigger value="rules" className="w-full justify-start font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              Access Rules
            </TabsTrigger>
            <TabsTrigger value="domains" className="w-full justify-start font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              Allow/Block URLs
            </TabsTrigger>
            <TabsTrigger value="keywords" className="w-full justify-start font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              Keyword Filtering
            </TabsTrigger>
          </TabsList>
          <div className="flex-1">

        <TabsContent value="rules" className="mt-0 space-y-4">
          <div className="flex justify-end mb-4">
            <Dialog open={isRuleDialogOpen} onOpenChange={(open) => {
              setIsRuleDialogOpen(open);
              if (!open) resetRuleForm();
            }}>
              <DialogTrigger asChild>
                <Button onClick={openCreateRuleDialog} className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
                  <Plus className="w-4 h-4 mr-2" /> New Rule
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border text-foreground sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle className="font-display tracking-wider">
                    {editingRule ? "Edit Firewall Rule" : "Create Firewall Rule"}
                  </DialogTitle>
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
                      <Label>Source Address</Label>
                      <Input
                        value={newRule.sourceAddress || ""}
                        onChange={(e) => setNewRule({ ...newRule, sourceAddress: e.target.value || "Any" })}
                        placeholder="Any or CIDR"
                        className="bg-background border-border font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Destination Address</Label>
                      <Input
                        value={newRule.destinationAddress || ""}
                        onChange={(e) => setNewRule({ ...newRule, destinationAddress: e.target.value || "Any" })}
                        placeholder="Any or CIDR"
                        className="bg-background border-border font-mono"
                      />
                    </div>
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

                  <Button onClick={handleSaveRule} className="w-full bg-primary hover:bg-primary/90" disabled={createRule.isPending || updateRule.isPending || !newRule.name.trim()}>
                    {createRule.isPending || updateRule.isPending ? "Saving..." : editingRule ? "Save Changes" : "Create Rule"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-3">
            {rules && rules.length > 0 ? (
              rules.map(rule => (
                <CyberCard key={rule.id} className={`p-4 ${rule.isEnabled === false ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Zap className={`w-4 h-4 ${rule.action === "deny" ? "text-destructive" : "text-primary"}`} />
                        <h4 className="font-display font-bold text-white">{rule.name}</h4>
                        <Badge variant={rule.action === "deny" ? "destructive" : "default"} className="text-xs">
                          {rule.action.toUpperCase()}
                        </Badge>
                      </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs font-mono">
                        <div className="flex flex-col">
                          <span className="text-muted-foreground">Source</span>
                          <span className="text-foreground uppercase">{rule.sourceInterface}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-muted-foreground">Destination</span>
                          <span className="text-foreground uppercase">{rule.destinationInterface}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-muted-foreground">Service</span>
                          <span className="text-foreground uppercase">{rule.service}</span>
                        </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Addresses</span>
                  <span className="text-foreground break-words">
                    {rule.sourceAddress || "Any"} → {rule.destinationAddress || "Any"}
                  </span>
                </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleRule(rule)}
                        className={rule.isEnabled === false ? "text-muted-foreground hover:text-primary" : "text-primary hover:text-primary hover:bg-primary/10"}
                        aria-label={`${rule.isEnabled === false ? "Enable" : "Disable"} ${rule.name}`}
                      >
                        {rule.isEnabled === false ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditRuleDialog(rule)}
                        className="text-primary hover:text-primary hover:bg-primary/10"
                        aria-label={`Edit ${rule.name}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                       onClick={() => void handleDeleteRule(rule)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${rule.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
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

          <Dialog open={editingBlocklist !== null} onOpenChange={(open) => {
            if (!open) closeEditBlocklistDialog();
          }}>
            <DialogContent className="bg-card border-border text-foreground sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle className="font-display tracking-wider">
                  Edit {editingBlocklist?.type === "keyword" ? "Keyword" : "URL Rule"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                {editingBlocklist?.type === "domain" && (
                  <div className="space-y-2">
                    <Label>Action</Label>
                    <Select value={editedBlocklistAction} onValueChange={(value: "allow" | "block") => setEditedBlocklistAction(value)}>
                      <SelectTrigger className="bg-background border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="allow">Allow</SelectItem>
                        <SelectItem value="block">Block</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>{editingBlocklist?.type === "keyword" ? "Keyword" : "Domain or URL"}</Label>
                  <Input
                    value={editedBlocklistContent}
                    onChange={(event) => setEditedBlocklistContent(event.target.value)}
                    className="bg-background border-border font-mono"
                    autoFocus
                  />
                </div>
                <Button onClick={handleSaveBlocklist} className="w-full" disabled={updateBlock.isPending || !editedBlocklistContent.trim()}>
                  {updateBlock.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

        <TabsContent value="domains" className="mt-0 space-y-4">
          <div className="flex gap-2">
            <Select value={newDomainAction} onValueChange={(v: "allow" | "block") => setNewDomainAction(v)}>
              <SelectTrigger className="w-28 bg-card border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="allow">Allow</SelectItem>
                <SelectItem value="block">Block</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Enter URL or domain (e.g. example.com)" 
                className="pl-10 bg-card border-border font-mono"
                value={newDomain}
                onChange={e => setNewDomain(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddDomain()}
                data-testid="input-domain-url"
              />
            </div>
            <Button 
              onClick={handleAddDomain}
              disabled={createBlock.isPending || !newDomain.trim()}
              className={newDomainAction === "block" ? "bg-destructive hover:bg-destructive/80 text-white font-bold" : "bg-primary hover:bg-primary/80 text-white font-bold"}
              data-testid="button-add-domain"
            >
              <Plus className="w-4 h-4 mr-2" /> {newDomainAction === "block" ? "Block" : "Allow"}
            </Button>
          </div>

          <div className="grid gap-2">
            {domains.map(item => (
              <div 
                key={item.id} 
                className={`flex items-center justify-between p-3 rounded-lg bg-card/50 border transition-colors group ${
                    item.action === "block" ? "border-destructive/20 hover:border-destructive/40" : "border-primary/20 hover:border-primary/40"
                  } ${!item.isActive ? "opacity-50" : ""}`}
                data-testid={`url-rule-${item.id}`}
              >
                <div className="flex items-center gap-3">
                  {item.action === "block" ? (
                    <X className="w-4 h-4 text-destructive" />
                  ) : (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                  <span className="font-mono text-sm">{item.content}</span>
                  <Badge 
                    variant={item.action === "block" ? "destructive" : "default"} 
                    className="text-[10px]"
                  >
                    {item.action?.toUpperCase() || "BLOCK"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={item.isActive ? "text-primary hover:text-primary hover:bg-primary/10" : "text-muted-foreground hover:text-primary"}
                    onClick={() => handleToggleBlocklist(item)}
                    aria-label={`${item.isActive ? "Disable" : "Enable"} ${item.content}`}
                    data-testid={`button-toggle-rule-${item.id}`}
                  >
                    {item.isActive ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => openEditBlocklistDialog(item)}
                    aria-label={`Edit ${item.content}`}
                    data-testid={`button-edit-rule-${item.id}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void handleDeleteBlocklist(item)}
                    aria-label={`Delete ${item.content}`}
                    data-testid={`button-delete-rule-${item.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            {domains.length === 0 && (
              <p className="text-center py-8 text-muted-foreground font-mono text-sm">No URL rules configured yet.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="keywords" className="mt-0 space-y-4">
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
            <Button onClick={handleAddKeyword} disabled={createBlock.isPending || !newKeyword.trim()} className="bg-destructive hover:bg-destructive/80 text-white font-bold">
              <Plus className="w-4 h-4 mr-2" /> Filter
            </Button>
          </div>

          <div className="grid gap-2">
            {keywords.map(item => (
              <div key={item.id} className={`flex items-center justify-between p-3 rounded-lg bg-card/50 border border-white/5 hover:border-destructive/30 transition-colors group ${!item.isActive ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-3">
                  <List className="w-4 h-4 text-destructive" />
                  <span className="font-mono text-sm">{item.content}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={item.isActive ? "text-primary hover:text-primary hover:bg-primary/10" : "text-muted-foreground hover:text-primary"}
                    onClick={() => handleToggleBlocklist(item)}
                    aria-label={`${item.isActive ? "Disable" : "Enable"} ${item.content}`}
                  >
                    {item.isActive ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => openEditBlocklistDialog(item)}
                    aria-label={`Edit ${item.content}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => void handleDeleteBlocklist(item)}
                    aria-label={`Delete ${item.content}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            {keywords.length === 0 && (
              <p className="text-center py-8 text-muted-foreground font-mono text-sm">No keywords filtered yet.</p>
            )}
          </div>
        </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
