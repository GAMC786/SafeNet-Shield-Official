import { ShieldCheck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  title: string;
  subtitle?: string;
  status?: "active" | "inactive" | "warning";
}

export function Header({ title, subtitle, status }: HeaderProps) {
  return (
    <header className="flex items-center justify-between mb-8 pb-4 border-b border-border/40">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold font-display uppercase tracking-wider text-white">
          <span className="text-primary mr-2">/</span>
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1 font-mono uppercase tracking-widest opacity-80">
            {subtitle}
          </p>
        )}
      </div>
      
      {status && (
        <div className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold uppercase tracking-wider",
          status === "active" ? "bg-green-500/10 border-green-500/30 text-green-400" :
          status === "warning" ? "bg-red-500/10 border-red-500/30 text-red-400" :
          "bg-gray-500/10 border-gray-500/30 text-gray-400"
        )}>
          {status === "active" ? <ShieldCheck className="w-3.5 h-3.5" /> : 
           status === "warning" ? <Zap className="w-3.5 h-3.5" /> : null}
          {status === "active" ? "Protected" : 
           status === "warning" ? "Threat Detected" : "Inactive"}
        </div>
      )}
    </header>
  );
}
