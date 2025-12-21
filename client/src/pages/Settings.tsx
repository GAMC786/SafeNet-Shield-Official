import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Shield, Smartphone, Lock, Activity, Eye, Zap, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function Settings() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const [pin, setPin] = useState("");

  const handleToggle = (key: string, checked: boolean) => {
    updateSettings.mutate({ [key]: checked });
  };

  const handleSetPin = () => {
    if (pin.length === 4) {
      updateSettings.mutate({ pinCode: pin, isPinEnabled: true });
      setPin("");
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
          <span className="font-mono uppercase">SafeNet DNS Server (Official) v1.0.4 - Build 2024.10.25</span>
        </div>
      </div>
    </div>
  );
}
