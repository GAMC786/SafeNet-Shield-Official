import { ArrowRight, Globe2, LockKeyhole, ShieldCheck, Smartphone } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface WireGuardInfographicProps {
  supported: boolean;
  configured: boolean;
  running: boolean;
  disabled: boolean;
  gateway?: string;
  dnsServers?: string;
  onToggle: (checked: boolean) => void;
}

export function WireGuardInfographic({
  supported,
  configured,
  running,
  disabled,
  gateway,
  dnsServers,
  onToggle,
}: WireGuardInfographicProps) {
  return (
    <div className="space-y-4" data-testid="dashboard-wireguard-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
              running
                ? "border-emerald-400/40 bg-emerald-400/10"
                : "border-primary/30 bg-primary/10"
            }`}
          >
            <ShieldCheck className={`h-6 w-6 ${running ? "text-emerald-300" : "text-primary"}`} />
          </div>
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-primary">
              Official WireGuard tunnel
            </p>
            <h3 className="mt-1 text-lg font-bold text-white">SafeNet WireGuard</h3>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              {!supported
                ? "Available in the SafeNet Android APK through the official WireGuard tunnel library."
                : running
                ? "Encrypted device traffic is connected through the SafeNet gateway."
                : configured
                  ? "Connect the official Android tunnel when you need a full-device VPN path."
                  : "This release is waiting for a signed SafeNet WireGuard configuration."}
            </p>
          </div>
        </div>
        <Switch
          checked={running}
          onCheckedChange={onToggle}
          disabled={disabled || !configured || !supported}
          aria-label="SafeNet WireGuard On/Off"
          data-testid="switch-wireguard"
        />
      </div>

      <div
        className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background/40 to-transparent p-4"
        role="img"
        aria-label="WireGuard encrypted path from this device through the SafeNet gateway to the internet"
      >
        <div className="mb-3 flex items-center justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
          <span>Encrypted device path</span>
          <span className={running ? "text-emerald-300" : "text-muted-foreground"}>
            {running ? "Tunnel active" : "Tunnel offline"}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2">
          <div className="flex min-h-20 flex-col items-center justify-center rounded-lg border border-white/10 bg-background/50 px-2 py-3 text-center">
            <Smartphone className="mb-2 h-5 w-5 text-primary" />
            <span className="text-xs font-semibold text-foreground">This device</span>
            <span className="mt-1 text-[10px] text-muted-foreground">Android VPN</span>
          </div>
          <ArrowRight className={`h-4 w-4 ${running ? "text-emerald-300" : "text-primary/50"}`} />
          <div className="relative flex min-h-20 flex-col items-center justify-center rounded-lg border border-primary/30 bg-primary/10 px-2 py-3 text-center">
            <LockKeyhole className={`mb-2 h-5 w-5 ${running ? "text-emerald-300" : "text-primary"}`} />
            <span className="text-xs font-semibold text-foreground">WireGuard</span>
            <span className="mt-1 text-[10px] text-muted-foreground">Official tunnel</span>
          </div>
          <ArrowRight className={`h-4 w-4 ${running ? "text-emerald-300" : "text-primary/50"}`} />
          <div className="flex min-h-20 flex-col items-center justify-center rounded-lg border border-white/10 bg-background/50 px-2 py-3 text-center">
            <Globe2 className="mb-2 h-5 w-5 text-primary" />
            <span className="text-xs font-semibold text-foreground">SafeNet gateway</span>
            <span className="mt-1 max-w-full truncate text-[10px] text-muted-foreground">
              {gateway || "Not configured"}
            </span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
          <span>Android Tunnel Library</span>
          <span>Single VPN owner</span>
          <span>DNS: {dnsServers || "selected resolver"}</span>
        </div>
      </div>
    </div>
  );
}