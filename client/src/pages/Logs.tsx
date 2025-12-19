import { useLogs } from "@/hooks/use-logs";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Shield, Clock, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Logs() {
  const { data: logs, isLoading } = useLogs();

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

        {logs?.map((log) => (
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
                      <span className="text-destructive font-bold">{log.reason}</span>
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

        {(!logs || logs.length === 0) && !isLoading && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Info className="w-12 h-12 mb-4 opacity-20" />
            <p className="font-mono text-sm">No activity recorded yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
