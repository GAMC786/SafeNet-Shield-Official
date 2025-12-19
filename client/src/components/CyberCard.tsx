import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CyberCardProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}

export function CyberCard({ children, className, glow = false }: CyberCardProps) {
  return (
    <div 
      className={cn(
        "glass-panel rounded-xl p-6 relative overflow-hidden transition-all duration-300 group",
        glow && "hover:shadow-[0_0_30px_rgba(59,130,246,0.15)] hover:border-primary/30",
        className
      )}
    >
      {/* Decorative corner accents */}
      <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-white/20 group-hover:border-primary/50 transition-colors" />
      <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-white/20 group-hover:border-primary/50 transition-colors" />
      <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-white/20 group-hover:border-primary/50 transition-colors" />
      <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-white/20 group-hover:border-primary/50 transition-colors" />
      
      {children}
    </div>
  );
}
