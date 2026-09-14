import { ShieldCheck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  title: string;
  subtitle?: string;
  status?: "active" | "inactive" | "warning" | "unprotected" | "sharing" | "not-sharing";
}

export function Header({ title, subtitle, status }: HeaderProps) {
  return (
    <header className="flex items-start justify-between gap-3 mb-6 sm:mb-8 pb-4 border-b border-border/40">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold font-display uppercase tracking-wider text-white">
          <span className="text-primary mr-2">/</span>
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest opacity-80">
            {subtitle}
          </p>
        )}
        </div>
      </div>
      
      {status && (
        <div className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold uppercase tracking-wider",
           status === "active" || status === "sharing" ? "bg-green-500/10 border-green-500/30 text-green-400" :
           status === "not-sharing" ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-300" :
           status === "unprotected" ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-300" :
          status === "warning" ? "bg-red-500/10 border-red-500/30 text-red-400" :
          "bg-gray-500/10 border-gray-500/30 text-gray-400"
        )}>
            {status === "active" || status === "sharing" ? <ShieldCheck className="w-3.5 h-3.5" /> :
             status === "not-sharing" ? <Zap className="w-3.5 h-3.5" /> :
            status === "unprotected" ? <Zap className="w-3.5 h-3.5" /> :
           status === "warning" ? <Zap className="w-3.5 h-3.5" /> : null}
            {status === "active" ? "Protected" :
             status === "sharing" ? "Sharing" :
             status === "not-sharing" ? "Not Sharing" :
            status === "unprotected" ? "Unprotected" :
           status === "warning" ? "Threat Detected" : "Inactive"}
        </div>
      )}
    </header>
  );
}
