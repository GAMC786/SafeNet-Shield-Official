import { useState } from "react";
import { useDnsServers, useCreateDnsServer, useDeleteDnsServer, useActivateDnsServer } from "@/hooks/use-dns";
import { useToast } from "@/hooks/use-toast";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Globe, Server, Plus, Trash2, CheckCircle, Shield, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export default function DnsSettings() {
  const { data: servers } = useDnsServers();
  const createServer = useCreateDnsServer();
  const deleteServer = useDeleteDnsServer();
  const activateServer = useActivateDnsServer();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    type: "plain",
    primaryAddress: "",
    secondaryAddress: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createServer.mutateAsync({
        ...formData,
        isCustom: true,
        isActive: false
      } as any);
      setIsOpen(false);
      setFormData({ name: "", type: "plain", primaryAddress: "", secondaryAddress: "" });
      toast({
        title: "DNS server added",
        description: `${formData.name} is now available in your resolver list.`,
      });
    } catch (error) {
      toast({
        title: "DNS server not added",
        description: error instanceof Error ? error.message : "Unable to save this DNS server.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Header 
        title="DNS Configuration" 
        subtitle="Manage Resolvers" 
      />

      <div className="flex justify-end mb-6">
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold font-display tracking-wider">
              <Plus className="w-4 h-4 mr-2" /> Add Server
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border text-foreground sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="font-display tracking-wider text-xl">New DNS Entry</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Server Name</Label>
                <Input 
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g. Google DNS"
                  className="bg-background border-border"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label>Protocol Type</Label>
                <Select 
                  value={formData.type} 
                  onValueChange={v => setFormData({...formData, type: v})}
                >
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="plain">Plain DNS (UDP/53)</SelectItem>
                    <SelectItem value="doh">DNS over HTTPS (DoH)</SelectItem>
                    <SelectItem value="dot">DNS over TLS (DoT)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Primary Address</Label>
                <Input 
                  value={formData.primaryAddress}
                  onChange={e => setFormData({...formData, primaryAddress: e.target.value})}
                  placeholder={formData.type === 'doh' ? 'https://...' : '8.8.8.8'}
                  className="bg-background border-border font-mono"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Secondary Address (Optional)</Label>
                <Input 
                  value={formData.secondaryAddress}
                  onChange={e => setFormData({...formData, secondaryAddress: e.target.value})}
                  placeholder="8.8.4.4"
                  className="bg-background border-border font-mono"
                />
              </div>

              <Button type="submit" className="w-full bg-primary text-primary-foreground font-bold mt-4">
                {createServer.isPending ? "Configuring..." : "Add Server"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {servers?.map((server) => (
          <CyberCard 
            key={server.id} 
            className={`flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-l-4 ${server.isActive ? 'border-l-primary bg-primary/5' : 'border-l-transparent'}`}
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${server.isActive ? 'bg-primary/20 text-primary' : 'bg-white/5 text-muted-foreground'}`}>
                {server.type === 'doh' ? <Globe className="w-6 h-6" /> : 
                 server.type === 'dot' ? <Lock className="w-6 h-6" /> : 
                 <Server className="w-6 h-6" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white">{server.name}</h3>
                  <Badge variant="outline" className="text-xs font-mono uppercase border-white/10 bg-white/5">
                    {server.type}
                  </Badge>
                </div>
                <p className="text-sm font-mono text-muted-foreground mt-1">
                  {server.primaryAddress}
                  {server.secondaryAddress && <span className="opacity-50"> • {server.secondaryAddress}</span>}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <Button
                variant={server.isActive ? "default" : "outline"}
                size="sm"
                onClick={() => activateServer.mutate(server.id)}
                disabled={server.isActive || activateServer.isPending}
                className={`flex-1 md:flex-none ${server.isActive ? 'bg-green-600 hover:bg-green-700 text-white' : 'border-primary/50 text-primary hover:bg-primary/10'}`}
              >
                {server.isActive ? (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" /> Active
                  </>
                ) : "Use This"}
              </Button>
              
              {server.isCustom && (
                <Button
                  variant="destructive"
                  size="icon"
                  className="bg-destructive/10 hover:bg-destructive/30 text-destructive border border-destructive/20"
                  onClick={() => deleteServer.mutate(server.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </CyberCard>
        ))}
      </div>
    </div>
  );
}
