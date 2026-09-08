import { useStats, useLogs } from "@/hooks/use-logs";
import { useAuthStatus } from "@/hooks/use-settings";
import { useDnsServers } from "@/hooks/use-dns";
import { useSafeNetVpn } from "@/hooks/use-vpn";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Activity, Shield, AlertTriangle, Server, CheckCircle2, Gauge, Radio, ShieldCheck, Loader2 } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

export default function Dashboard() {
  const authStatus = useAuthStatus();
  const canReadProtectedData = authStatus.data?.authenticated === true;
  const statsQuery = useStats(canReadProtectedData);
  const logsQuery = useLogs(canReadProtectedData);
  const { data: stats } = statsQuery;
  const { data: logs } = logsQuery;
  const { data: dnsServers } = useDnsServers(canReadProtectedData);
  const vpn = useSafeNetVpn();
  
  const activeDns = dnsServers?.find(s => s.isActive);

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
        subtitle={canReadProtectedData ? "System Status: Online" : "Loading protected network status"}
        status={canReadProtectedData ? "active" : "warning"}
      />

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
                <p className="text-sm text-muted-foreground">Active DNS Server</p>
                <Badge variant="outline" className="text-xs text-green-500 border-green-500/30">
                  Connected
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

      {/* Hero Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-5 lg:gap-6">
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

        <CyberCard className="flex flex-col justify-center items-center text-center space-y-4">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center border relative ${
              vpn.status?.running
                ? "bg-green-500/10 border-green-500/30"
                : "bg-white/5 border-white/10"
            }`}
          >
            {vpn.status === null && vpn.supported ? (
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            ) : (
              <ShieldCheck className={`w-8 h-8 ${vpn.status?.running ? "text-green-400" : "text-primary"}`} />
            )}
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">DNS Protection VPN</h3>
            <p className="text-sm text-muted-foreground">
              {!vpn.supported
                ? "Available in the SafeNet Android APK"
                : vpn.status === null
                  ? "Checking protection status…"
                  : vpn.status.running
                    ? "DNS protection is running"
                    : vpn.status.error || "Protection is inactive · Enable in Settings"}
            </p>
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
            <p className="text-[11px] text-muted-foreground">Passed protection</p>
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
