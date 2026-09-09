import { useAuth } from "@clerk/react";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { AiShieldControls } from "@/components/AiShieldControls";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Shield, Smartphone, Activity, Eye, Zap, AlertTriangle, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import wordmarkImage from "@/assets/safenet-inc-logo.svg";
import { useSafeNetVpn } from "@/hooks/use-vpn";

export default function Settings() {
  const { isSignedIn } = useAuth();
  const isAuthenticated = isSignedIn === true;
  const {
    data: settings,
    isLoading: isLoadingSettings,
    isError: isSettingsError,
  } = useSettings(isAuthenticated);
  const updateSettings = useUpdateSettings();
  const androidSettings = useSafeNetVpn();
  const { toast } = useToast();
  const settingsReady = settings !== undefined && !isLoadingSettings;
  const appVersion = import.meta.env.VITE_APP_VERSION;

  const openAndroidSettings = async (
    target: "vpn",
    label: string,
  ) => {
    try {
      await androidSettings.openSystemSettings(target);
    } catch (error) {
      toast({
        title: `${label} could not be opened`,
        description: error instanceof Error ? error.message : "Open Android Settings manually and try again.",
        variant: "destructive",
      });
    }
  };

  const settingLabels: Record<string, string> = {
    aiShieldEnabled: "AI Shield",
    firewallEnabled: "Firewall protection",
    alwaysOnEnabled: "Always-on protection",
  };

  const handleToggle = (key: string, checked: boolean) => {
    if (!settingsReady) {
      return;
    }
    const label = settingLabels[key] || "Setting";
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
              <p className="text-xs text-muted-foreground max-w-[200px]">Server-side DNS threat labels; camera and screen analysis is a separate Android-only control below.</p>
            </div>
            <Switch 
              checked={settings?.aiShieldEnabled ?? false} 
              onCheckedChange={(c) => handleToggle("aiShieldEnabled", c)}
                disabled={!settingsReady || updateSettings.isPending}
              aria-label="AI Shield"
                data-testid="switch-ai-shield"
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded bg-white/5 border border-white/5 hover:border-primary/30 transition-colors">
            <div className="space-y-1">
              <Label className="text-base text-white font-medium flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> App Firewall
              </Label>
              <p className="text-xs text-muted-foreground">Sync DNS firewall rules to the Android VPN when protection is running.</p>
            </div>
            <Switch 
              checked={settings?.firewallEnabled ?? false} 
              onCheckedChange={(c) => handleToggle("firewallEnabled", c)}
                disabled={!settingsReady || updateSettings.isPending}
              aria-label="App Firewall"
                data-testid="switch-app-firewall"
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
                Saves the preference and opens Android&apos;s Always-on VPN settings for the actual device control.
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Switch
                checked={settings?.alwaysOnEnabled ?? false}
                onCheckedChange={(c) => handleToggle("alwaysOnEnabled", c)}
                disabled={!settingsReady || updateSettings.isPending}
                aria-label="Always-On VPN preference"
                data-testid="switch-always-on-vpn"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void openAndroidSettings("vpn", "Always-on VPN settings")}
                disabled={!androidSettings.supported}
                data-testid="button-open-vpn-settings"
              >
                Open Android VPN settings
              </Button>
            </div>
          </div>

        </CyberCard>

        <div className="md:col-span-2">
          <AiShieldControls />
        </div>

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
