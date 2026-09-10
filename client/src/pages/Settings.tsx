import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { AiShieldControls } from "@/components/AiShieldControls";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Shield, AlertTriangle, LockKeyhole } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import wordmarkImage from "@/assets/safenet-inc-logo.svg";

export default function Settings() {
  const {
    data: settings,
    isLoading: isLoadingSettings,
    isError: isSettingsError,
  } = useSettings();
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const settingsReady = settings !== undefined && !isLoadingSettings;
  const appVersion = import.meta.env.VITE_APP_VERSION;

  const settingLabels: Record<string, string> = {
    preventDnsOverrides: "Prevent DNS Overrides",
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
      <Header
        title="System Settings"
        subtitle="Configuration & Security"
      />

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
                <LockKeyhole className="w-4 h-4 text-primary" /> Prevent DNS Overrides
              </Label>
              <p className="text-xs text-muted-foreground">
                Keep DNS requests on SafeNet&apos;s protected resolver path so apps cannot silently switch to another resolver.
              </p>
            </div>
            <Switch
              checked={settings?.preventDnsOverrides ?? true}
              onCheckedChange={(c) => handleToggle("preventDnsOverrides", c)}
                disabled={!settingsReady || updateSettings.isPending}
              aria-label="Prevent DNS Overrides"
                data-testid="switch-prevent-dns-overrides"
            />
          </div>
        </CyberCard>

        <div className="md:col-span-2">
          <AiShieldControls />
        </div>

        <div className="md:col-span-2 space-y-4 rounded border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm">
          <div className="flex items-center justify-center gap-2 text-yellow-500">
            <AlertTriangle className="w-4 h-4" />
              <span className="font-mono uppercase" data-testid="settings-version">
                SafeNet Shield DNS v{appVersion}
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
          <div className="flex items-center justify-center border-t border-yellow-500/10 pt-4">
            <img
              src={wordmarkImage}
              alt="SafeNet Inc."
              className="h-12 w-[220px] object-contain"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
