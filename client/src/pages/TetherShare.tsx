import { useTetherShare } from "@/hooks/use-tether-share";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe2,
  LockKeyhole,
  Router,
  Share2,
  Smartphone,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left transition-colors hover:border-primary/40"
      onClick={async () => {
        await navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
      aria-label={`Copy ${label}`}
    >
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="block truncate font-mono text-sm text-white">{value}</span>
      </span>
      {copied ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> : <Copy className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />}
    </button>
  );
}

export default function TetherShare() {
  const { supported, status, isBusy, start, stop, openWifiSettings } = useTetherShare();
  const { toast } = useToast();
  const running = status?.running === true;
  const starting = status?.starting === true || isBusy;
  const handleToggle = async () => {
    if (!supported) {
      toast({
        title: "Android device required",
        description: "Internet Share uses Android Wi-Fi Direct and can be started from the SafeNet Android APK.",
      });
      return;
    }
    try {
      await (running ? stop() : start());
    } catch (error) {
      toast({
        title: "Internet Share could not be changed",
        description: error instanceof Error ? error.message : "Android could not change the sharing state.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <Header
        title="Internet Share"
        subtitle="No-root Wi-Fi Direct gateway"
        status={running ? "active" : status?.lastError ? "warning" : "inactive"}
      />

      {!supported && (
        <CyberCard className="border-yellow-500/20 bg-yellow-500/5">
          <div className="flex items-start gap-3">
            <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-yellow-300" />
            <div>
              <h2 className="font-semibold text-white">Available in the SafeNet Android APK</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Internet Share uses Android Wi-Fi Direct and cannot be started from a desktop browser.
              </p>
            </div>
          </div>
        </CyberCard>
      )}

      {supported && status?.lastError && (
        <CyberCard className="border-destructive/30 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <h2 className="font-semibold text-white">Internet Share needs attention</h2>
              <p className="mt-1 text-sm text-destructive" role="alert">{status.lastError}</p>
            </div>
          </div>
        </CyberCard>
      )}

      <CyberCard glow className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-transparent to-transparent">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border ${running ? "border-emerald-400/40 bg-emerald-400/10" : "border-primary/30 bg-primary/10"}`}>
              {running ? <Router className="h-8 w-8 text-emerald-300" /> : <Share2 className="h-8 w-8 text-primary" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-display font-bold text-white">Share this connection</h2>
                {running && <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">Broadcasting</span>}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Create a private Wi-Fi Direct network for nearby devices without root. SafeNet runs a local HTTP proxy so connected devices can use this phone&apos;s Wi-Fi or mobile connection.
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="lg"
            variant={running ? "destructive" : "default"}
            disabled={starting}
            onClick={() => void handleToggle()}
            data-testid="button-tether-toggle"
          >
            {starting ? "Starting…" : running ? <><Square className="mr-2 h-4 w-4 fill-current" /> Stop sharing</> : <><Share2 className="mr-2 h-4 w-4" /> Start sharing</>}
          </Button>
        </div>
      </CyberCard>

      {running && status && (
        <div className="grid gap-4 md:grid-cols-2">
          <CyberCard className="space-y-4">
            <div className="flex items-center gap-2">
              <Wifi className="h-5 w-5 text-primary" />
              <h3 className="font-display text-lg font-bold text-white">Connect to the network</h3>
            </div>
            <div className="space-y-2">
              <CopyValue value={status.networkName || "SafeNet-Share"} label="Wi-Fi Direct network" />
              <CopyValue value={status.passphrase || "Displayed by Android"} label="Passphrase" />
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={() => void openWifiSettings()}>
              <ExternalLink className="mr-2 h-4 w-4" /> Open Android Wi-Fi settings
            </Button>
          </CyberCard>

          <CyberCard className="space-y-4">
            <div className="flex items-center gap-2">
              <Globe2 className="h-5 w-5 text-sky-300" />
              <h3 className="font-display text-lg font-bold text-white">Proxy settings</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              On each connected device, choose manual proxy settings for this network.
            </p>
            <div className="space-y-2">
              <CopyValue value={status.proxyHost || "192.168.49.1"} label="Proxy host" />
              <CopyValue value={String(status.proxyPort || 8080)} label="Proxy port" />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              HTTPS uses the standard CONNECT tunnel. SafeNet does not inspect encrypted page contents.
            </p>
          </CyberCard>
        </div>
      )}

      <CyberCard className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            <h3 className="font-display text-lg font-bold text-white">Connected devices</h3>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-muted-foreground">
            {status?.connectedDevices.length || 0} connected
          </span>
        </div>
        {status?.connectedDevices.length ? (
          <div className="space-y-2">
            {status.connectedDevices.map((device) => (
              <div key={device.address} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-3">
                <span className="font-medium text-white">{device.name || "Connected device"}</span>
                <span className="font-mono text-xs text-muted-foreground">{device.address}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center">
            <LockKeyhole className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {running ? "Start by joining the SafeNet-Share network from another device." : "Start Internet Share to create a private device network."}
            </p>
          </div>
        )}
      </CyberCard>

      <CyberCard className="border-white/10 bg-white/[0.03]">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-300" />
          <div className="space-y-2 text-sm text-muted-foreground">
            <h3 className="font-semibold text-white">Use it responsibly</h3>
            <p>
              This feature shares the phone&apos;s existing internet connection. Carrier data limits and hotspot policies still apply. Stop sharing when you are finished.
            </p>
            <p>
              Internet Share is separate from SafeNet&apos;s VPN tunnel. Keep SafeNet protection enabled when you want DNS filtering on the phone itself.
            </p>
          </div>
        </div>
      </CyberCard>
    </div>
  );
}