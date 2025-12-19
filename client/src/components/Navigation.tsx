import { Link, useLocation } from "wouter";
import { Shield, Activity, List, Settings, Globe, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const navItems = [
  { path: "/", label: "Dashboard", icon: Activity },
  { path: "/dns", label: "DNS Servers", icon: Globe },
  { path: "/ddns", label: "Dynamic DNS", icon: Wifi },
  { path: "/firewall", label: "Firewall", icon: Shield },
  { path: "/logs", label: "Activity", icon: List },
  { path: "/settings", label: "Settings", icon: Settings },
];

export function Navigation() {
  const [location] = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 glass-panel border-t border-white/5 md:top-0 md:bottom-auto md:w-20 md:h-screen md:border-r md:border-t-0 md:flex md:flex-col md:items-center md:py-8 bg-black/80 backdrop-blur-xl">
      <div className="hidden md:flex flex-col items-center mb-12">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-primary to-blue-500 flex items-center justify-center shadow-[0_0_15px_rgba(59,130,246,0.5)]">
          <Shield className="w-6 h-6 text-white" />
        </div>
      </div>

      <div className="flex md:flex-col justify-around md:justify-start w-full md:space-y-4 md:px-2">
        {navItems.map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;

          return (
            <Link key={item.path} href={item.path}>
              <div 
                className={cn(
                  "relative flex flex-col items-center justify-center p-3 md:p-4 rounded-xl transition-all duration-300 cursor-pointer group",
                  isActive 
                    ? "text-primary md:bg-primary/10" 
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute -top-1 md:top-auto md:left-0 md:h-8 md:w-1 w-8 h-1 bg-primary rounded-full shadow-[0_0_10px_rgba(59,130,246,0.8)]"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <Icon className={cn("w-6 h-6", isActive && "drop-shadow-[0_0_5px_rgba(59,130,246,0.5)]")} />
                <span className="text-[10px] mt-1 md:hidden font-medium">{item.label}</span>
                
                {/* Tooltip for desktop */}
                <span className="hidden md:block absolute left-16 bg-card border border-border px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                  {item.label}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
