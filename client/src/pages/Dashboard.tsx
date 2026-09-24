import { useStats, useLogs } from "@/hooks/use-logs";
import { useDnsServers } from "@/hooks/use-dns";
import { useSettings } from "@/hooks/use-settings";
import { useAntivirusSettings } from "@/hooks/use-antivirus";
import { useClamAvStatus } from "@/hooks/use-clamav";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { TailscaleEulaDialog } from "@/components/TailscaleEulaDialog";
import { Activity, Shield, AlertTriangle, Server, CheckCircle2, Gauge, Radio, Music, LockKeyhole, ExternalLink, RefreshCw } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useSoundtrack } from "@/hooks/use-soundtrack";
import { useAppLock } from "@/hooks/use-app-lock";
import { useTailscaleNative, useTailscaleStatus } from "@/hooks/use-tailscale";
import {
  usePrivateDns,
} from "@/hooks/use-private-dns";
import { isProtectionActive } from "@/lib/protection-status";

const TAILSCALE_EULA_VERSION = "2.0";
const TAILSCALE_EULA_STORAGE_KEY = "safenet-tailscale-eula-version";

function hasAcceptedTailscaleEula() {
  try {
    return window.localStorage.getItem(TAILSCALE_EULA_STORAGE_KEY) === TAILSCALE_EULA_VERSION;
  } catch {
    return false;
  }
}

