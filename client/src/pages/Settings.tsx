import { useAuthStatus, useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { AiShieldControls } from "@/components/AiShieldControls";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Shield, Smartphone, Lock, Activity, Eye, Zap, AlertTriangle, Loader2 } from "lucide-react";
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
  const {
    data: settings,
    isLoading: isLoadingSettings,
    isError: isSettingsError,
  } = useSettings(isAuthenticated);
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const [pin, setPin] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const settingsReady = settings !== undefined && !isLoadingSettings;
  const appVersion = import.meta.env.VITE_APP_VERSION;

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
    if (!settingsReady) {
      return;
    }
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
    if (settingsReady && pin.length === 4) {
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

      {isSettingsError && (
        <div role="alert" className="rounded border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Saved settings could not be loaded. Controls are disabled until SafeNet can confirm the current values.
        </div>
      )}
      {isLoadingSettings && (
        <div role="status" className="rounded border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
          Loading saved settings…
        </div>
      )}

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
                disabled={!settingsReady || updateSettings.isPending}
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
                disabled={!settingsReady || updateSettings.isPending}
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
              <p className="text-xs text-muted-foreground">
                Saved as a preference; configure Android&apos;s system Always-on VPN separately
              </p>
            </div>
            <Switch 
              checked={settings?.alwaysOnEnabled ?? false} 
              onCheckedChange={(c) => handleToggle("alwaysOnEnabled", c)}
                disabled={!settingsReady || updateSettings.isPending}
              aria-label="Always-On VPN"
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded bg-white/5 border border-white/5 hover:border-primary/30 transition-colors">
            <div className="space-y-1">
              <Label className="text-base text-white font-medium flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" /> Device Admin
              </Label>
              <p className="text-xs text-muted-foreground">
                Saved as a preference; Android device-admin permission is not requested here
              </p>
            </div>
            <Switch 
              checked={settings?.deviceAdminEnabled ?? false} 
              onCheckedChange={(c) => handleToggle("deviceAdminEnabled", c)}
                disabled={!settingsReady || updateSettings.isPending}
              aria-label="Device Admin"
            />
          </div>
        </CyberCard>

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
                disabled={!settingsReady || updateSettings.isPending || (!settings?.pinConfigured && !(settings?.isPinEnabled ?? false))}
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
                  disabled={!settingsReady || updateSettings.isPending}
                  className="bg-background border-border font-mono tracking-widest text-center"
                />
                <Button 
                  onClick={handleSetPin}
                  disabled={!settingsReady || updateSettings.isPending || pin.length !== 4}
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
                disabled={!settingsReady || updateSettings.isPending}
                className="bg-background border-border"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveRecoveryEmail}
                disabled={!settingsReady || updateSettings.isPending || !recoveryEmail.trim()}
              >
                Save recovery email
              </Button>
            </div>
          </div>
        </CyberCard>
        
        <div className="md:col-span-2 space-y-4 rounded border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm">
          <div className="flex items-center justify-center gap-2 text-yellow-500">
            <AlertTriangle className="w-4 h-4" />
              <span className="font-mono uppercase" data-testid="settings-version">
                SafeNet Shield DNS Server+ (Official) v{appVersion}
            </span>
          </div>
          <div className="flex flex-col items-center justify-center gap-3 border-t border-yellow-500/10 pt-4 text-center sm:flex-row sm:gap-5">
            <a
              href="mailto:Post@SafeNetInc.Ca"
              className="text-white underline-offset-4 hover:underline"
            >
              Contact Us: Post@SafeNetInc.Ca
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
