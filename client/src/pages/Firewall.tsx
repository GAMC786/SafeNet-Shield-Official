import { useState } from "react";
import { useBlocklists, useCreateBlocklist, useDeleteBlocklist } from "@/hooks/use-blocklists";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Shield, List, Search, Trash2, Plus, Ban } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export default function Firewall() {
  const { data: blocklists } = useBlocklists();
  const createBlock = useCreateBlocklist();
  const deleteBlock = useDeleteBlocklist();
  
  const [newDomain, setNewDomain] = useState("");
  const [newKeyword, setNewKeyword] = useState("");

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

      <Tabs defaultValue="domains" className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-card border border-white/5 h-12">
          <TabsTrigger value="domains" className="font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            Domain Blacklist
          </TabsTrigger>
          <TabsTrigger value="keywords" className="font-display tracking-wider data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            Keyword Filtering
          </TabsTrigger>
        </TabsList>

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
