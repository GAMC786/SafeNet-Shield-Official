import { useAuthStatus, useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { useDnsServers } from "@/hooks/use-dns";
import { useSafeNetVpn } from "@/hooks/use-vpn";
import { AiShieldControls } from "@/components/AiShieldControls";
import { EulaDialog } from "@/components/EulaDialog";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Shield, Smartphone, Lock, Activity, Eye, Zap, AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import wordmarkImage from "@/assets/safenet-inc-logo.svg";
import { PinEntry } from "@/pages/PinEntry";

export default function Settings() {
  const authStatus = useAuthStatus();
  const isAuthenticated = authStatus.data?.authenticated === true;
  const { data: settings } = useSettings(isAuthenticated);
  const { data: dnsServers } = useDnsServers();
  const updateSettings = useUpdateSettings();
  const vpn = useSafeNetVpn();
  const { toast } = useToast();
  const [pin, setPin] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [eulaOpen, setEulaOpen] = useState(false);
  const [startAfterEula, setStartAfterEula] = useState(false);

  useEffect(() => {
    if (settings?.pinRecoveryEmail !== undefined) {
      setRecoveryEmail(settings.pinRecoveryEmail || "");
    }
  }, [settings?.pinRecoveryEmail]);

  if (authStatus.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (authStatus.data && !isAuthenticated) {
    return <PinEntry onSuccess={() => void authStatus.refetch()} />;
  }

  const settingLabels: Record<string, string> = {
    aiShieldEnabled: "AI Shield",
    firewallEnabled: "Firewall protection",
    alwaysOnEnabled: "Always-on protection",
    deviceAdminEnabled: "Device administrator access",
    isPinEnabled: "PIN protection",
  };

  const handleToggle = (key: string, checked: boolean) => {
    const label = settingLabels[key] || "Setting";
    if (key === "isPinEnabled" && checked && !settings?.pinConfigured) {
      toast({
        title: "Set a PIN first",
        description: "Create a four-digit PIN before enabling PIN protection.",
        variant: "destructive",
      });
      return;
    }
    updateSettings.mutate(
      { [key]: checked },
      {
        onSuccess: () => {
          toast({
            title: `${label} ${checked ? "enabled" : "disabled"}`,
            description: checked
              ? `${label} is now active.`
              : `${label} is now turned off.`,
          });
        },
        onError: (error) => {
          toast({
            title: `${label} could not be changed`,
            description: error instanceof Error ? error.message : "Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleSetPin = () => {
    if (pin.length === 4) {
      updateSettings.mutate(
        { pinCode: pin, isPinEnabled: true },
        {
          onSuccess: () => {
            setPin("");
            toast({
              title: "PIN updated",
              description: "PIN protection is enabled with your new code.",
            });
          },
          onError: (error) => {
            toast({
              title: "PIN could not be updated",
              description: error instanceof Error ? error.message : "Please try again.",
              variant: "destructive",
            });
          },
        },
      );
    }
  };

  const handleSaveRecoveryEmail = () => {
    const email = recoveryEmail.trim();
    if (!email || !email.includes("@")) {
      toast({
        title: "Recovery email required",
        description: "Enter a valid email address so you can recover access if the PIN is forgotten.",
        variant: "destructive",
      });
      return;
    }
    updateSettings.mutate(
      { pinRecoveryEmail: email },
      {
        onSuccess: () => toast({
          title: "Recovery email saved",
          description: "SafeNet can now send PIN recovery codes to this address.",
        }),
        onError: (error) => toast({
          title: "Recovery email could not be saved",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        }),
      },
    );
  };

  const activeDnsServer = dnsServers?.find((server) => server.isActive);
  const startVpn = async () => {
    if (!activeDnsServer) {
      toast({
        title: "Select a DNS server first",
        description: "Choose an active resolver in DNS Servers before enabling protection.",
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
      <div className="relative">
        <Header
          title="System Settings"
          subtitle="Configuration & Security"
        />
        <div
          className="pointer-events-none absolute right-0 top-0 hidden h-14 w-[220px] items-center justify-end overflow-hidden sm:flex"
          aria-label="SafeNet Inc. brand"
        >
          <img
            src={wordmarkImage}
            alt="SafeNet Inc."
            className="h-full w-full object-contain object-right"
          />
        </div>
      </div>

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
              <p className="text-xs text-muted-foreground max-w-[200px]">Server-side DNS threat labels only; camera and screen analysis is Android-only</p>
            </div>
            <Switch 
              checked={settings?.aiShieldEnabled ?? false} 
              onCheckedChange={(c) => handleToggle("aiShieldEnabled", c)}
               disabled={updateSettings.isPending}
              aria-label="AI Shield"
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
               disabled={updateSettings.isPending}
              aria-label="App Firewall"
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
               disabled={updateSettings.isPending}
              aria-label="Always-On VPN"
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
               disabled={updateSettings.isPending}
              aria-label="Device Admin"
            />
          </div>
        </CyberCard>

        {vpn.supported ? (
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
                  {vpn.status?.error
                    ? "DNS protection stopped"
                    : vpn.status?.running
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
                <>
                  <p role="alert" className="mt-2 text-xs text-destructive">{vpn.status.error}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Turn the switch on to reconnect DNS protection.
                  </p>
                </>
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
        ) : (
          <CyberCard
            className="md:col-span-2 space-y-5 border-muted-foreground/20 opacity-80"
            aria-disabled="true"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-6 h-6 text-muted-foreground" />
                <div>
                  <h2 className="text-xl font-display font-bold text-muted-foreground">
                    DNS Protection VPN
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Android-only device protection
                  </p>
                </div>
              </div>
              <Switch
                checked={false}
                disabled
                aria-label="DNS Protection VPN unavailable in web browser"
              />
            </div>

            <div className="rounded-md border border-muted-foreground/15 bg-muted/5 p-4 text-sm text-muted-foreground">
              <p className="font-medium">Available in the SafeNet Android APK</p>
              <p className="mt-2 text-xs">
                The APK can create and control the device VPN needed to route DNS
                requests through your active SafeNet resolver. Web browsers cannot
                activate an Android VPN service.
              </p>
            </div>
          </CyberCard>
        )}

        <div className="md:col-span-2">
          <AiShieldControls />
        </div>

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
                disabled={updateSettings.isPending || (!settings?.pinConfigured && !(settings?.isPinEnabled ?? false))}
                aria-label="PIN Protection"
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

          <div className="space-y-2 border-t border-white/10 pt-5">
            <Label htmlFor="pin-recovery-email">PIN Recovery Email</Label>
            <p className="text-xs text-muted-foreground">
              Saving this address only sets the destination. To generate a code,
              choose “Forgot PIN?” on the access screen and select “Send recovery
              code”. SafeNet never displays or emails the PIN itself.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="pin-recovery-email"
                type="email"
                value={recoveryEmail}
                onChange={(event) => setRecoveryEmail(event.target.value)}
                placeholder="you@example.com"
                className="bg-background border-border"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveRecoveryEmail}
                disabled={updateSettings.isPending || !recoveryEmail.trim()}
              >
                Save recovery email
              </Button>
            </div>
          </div>
        </CyberCard>
        
        <div className="md:col-span-2 flex items-center justify-center p-4 rounded border border-yellow-500/20 bg-yellow-500/5 text-yellow-500 text-sm gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-mono uppercase">
            SafeNet DNS Server (Official) v{import.meta.env.VITE_APP_VERSION}
          </span>
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
