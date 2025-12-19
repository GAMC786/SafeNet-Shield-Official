import { useStats, useLogs } from "@/hooks/use-logs";
import { useSettings } from "@/hooks/use-settings";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Activity, Shield, Lock, AlertTriangle, Play, Wifi } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from "framer-motion";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function Dashboard() {
  const { data: stats } = useStats();
  const { data: logs } = useLogs();
  const { data: settings } = useSettings();

  const handleSimulateTraffic = async () => {
    // This endpoint doesn't really exist in our schema but we can fake it by creating logs
    // In a real app this would trigger a backend simulation
    // For now we'll just invalidate to refresh
    await queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
  };

  const chartData = logs?.slice(0, 20).map(log => ({
    name: new Date(log.timestamp || new Date()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: log.status === 'blocked' ? 10 : 2
  })).reverse() || [];

  return (
    <div className="space-y-6">
      <Header 
        title="Command Center" 
        subtitle="System Status: Online" 
        status="active" 
      />

      {/* Hero Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <CyberCard glow className="bg-gradient-to-br from-primary/10 to-transparent border-primary/20">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-mono text-primary uppercase tracking-wider mb-1">Total Queries</p>
              <h2 className="text-4xl font-display font-bold text-white text-shadow-glow">
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
              <h2 className="text-4xl font-display font-bold text-white text-shadow-danger">
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
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center border border-white/10 relative">
            <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin" />
            <Wifi className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">System Active</h3>
            <p className="text-sm text-muted-foreground">Protection is running</p>
          </div>
          <button 
            onClick={handleSimulateTraffic}
            className="w-full py-2 px-4 bg-primary/20 hover:bg-primary/30 border border-primary/50 text-primary rounded text-sm font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4" /> Simulate Traffic
          </button>
        </CyberCard>
      </div>

      {/* Traffic Chart */}
      <CyberCard className="h-[300px] flex flex-col">
        <h3 className="text-lg font-display font-bold mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          Network Traffic Analysis
        </h3>
        <div className="flex-1 w-full min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
              <XAxis dataKey="name" hide />
              <YAxis hide />
              <Tooltip 
                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                itemStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Area 
                type="monotone" 
                dataKey="value" 
                stroke="var(--primary)" 
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorValue)" 
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
