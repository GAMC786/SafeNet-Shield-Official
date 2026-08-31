import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { useDnsServers } from "@/hooks/use-dns";
import { useSafeNetVpn } from "@/hooks/use-vpn";
import { EulaDialog } from "@/components/EulaDialog";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Shield, Smartphone, Lock, Activity, Eye, Zap, AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { data: settings } = useSettings();
  const { data: dnsServers } = useDnsServers();
  const updateSettings = useUpdateSettings();
  const vpn = useSafeNetVpn();
  const { toast } = useToast();
  const [pin, setPin] = useState("");
  const [eulaOpen, setEulaOpen] = useState(false);
  const [startAfterEula, setStartAfterEula] = useState(false);

  const handleToggle = (key: string, checked: boolean) => {
    updateSettings.mutate({ [key]: checked });
  };

  const handleSetPin = () => {
    if (pin.length === 4) {
      updateSettings.mutate({ pinCode: pin, isPinEnabled: true });
      setPin("");
    }
  };

  const activeDnsServer = dnsServers?.find((server) => server.isActive);
  const startVpn = async () => {
    if (!activeDnsServer) {
      toast({
        title: "Select a DNS server first",
        description: "Choose an active resolver in DNS Configuration before enabling protection.",
        variant: "destructive",
      });
      return;
    }

    try {
      const nextStatus = await vpn.start({
        type: activeDnsServer.type,
        primaryAddress: activeDnsServer.primaryAddress,
        secondaryAddress: activeDnsServer.secondaryAddress,
      });
      if (nextStatus.error) {
        throw new Error(nextStatus.error);
      }
      toast({
        title: "DNS protection enabled",
        description: `${activeDnsServer.name} is now handling DNS requests.`,
      });
    } catch (error) {
      toast({
        title: "DNS protection not enabled",
        description: error instanceof Error ? error.message : "Android could not start the VPN service.",
        variant: "destructive",
      });
      await vpn.refresh().catch(() => undefined);
    }
  };

  const handleVpnToggle = async (checked: boolean) => {
    if (!checked) {
      try {
        await vpn.stop();
        toast({ title: "DNS protection disabled" });
      } catch (error) {
        toast({
          title: "Could not stop DNS protection",
          description: error instanceof Error ? error.message : "Android could not stop the VPN service.",
          variant: "destructive",
        });
      }
      return;
    }

    if (!vpn.status?.eulaAccepted) {
      setStartAfterEula(true);
      setEulaOpen(true);
      return;
    }
    await startVpn();
  };

  const handleEulaAccept = async () => {
    try {
      await vpn.acceptEula();
      setEulaOpen(false);
      if (startAfterEula) {
        setStartAfterEula(false);
        await startVpn();
      }
    } catch (error) {
      toast({
        title: "Agreement could not be saved",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Header 
        title="System Settings" 
        subtitle="Configuration & Security" 
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Security Modules */}
        <CyberCard className="space-y-6">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-6 h-6 text-primary" />
            <h2 className="text-xl font-display font-bold">Security Modules</h2>
          </div>

          <div className="flex items-center justify-between p-4 rounded bg-white/5 border border-white/5 hover:border-primary/30 transition-colors">
            <div className="space-y-1">
              <Label className="text-base text-white font-medium flex items-center gap-2">
                <Eye className="w-4 h-4 text-primary" /> AI Shield
              </Label>
              <p className="text-xs text-muted-foreground max-w-[200px]">Active content analysis for nudity and threats</p>
            </div>
            <Switch 
              checked={settings?.aiShieldEnabled ?? false} 
              onCheckedChange={(c) => handleToggle("aiShieldEnabled", c)}
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded bg-white/5 border border-white/5 hover:border-primary/30 transition-colors">
            <div className="space-y-1">
              <Label className="text-base text-white font-medium flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> App Firewall
              </Label>
              <p className="text-xs text-muted-foreground">Block connections from unauthorized apps</p>
            </div>
            <Switch 
              checked={settings?.firewallEnabled ?? false} 
              onCheckedChange={(c) => handleToggle("firewallEnabled", c)}
            />
          </div>
        </CyberCard>

        {/* Device Integration */}
        <CyberCard className="space-y-6">
          <div className="flex items-center gap-3 mb-6">
            <Smartphone className="w-6 h-6 text-primary" />
            <h2 className="text-xl font-display font-bold">Device Integration</h2>
          </div>

          <div className="flex items-center justify-between p-4 rounded bg-white/5 border border-white/5 hover:border-primary/30 transition-colors">
            <div className="space-y-1">
              <Label className="text-base text-white font-medium flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> Always-On VPN
              </Label>
              <p className="text-xs text-muted-foreground">Prevent leaks when connection drops</p>
            </div>
            <Switch 
              checked={settings?.alwaysOnEnabled ?? false} 
              onCheckedChange={(c) => handleToggle("alwaysOnEnabled", c)}
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded bg-white/5 border border-white/5 hover:border-primary/30 transition-colors">
            <div className="space-y-1">
              <Label className="text-base text-white font-medium flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" /> Device Admin
              </Label>
              <p className="text-xs text-muted-foreground">Prevent app uninstallation</p>
            </div>
            <Switch 
              checked={settings?.deviceAdminEnabled ?? false} 
              onCheckedChange={(c) => handleToggle("deviceAdminEnabled", c)}
            />
          </div>
        </CyberCard>

        {vpn.supported && (
          <CyberCard className="md:col-span-2 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-6 h-6 text-primary" />
                <div>
                  <h2 className="text-xl font-display font-bold">DNS Protection VPN</h2>
                  <p className="text-xs text-muted-foreground">
                    Route DNS requests through your active SafeNet resolver
                  </p>
                </div>
              </div>
              <Switch
                checked={vpn.status?.running ?? false}
                onCheckedChange={(checked) => void handleVpnToggle(checked)}
                disabled={vpn.isBusy || !activeDnsServer}
                aria-label="Enable DNS Protection VPN"
              />
            </div>

            <div className="rounded-md border border-white/10 bg-white/5 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                {vpn.isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Activity className="h-4 w-4 text-primary" />
                )}
                <span>
                  {vpn.status?.running
                    ? "Protected and connected"
                    : activeDnsServer
                      ? "Ready to protect DNS"
                      : "Select an active DNS server to continue"}
                </span>
              </div>
              {activeDnsServer && (
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  Resolver: {activeDnsServer.name} ({activeDnsServer.type.toUpperCase()})
                </p>
              )}
              {vpn.status?.error && (
                <p className="mt-2 text-xs text-destructive">{vpn.status.error}</p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                DNS-only protection. Regular web traffic is not routed through this VPN.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setEulaOpen(true)}
            >
              View DNS VPN EULA
            </Button>
          </CyberCard>
        )}

        {/* Access Control */}
        <CyberCard className="md:col-span-2 space-y-6">
          <div className="flex items-center gap-3 mb-6">
            <Lock className="w-6 h-6 text-primary" />
            <h2 className="text-xl font-display font-bold">App Access Protection</h2>
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1 flex items-center justify-between p-4 rounded bg-white/5 border border-white/5">
              <div className="space-y-1">
                <Label className="text-base text-white font-medium">PIN Protection</Label>
                <p className="text-xs text-muted-foreground">Require PIN to open app</p>
              </div>
              <Switch 
                checked={settings?.isPinEnabled ?? false} 
                onCheckedChange={(c) => handleToggle("isPinEnabled", c)}
              />
            </div>

            <div className="flex-1 space-y-2">
              <Label>Update PIN Code</Label>
              <div className="flex gap-2">
                <Input 
                  type="password" 
                  maxLength={4} 
                  placeholder="****" 
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                  className="bg-background border-border font-mono tracking-widest text-center"
                />
                <Button 
                  onClick={handleSetPin}
                  disabled={pin.length !== 4}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
                >
                  Set PIN
                </Button>
              </div>
            </div>
          </div>
        </CyberCard>
        
        <div className="md:col-span-2 flex items-center justify-center p-4 rounded border border-yellow-500/20 bg-yellow-500/5 text-yellow-500 text-sm gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-mono uppercase">SafeNet DNS Server (Official) v1.0.6</span>
        </div>
      </div>
      {vpn.supported && (
        <EulaDialog
          open={eulaOpen}
          onOpenChange={(open) => {
            setEulaOpen(open);
            if (!open) {
              setStartAfterEula(false);
            }
          }}
          onAccept={handleEulaAccept}
          isAccepting={vpn.isBusy}
        />
      )}
    </div>
  );
}
