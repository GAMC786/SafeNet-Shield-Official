import { useLogs } from "@/hooks/use-logs";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Shield, Clock, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Logs() {
  const { data: logs, isLoading } = useLogs();
  const realLogs = logs?.filter((log) => log.source === "android") ?? [];
  const historicalLogs = logs?.filter((log) => log.source !== "android") ?? [];

  return (
    <div className="space-y-6">
      <Header 
        title="Access Logs" 
        subtitle="Network Traffic History" 
      />

      <div className="space-y-4">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {realLogs.map((log) => (
          <div 
            key={log.id} 
            className={cn(
              "group relative flex flex-col md:flex-row md:items-center justify-between p-4 rounded-lg border transition-all duration-300",
              log.status === 'blocked' 
                ? "bg-destructive/5 border-destructive/20 hover:border-destructive/50" 
                : "bg-card border-white/5 hover:border-primary/30"
            )}
          >
            {/* Status Line Indicator */}
            <div className={cn(
              "absolute left-0 top-0 bottom-0 w-1 rounded-l-lg",
              log.status === 'blocked' ? "bg-destructive" : "bg-green-500"
            )} />

            <div className="flex items-start gap-4 pl-3">
              <div className={cn(
                "p-2 rounded mt-1 md:mt-0",
                log.status === 'blocked' ? "bg-destructive/20 text-destructive" : "bg-green-500/10 text-green-500"
              )}>
                <Shield className="w-5 h-5" />
              </div>
              
              <div>
                <h4 className="font-mono text-base font-bold text-white mb-1 group-hover:text-primary transition-colors">
                  {log.domain}
                </h4>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground uppercase font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(log.timestamp || "").toLocaleString()}
                  </span>
                  <span>•</span>
                  <span>{log.protocol}</span>
                  {log.reason && (
                    <>
                      <span>•</span>
                      <span className={cn(
                        "font-bold",
                        log.status === "blocked" ? "text-destructive" : "text-muted-foreground",
                      )}>{log.reason}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-3 md:mt-0 pl-3 md:pl-0 flex justify-end">
              <span className={cn(
                "px-3 py-1 rounded text-xs font-bold uppercase tracking-wider border",
                log.status === 'blocked' 
                  ? "bg-destructive/10 text-destructive border-destructive/20" 
                  : "bg-green-500/10 text-green-500 border-green-500/20"
              )}>
                {log.status === 'blocked' ? "BLOCKED" : "ALLOWED"}
              </span>
            </div>
          </div>
        ))}

        {realLogs.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border border-dashed border-white/10 rounded-lg">
            <Info className="w-12 h-12 mb-4 opacity-20" />
            <p className="font-mono text-sm">No live Android DNS activity recorded yet</p>
            <p className="font-mono text-xs mt-2 text-center max-w-md">
              Activity appears here after DNS protection handles a request on an Android device.
            </p>
          </div>
        )}

        {historicalLogs.length > 0 && (
          <div className="pt-4">
            <div className="flex items-center gap-2 mb-3 text-muted-foreground">
              <Clock className="w-4 h-4" />
              <h3 className="font-mono text-xs uppercase tracking-wider">Historical activity</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              These older records are retained for reference and are not live Android reports.
            </p>
            {historicalLogs.map((log) => (
              <div key={log.id} className="mb-3 p-4 rounded-lg border border-white/5 bg-card/60">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div>
                    <h4 className="font-mono text-sm font-bold text-white">{log.domain}</h4>
                    <p className="text-xs text-muted-foreground uppercase font-mono mt-1">
                      {log.protocol} · {new Date(log.timestamp || "").toLocaleString()}
                      {log.reason && ` · ${log.reason}`}
                    </p>
                  </div>
                  <span className="text-xs uppercase font-mono text-muted-foreground">
                    {log.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
