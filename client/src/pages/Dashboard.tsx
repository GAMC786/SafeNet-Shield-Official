import { useStats, useLogs } from "@/hooks/use-logs";
import { useDnsServers } from "@/hooks/use-dns";
import { useSettings } from "@/hooks/use-settings";
import { useAntivirusSettings } from "@/hooks/use-antivirus";
import { useClamAvStatus } from "@/hooks/use-clamav";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { Activity, Shield, AlertTriangle, Server, CheckCircle2, Gauge, Radio, Music, LockKeyhole, ExternalLink } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { useSoundtrack } from "@/hooks/use-soundtrack";
import { useAppLock } from "@/hooks/use-app-lock";
import { useWgEasyStatus } from "@/hooks/use-wg-easy";
import {
  usePrivateDns,
} from "@/hooks/use-private-dns";
import { isProtectionActive } from "@/lib/protection-status";

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
  const wgEasy = useWgEasyStatus();
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

  return (
    <div className="space-y-5 sm:space-y-6">
      <Header 
        title="Command Center" 
        subtitle={isServerAvailable ? "System Status: Online" : "Server connection unavailable"}
        status={isProtected ? "active" : "unprotected"}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CyberCard className="flex min-h-[104px] items-center">
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

        <CyberCard className="min-h-[104px]">
          <div className="flex h-full flex-col justify-between gap-3 rounded-lg border border-white/10 bg-background/30 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 shrink-0 text-primary" />
                  <p className="text-sm font-medium text-foreground">WG-Easy</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {wgEasy.data?.message ?? "Checking the configured WireGuard server…"}
                </p>
              </div>
              <Badge
                variant="outline"
                className={
                  wgEasy.data?.status === "online"
                    ? "shrink-0 border-emerald-400/40 bg-emerald-400/10 text-[10px] text-emerald-300"
                    : wgEasy.data?.status === "unavailable"
                      ? "shrink-0 border-amber-400/40 bg-amber-400/10 text-[10px] text-amber-300"
                      : "shrink-0 border-white/15 bg-white/5 text-[10px] text-muted-foreground"
                }
              >
                {wgEasy.data?.status === "online"
                  ? "ONLINE"
                  : wgEasy.data?.status === "unavailable"
                    ? "UNAVAILABLE"
                    : "NOT CONFIGURED"}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-background/20 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">WireGuard UDP tunnel</p>
                <p className="text-[11px] text-muted-foreground">
                  {wgEasy.data?.tunnelVerification.message ??
                    "Waiting for a disposable-peer verification from the WG-Easy host."}
                </p>
              </div>
              <Badge
                variant="outline"
                className={
                  wgEasy.data?.tunnelVerification.status === "verified"
                    ? "shrink-0 border-emerald-400/40 bg-emerald-400/10 text-[10px] text-emerald-300"
                    : wgEasy.data?.tunnelVerification.status === "failed"
                      ? "shrink-0 border-amber-400/40 bg-amber-400/10 text-[10px] text-amber-300"
                      : "shrink-0 border-white/15 bg-white/5 text-[10px] text-muted-foreground"
                }
              >
                {wgEasy.data?.tunnelVerification.status === "verified"
                  ? "VERIFIED"
                  : wgEasy.data?.tunnelVerification.status === "failed"
                    ? "FAILED"
                    : "NOT VERIFIED"}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {wgEasy.data?.adminUrl ? (
                <Button asChild size="sm" variant="outline">
                  <a href={wgEasy.data.adminUrl} target="_blank" rel="noreferrer">
                    Open admin UI
                    <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void wgEasy.refetch()}
                disabled={wgEasy.isFetching}
              >
                {wgEasy.isFetching ? "Checking…" : "Recheck"}
              </Button>
            </div>
            {!wgEasy.data?.configured ? (
              <details className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium text-primary">
                  Set up a real WireGuard host
                </summary>
                <div className="mt-2 space-y-2 text-muted-foreground">
                  <p>
                    WG-Easy needs a Linux host with Docker, persistent storage, and public UDP
                    51820. Railway&apos;s web service cannot provide that VPN endpoint.
                  </p>
                  <ol className="list-decimal space-y-1 pl-4">
                    <li>
                      Run <code className="text-foreground">scripts/install-wg-easy.sh</code> as
                      root on a compatible host.
                    </li>
                    <li>Allow UDP 51820 and TCP 51821 in that host&apos;s firewall.</li>
                    <li>
                      Set <code className="text-foreground">WG_EASY_URL</code> and{" "}
                      <code className="text-foreground">WG_EASY_WIREGUARD_ENDPOINT</code> on
                      SafeNet, then recheck.
                    </li>
                  </ol>
                  <a
                    href="https://wg-easy.github.io/wg-easy/latest/examples/tutorials/basic-installation/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    View the official host requirements
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </div>
              </details>
            ) : wgEasy.data.wireguardEndpoint ? (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">
                  VPN endpoint:{" "}
                  <span className="font-mono text-foreground">{wgEasy.data.wireguardEndpoint}/udp</span>
                </p>
                {wgEasy.data.tunnelVerification.status === "not-run" ? (
                  <p className="text-[11px] text-muted-foreground">
                    Run <code className="text-foreground">/opt/wg-easy/verify-wg-easy-peer.sh</code> on
                    the WG-Easy host with its admin credentials supplied through environment variables.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </CyberCard>

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
                    AppLock-style protection with a local passcode and Accessibility Service
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