export default function Dashboard() {
  const statsQuery = useStats();
  const logsQuery = useLogs();
  const { data: stats } = statsQuery;
  const { data: logs } = logsQuery;
  const { data: dnsServers } = useDnsServers();
  const { data: settings } = useSettings();
  const { data: antivirusSettings } = useAntivirusSettings();
  const clamAv = useClamAvStatus();
  const soundtrack = useSoundtrack();
  const appLock = useAppLock();
  const tailscale = useTailscaleStatus();
  const tailscaleVpn = useTailscaleNative();
  const [tailscaleEulaOpen, setTailscaleEulaOpen] = useState(false);
  const [tailscaleEulaAccepted, setTailscaleEulaAccepted] = useState(hasAcceptedTailscaleEula);
  const [pendingTailscaleAction, setPendingTailscaleAction] = useState<"connect" | "admin" | null>(null);
  const [tailscaleActionError, setTailscaleActionError] = useState<string | null>(null);
  const [tailscaleActionPending, setTailscaleActionPending] = useState(false);
  const tailscaleDashboardUrl = tailscale.data?.dashboardUrl ?? "https://login.tailscale.com/admin/machines";
  const activeDns = dnsServers?.find(s => s.isActive);
  const privateDns = usePrivateDns(activeDns);
  const isServerAvailable = !statsQuery.isError && !logsQuery.isError;
  const isProtected = isProtectionActive({
    platform: privateDns.supported ? "android" : "web",
    serverAvailable: isServerAvailable,
    privateDnsRunning: privateDns.status?.running === true,
    firewallEnabled: settings?.firewallEnabled === true,
    antivirusEnabled: antivirusSettings?.isEnabled === true,
    antivirusVerified: clamAv.data?.verified === true,
  });
  const appLockStateLabel = !appLock.supported
    ? "ANDROID ONLY"
    : appLock.status.enabled
      ? "ACTIVE"
      : "STANDBY";
  const appLockStateClass = !appLock.supported
    ? "border-primary/30 bg-primary/10 text-primary"
    : appLock.status.enabled
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
      : "border-white/15 bg-white/5 text-muted-foreground";
  const tailscaleStatusLabel = tailscale.isLoading
    ? "Checking"
    : tailscale.data?.status === "online"
      ? "Online"
      : tailscale.data?.status === "unavailable"
        ? "Unavailable"
        : "Not configured";
  const tailscaleStatusClass = tailscale.data?.status === "online"
    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
    : tailscale.data?.status === "unavailable"
      ? "border-red-400/40 bg-red-400/10 text-red-300"
      : "border-white/15 bg-white/5 text-muted-foreground";
  const tailscaleDeviceStatusLabel = !tailscaleVpn.isAndroid
    ? "Android only"
    : tailscaleVpn.isLoading
      ? "Checking"
      : tailscaleVpn.status?.supported === false
        ? "Android 8+ required"
        : tailscaleVpn.error || tailscaleVpn.status?.error
          ? "Unavailable"
          : tailscaleVpn.status?.connected
            ? "Connected"
            : tailscaleVpn.status?.loginRequired
              ? "Login required"
              : "Disconnected";
  const tailscaleDeviceStatusClass = tailscaleVpn.status?.connected
    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
    : tailscaleDeviceStatusLabel === "Unavailable"
      ? "border-red-400/40 bg-red-400/10 text-red-300"
      : "border-white/15 bg-white/5 text-muted-foreground";
  
  const allowedQueries = Math.max((stats?.totalQueries ?? 0) - (stats?.blockedQueries ?? 0), 0);
  const blockRate = stats?.totalQueries
    ? Math.round((stats.blockedQueries / stats.totalQueries) * 100)
    : 0;
  const chartData = useMemo(() => {
    const recentLogs = [...(logs ?? [])].slice(0, 24).reverse();
    if (recentLogs.length === 0) {
      return stats
        ? [{ name: "Now", allowed: allowedQueries, blocked: stats.blockedQueries }]
        : [];
    }

    const bucketSize = Math.max(1, Math.ceil(recentLogs.length / 8));
    return Array.from({ length: Math.ceil(recentLogs.length / bucketSize) }, (_, bucketIndex) => {
      const bucket = recentLogs.slice(bucketIndex * bucketSize, (bucketIndex + 1) * bucketSize);
      const lastLog = bucket[bucket.length - 1];
      return {
        name: new Date(lastLog.timestamp || Date.now()).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        allowed: bucket.filter((log) => log.status !== "blocked").length,
        blocked: bucket.filter((log) => log.status === "blocked").length,
      };
    });
  }, [allowedQueries, logs, stats]);
  const isLive = statsQuery.isFetching || logsQuery.isFetching;

  const runTailscaleConnect = async () => {
    setTailscaleActionError(null);
    setTailscaleActionPending(true);
    try {
      const result = await tailscaleVpn.connect();
      if (result.error) setTailscaleActionError(result.error);
    } catch (error) {
      setTailscaleActionError(error instanceof Error ? error.message : "Could not connect to Tailscale.");
    } finally {
      setTailscaleActionPending(false);
    }
  };

  const runTailscaleDisconnect = async () => {
    setTailscaleActionError(null);
    setTailscaleActionPending(true);
    try {
      const result = await tailscaleVpn.disconnect();
      if (result.error) setTailscaleActionError(result.error);
    } catch (error) {
      setTailscaleActionError(error instanceof Error ? error.message : "Could not disconnect from Tailscale.");
    } finally {
      setTailscaleActionPending(false);
    }
  };

  const updateTailscaleOptions = async (
    options: Parameters<typeof tailscaleVpn.setOptions>[0],
  ) => {
    setTailscaleActionError(null);
    setTailscaleActionPending(true);
    try {
      const result = await tailscaleVpn.setOptions(options);
      if (result.error) setTailscaleActionError(result.error);
    } catch (error) {
      setTailscaleActionError(error instanceof Error ? error.message : "Could not update Tailscale options.");
    } finally {
      setTailscaleActionPending(false);
    }
  };

  const openTailscaleDashboard = () => {
    if (tailscaleDashboardUrl) {
      if (!tailscaleEulaAccepted) {
        setPendingTailscaleAction("admin");
        setTailscaleEulaOpen(true);
        return;
      }
      window.open(tailscaleDashboardUrl, "_blank", "noopener,noreferrer");
      return;
    }
    void tailscale.refetch();
  };

  const requestTailscaleConnect = () => {
    if (!tailscaleEulaAccepted) {
      setPendingTailscaleAction("connect");
      setTailscaleEulaOpen(true);
      return;
    }
    if (tailscaleVpn.status?.loginRequired && tailscaleVpn.status.authUrl) {
      setTailscaleActionError(null);
      void tailscaleVpn.openLoginUrl(tailscaleVpn.status.authUrl).catch((error) => {
        setTailscaleActionError(error instanceof Error ? error.message : "Could not open Tailscale sign-in.");
      });
      return;
    }
    void runTailscaleConnect();
  };

  const acceptTailscaleEula = () => {
    try {
      window.localStorage.setItem(TAILSCALE_EULA_STORAGE_KEY, TAILSCALE_EULA_VERSION);
    } catch {
      // Keep this acceptance for the current page session if storage is unavailable.
    }
    setTailscaleEulaAccepted(true);
    setTailscaleEulaOpen(false);
    const action = pendingTailscaleAction;
    setPendingTailscaleAction(null);
    if (action === "connect") {
      void runTailscaleConnect();
    } else if (action === "admin" && tailscaleDashboardUrl) {
      window.open(tailscaleDashboardUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <Header 
        title="Command Center" 
        subtitle={isServerAvailable ? "System Status: Online" : "Server connection unavailable"}
        status={isProtected ? "active" : "unprotected"}
      />

      <div className="grid grid-cols-1 gap-4">
        <CyberCard className="flex min-h-[104px] w-full items-center">
          <div className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-background/30 px-3 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Music className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Soundtrack</p>
                <p className="text-xs text-muted-foreground">Keep SafeNet soundtrack enabled</p>
              </div>
            </div>
            <Switch
              checked={soundtrack.enabled}
              onCheckedChange={soundtrack.setEnabled}
              aria-label={`Soundtrack ${soundtrack.enabled ? "On" : "Off"}`}
              data-testid="switch-soundtrack"
            />
          </div>
        </CyberCard>

        <CyberCard className="flex min-h-[104px] w-full items-center">
          <div className="w-full space-y-4 rounded-lg border border-white/10 bg-background/30 px-3 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Radio className="h-4 w-4 shrink-0 text-primary" />
                    <p className="min-w-0 text-sm font-medium text-foreground">Tailscale Mesh VPN with WireGuard</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => {
                      void tailscale.refetch();
                      if (tailscaleVpn.isAndroid) void tailscaleVpn.refetch();
                    }}
                    disabled={tailscale.isFetching || tailscaleVpn.isFetching}
                    aria-label="Refresh Tailscale status"
                    data-testid="button-refresh-tailscale"
                  >
                    <RefreshCw className={`h-4 w-4 ${tailscale.isFetching || tailscaleVpn.isFetching ? "animate-spin" : ""}`} />
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tailscale.data?.message ?? "Tailscale control-plane status is unavailable"}
                </p>
                {tailscale.data?.deviceCount !== null && tailscale.data?.deviceCount !== undefined && (
                  <p className="mt-1 text-[11px] font-mono text-muted-foreground/80">
                    {tailscale.data.deviceCount} registered device{tailscale.data.deviceCount === 1 ? "" : "s"}
                  </p>
                )}
                {tailscaleVpn.status?.selfName && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    This device: {tailscaleVpn.status.selfName}
                    {tailscaleVpn.status.tailnetName ? ` · ${tailscaleVpn.status.tailnetName}` : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-1 lg:shrink-0 lg:justify-end sm:gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-0.5 sm:gap-1.5">
                  <Badge
                    variant="outline"
                    className={`gap-0.5 px-1 text-[9px] font-bold uppercase tracking-normal sm:gap-1.5 sm:px-2 sm:text-[10px] sm:tracking-wider ${tailscaleStatusClass}`}
                    data-testid="tailscale-control-plane-status"
                    aria-label={`Control plane: ${tailscaleStatusLabel}`}
                  >
                    <span className="sr-only">Control plane:</span>
                    <span className="max-[359px]:hidden sm:hidden" aria-hidden="true">Ctrl:</span>
                    <span className="hidden sm:inline" aria-hidden="true">Control plane:</span>
                    {tailscaleStatusLabel}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`gap-0.5 px-1 text-[9px] font-bold uppercase tracking-normal sm:gap-1.5 sm:px-2 sm:text-[10px] sm:tracking-wider ${tailscaleDeviceStatusClass}`}
                    data-testid="tailscale-device-status"
                    aria-label={`Device: ${tailscaleDeviceStatusLabel}`}
                  >
                    <span className="sr-only">Device:</span>
                    <span className="max-[359px]:hidden sm:hidden" aria-hidden="true">VPN:</span>
                    <span className="hidden sm:inline" aria-hidden="true">Device:</span>
                    {tailscaleDeviceStatusLabel}
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 whitespace-nowrap px-1 text-[9px] sm:px-3 sm:text-xs"
                  onClick={openTailscaleDashboard}
                  disabled={!tailscaleDashboardUrl}
                  data-testid="button-open-tailscale-dashboard"
                >
                  <ExternalLink className="mr-1 hidden h-3.5 w-3.5 sm:mr-2 sm:inline sm:h-4 sm:w-4" />
                  Open Tailscale Admin
                </Button>
              </div>
            </div>

            {tailscaleVpn.isAndroid ? (
              <div className="space-y-3 border-t border-white/10 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">This device’s VPN connection</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Android will ask before SafeNet creates a VPN connection. Tailscale device status is separate from the control-plane check above.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!tailscaleVpn.status?.connected && tailscaleVpn.status?.loginRequired && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={requestTailscaleConnect}
                        disabled={!tailscaleVpn.status?.supported || tailscaleActionPending}
                        data-testid="button-tailscale-connect"
                      >
                        {tailscaleActionPending ? "Working…" : "Continue sign-in"}
                      </Button>
                    )}
                    <Switch
                      checked={tailscaleVpn.status?.connected === true}
                      onCheckedChange={(enabled) => {
                        if (enabled) {
                          requestTailscaleConnect();
                        } else {
                          void runTailscaleDisconnect();
                        }
                      }}
                      disabled={
                        !tailscaleVpn.status?.supported
                        || tailscaleActionPending
                        || (!tailscaleVpn.status?.connected && tailscaleVpn.status?.loginRequired === true)
                      }
                      aria-label={`Tailscale device VPN ${tailscaleDeviceStatusLabel}`}
                      data-testid="switch-tailscale-device-vpn"
                    />
                  </div>
                </div>

                {(tailscaleActionError || tailscaleVpn.status?.error) && (
                  <p className="text-xs text-red-300" role="alert" data-testid="tailscale-action-error">
                    {tailscaleActionError ?? tailscaleVpn.status?.error}
                  </p>
                )}

                {tailscaleVpn.status?.supported && (
                  <details className="rounded-md border border-white/10 px-3 py-2" data-testid="tailscale-vpn-options">
                    <summary className="cursor-pointer text-xs font-medium text-foreground">
                      VPN options
                    </summary>
                    <div className="mt-3 space-y-3">
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        Exit node
                        <select
                          className="rounded-md border border-white/15 bg-background px-2 py-2 text-sm text-foreground"
                          aria-label="Tailscale exit node"
                          value={tailscaleVpn.status.selectedExitNodeId ?? ""}
                          disabled={tailscaleActionPending}
                          onChange={(event) =>
                            void updateTailscaleOptions({
                              exitNodeId: event.currentTarget.value || null,
                            })
                          }
                          data-testid="select-tailscale-exit-node"
                        >
                          <option value="">No exit node</option>
                          {(tailscaleVpn.status.exitNodes ?? []).map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.name || node.id}{node.online ? "" : " (offline)"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">Accept subnet routes</span>
                        <Switch
                          checked={tailscaleVpn.status.acceptRoutes}
                          disabled={tailscaleActionPending}
                          onCheckedChange={(enabled) =>
                            void updateTailscaleOptions({ acceptRoutes: enabled })
                          }
                          aria-label="Accept Tailscale subnet routes"
                          data-testid="switch-tailscale-accept-routes"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">Use Tailscale DNS</span>
                        <Switch
                          checked={tailscaleVpn.status.useTailscaleDNS}
                          disabled={tailscaleActionPending}
                          onCheckedChange={(enabled) =>
                            void updateTailscaleOptions({ useTailscaleDNS: enabled })
                          }
                          aria-label="Use Tailscale DNS"
                          data-testid="switch-tailscale-dns"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">Allow local network access through exit node</span>
                        <Switch
                          checked={tailscaleVpn.status.allowLanAccess}
                          disabled={tailscaleActionPending || !tailscaleVpn.status.selectedExitNodeId}
                          onCheckedChange={(enabled) =>
                            void updateTailscaleOptions({ allowLanAccess: enabled })
                          }
                          aria-label="Allow local network access through Tailscale exit node"
                          data-testid="switch-tailscale-lan"
                        />
                      </div>
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  Device VPN controls are available in SafeNet for Android 8.0 and later.
                </p>
                <Switch
                  checked={tailscaleVpn.status?.connected === true}
                  disabled
                  aria-label={`Tailscale device VPN ${tailscaleDeviceStatusLabel}`}
                  data-testid="switch-tailscale-device-vpn"
                />
              </div>
            )}
          </div>
        </CyberCard>

        <TailscaleEulaDialog
          open={tailscaleEulaOpen}
          onOpenChange={setTailscaleEulaOpen}
          onAccept={acceptTailscaleEula}
          onCancel={() => setTailscaleEulaOpen(false)}
        />

      </div>

      {/* Connection Status Bar */}
      <CyberCard className="bg-gradient-to-r from-primary/5 to-transparent border-primary/20">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                <Server className="w-6 h-6 text-primary" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-background" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                 <p className="text-sm text-muted-foreground">Selected DNS Resolver</p>
                 <Badge
                   variant="outline"
                   className={activeDns
                     ? "border-emerald-400/40 bg-emerald-400/10 text-xs text-emerald-300"
                     : "border-primary/30 text-xs text-primary"}
                 >
                    {activeDns ? "DNS Resolver Active" : "Choose a DNS resolver"}
                </Badge>
              </div>
              <p className="text-lg font-mono font-bold text-white" data-testid="text-active-dns">
                {activeDns?.name || "No server configured"}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <p className="text-xs text-muted-foreground">Protocol</p>
            <Badge className="uppercase text-xs">
              {activeDns?.type || "N/A"}
            </Badge>
          </div>
        </div>
      </CyberCard>

      <CyberCard className="col-span-1 sm:col-span-2">
        <div className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-[0_0_18px_rgba(59,130,246,0.12)]">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-lg font-bold text-white">App Lock Protection</h3>
                  <Badge variant="outline" className={`text-[10px] font-bold tracking-wider ${appLockStateClass}`}>
                    {appLockStateLabel}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                    SafeNet's AppLock-style protection with a local passcode and Accessibility Service using LockLock via GitHub
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 self-end rounded-lg border border-white/10 bg-background/30 px-3 py-2 sm:self-start">
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Protection</span>
              <Switch
                checked={appLock.status.enabled}
                onCheckedChange={(enabled) => {
                  void appLock.setEnabled(enabled).catch(() => undefined);
                }}
                disabled={!appLock.supported || appLock.isBusy}
                aria-label={`App Lock Protection ${appLock.status.enabled ? "On" : "Off"}`}
                data-testid="switch-app-lock"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-background/30 p-3">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Access method</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                 Local passcode
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                 Salted and stored on this device
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-background/30 p-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Accessibility Service</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                  {appLock.status.accessibilityServiceEnabled === true && appLock.status.overlayEnabled === true ? "Connected" : "Setup required"}
              </p>
                <p className="mt-1 text-xs text-muted-foreground">Monitors selected launches before showing the lock screen</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-background/30 p-3">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Anti-uninstall</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {appLock.status.antiUninstall === true
                  ? "Enabled"
                  : appLock.status.deviceAdminEnabled === true
                    ? "Active"
                    : "Optional"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {appLock.status.deviceAdminEnabled === true
                  ? "Device Administrator is still active"
                  : "Device Administrator protection"}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{appLock.status.message}</p>
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                 SafeNet stores a salted local passcode hash on-device. Accessibility Service, overlay, and Device Administrator permissions remain explicit Android opt-ins.
              </p>
            </div>
            {appLock.status.enabled && appLock.supported && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void appLock.lockNow()}
                disabled={appLock.isBusy}
                data-testid="button-lock-app-now"
                className="shrink-0 border-primary/30 text-primary hover:border-primary hover:bg-primary/10"
              >
                <LockKeyhole className="mr-2 h-4 w-4" />
                Lock app now
              </Button>
            )}
          </div>
        </div>
      </CyberCard>

      {/* Hero Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:gap-6">
        <CyberCard glow className="bg-gradient-to-br from-primary/10 to-transparent border-primary/20">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-mono text-primary uppercase tracking-wider mb-1">Total Queries</p>
                <h2 className="text-3xl sm:text-4xl font-display font-bold text-white text-shadow-glow">
                {stats?.totalQueries.toLocaleString() || "0"}
              </h2>
            </div>
            <div className="p-3 bg-primary/20 rounded-lg">
              <Activity className="w-6 h-6 text-primary" />
            </div>
          </div>
          <div className="mt-4 h-1 w-full bg-primary/10 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: "75%" }}
              className="h-full bg-primary shadow-[0_0_10px_var(--primary)]"
            />
          </div>
        </CyberCard>

        <CyberCard glow className="bg-gradient-to-br from-destructive/10 to-transparent border-destructive/20">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-mono text-destructive uppercase tracking-wider mb-1">Threats Blocked</p>
                <h2 className="text-3xl sm:text-4xl font-display font-bold text-white text-shadow-danger">
                {stats?.threatsBlocked.toLocaleString() || "0"}
              </h2>
            </div>
            <div className="p-3 bg-destructive/20 rounded-lg">
              <Shield className="w-6 h-6 text-destructive" />
            </div>
          </div>
          <div className="mt-4 h-1 w-full bg-destructive/10 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: "32%" }}
              className="h-full bg-destructive shadow-[0_0_10px_var(--destructive)]"
            />
          </div>
        </CyberCard>

      </div>

      {/* Live Traffic Analysis */}
      <CyberCard className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-display font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Network Traffic Analysis
          </h3>
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-mono font-bold tracking-wider text-emerald-300">
            <span className={`h-2 w-2 rounded-full bg-emerald-400 ${isLive ? "animate-pulse" : ""}`} />
            LIVE • REFRESHING EVERY 5S
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center justify-between text-primary">
              <span className="text-[11px] font-mono uppercase tracking-wider">Total requests</span>
              <Radio className="h-4 w-4" />
            </div>
            <p className="mt-2 text-2xl font-display font-bold text-white">{(stats?.totalQueries ?? 0).toLocaleString()}</p>
            <p className="text-[11px] text-muted-foreground">Live DNS activity</p>
          </div>
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <div className="flex items-center justify-between text-destructive">
              <span className="text-[11px] font-mono uppercase tracking-wider">Blocked</span>
              <Shield className="h-4 w-4" />
            </div>
            <p className="mt-2 text-2xl font-display font-bold text-white">{(stats?.blockedQueries ?? 0).toLocaleString()}</p>
            <p className="text-[11px] text-muted-foreground">{blockRate}% of requests</p>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-center justify-between text-emerald-300">
              <span className="text-[11px] font-mono uppercase tracking-wider">Allowed</span>
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <p className="mt-2 text-2xl font-display font-bold text-white">{allowedQueries.toLocaleString()}</p>
            <p className="text-[11px] text-muted-foreground">Passed through protection</p>
          </div>
          <div className="rounded-lg border border-sky-400/20 bg-sky-400/5 p-3">
            <div className="flex items-center justify-between text-sky-300">
              <span className="text-[11px] font-mono uppercase tracking-wider">Threat ratio</span>
              <Gauge className="h-4 w-4" />
            </div>
            <p className="mt-2 text-2xl font-display font-bold text-white">{blockRate}%</p>
            <p className="text-[11px] text-muted-foreground">Blocked vs. total</p>
          </div>
        </div>

        <div className="h-[240px] sm:h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="allowedTraffic" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.35}/>
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="blockedTraffic" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.35}/>
                  <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                itemStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
              <Area
                type="monotone"
                dataKey="allowed"
                name="Allowed"
                stackId="traffic"
                stroke="#34d399"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#allowedTraffic)"
              />
              <Area
                type="monotone"
                dataKey="blocked"
                name="Blocked"
                stackId="traffic"
                stroke="hsl(var(--destructive))"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#blockedTraffic)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CyberCard>

      {/* Recent Activity Log Preview */}
      <CyberCard>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-display font-bold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            Recent Interventions
          </h3>
          <span className="text-xs font-mono text-muted-foreground bg-white/5 px-2 py-1 rounded">LIVE FEED</span>
        </div>
        
        <div className="space-y-3">
          {logs?.slice(0, 5).map((log) => (
            <div key={log.id} className="flex items-center justify-between p-3 rounded bg-black/20 border border-white/5 hover:border-white/10 transition-colors">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${log.status === 'blocked' ? 'bg-destructive shadow-[0_0_5px_var(--destructive)]' : 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,1)]'}`} />
                <div>
                  <p className="font-mono text-sm text-white">{log.domain}</p>
                  <p className="text-xs text-muted-foreground uppercase">{log.protocol} • {new Date(log.timestamp || "").toLocaleTimeString()}</p>
                </div>
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded border ${log.status === 'blocked' ? 'border-destructive/30 text-destructive bg-destructive/10' : 'border-green-500/30 text-green-500 bg-green-500/10'}`}>
                {log.status === 'blocked' ? 'BLOCKED' : 'ALLOWED'}
              </span>
            </div>
          ))}
          
          {(!logs || logs.length === 0) && (
            <div className="text-center py-8 text-muted-foreground text-sm font-mono">
              No recent activity detected
            </div>
          )}
        </div>
      </CyberCard>
    </div>
  );
}
