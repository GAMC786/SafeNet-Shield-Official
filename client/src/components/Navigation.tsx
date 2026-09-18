import { Link, useLocation } from "wouter";
import { Shield, Activity, Share2, Settings, Globe, Wifi, Bug, Gauge, CreditCard, PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import logoImage from "@assets/SafeNet_Shield_Logo_1766348594367.png";

const navItems = [
  { path: "/", label: "Dashboard", icon: Activity },
  { path: "/dns", label: "DNS Servers", icon: Globe },
  { path: "/ddns", label: "DDNS", icon: Wifi },
  { path: "/antivirus", label: "Antivirus", icon: Bug },
  { path: "/firewall", label: "Firewall", icon: Shield },
];

const systemServiceItems = [
  { path: "/speedtest", label: "Speed Test", icon: Gauge },
  { path: "/spam-call-blocker", label: "Spam Call Blocker", icon: PhoneCall },
  { path: "/tether", label: "Internet Share", icon: Share2 },
  { path: "/settings", label: "Settings", icon: Settings },
  { path: "/billing", label: "Premium", icon: CreditCard },
];

const navItemClass =
  "relative flex w-full flex-col items-center justify-center rounded-xl p-3 transition-all duration-300 cursor-pointer group";
const navInactiveClass = "text-muted-foreground hover:text-white hover:bg-white/5";
const navIconClass = "w-6 h-6";
const navLabelClass = "text-[10px] mt-1 font-medium";

export function SystemNavigation() {
  const [location] = useLocation();

  return (
    <nav
      aria-label="System services"
      className="glass-panel fixed inset-x-0 top-0 z-40 h-20 border-b border-white/5 bg-black/80 px-3 shadow-[0_8px_30px_rgba(0,0,0,0.25)] backdrop-blur-xl md:left-20 md:px-6"
    >
      <div className="mx-auto grid h-full w-full max-w-7xl grid-cols-5">
        {systemServiceItems.map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;

          return (
            <Link key={item.path} href={item.path} className="flex w-full min-w-0 justify-center">
              <div
                className={cn(
                  navItemClass,
                  isActive ? "text-primary bg-primary/10" : navInactiveClass,
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeSystemTab"
                    className="absolute -bottom-1 inset-x-0 z-10 mx-auto h-1 w-8 rounded-full bg-primary shadow-[0_0_10px_rgba(59,130,246,0.8)]"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <Icon className={cn(navIconClass, isActive && "drop-shadow-[0_0_5px_rgba(59,130,246,0.5)]")} />
                <span className={cn(navLabelClass, "text-center leading-tight")}>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function Navigation() {
  const [location] = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 h-20 rounded-t-2xl glass-panel border-t border-white/5 md:top-0 md:bottom-auto md:w-20 md:h-screen md:rounded-t-none md:rounded-r-2xl md:border-r md:border-t-0 md:flex md:flex-col md:items-center md:py-8 bg-black/80 backdrop-blur-xl">
      <div className="hidden md:flex flex-col items-center mb-12">
        <a href="https://safenetinc.ca" target="_blank" rel="noopener noreferrer">
          <img 
            src={logoImage} 
            alt="SafeNet DNS" 
            className="w-14 h-14 object-contain rounded-lg hover:opacity-80 transition-opacity"
          />
        </a>
      </div>

      <div className="grid h-full w-full grid-cols-5 md:flex md:h-auto md:flex-col md:space-y-4 md:px-2">
        {navItems.map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;

          return (
            <Link key={item.path} href={item.path} className="flex min-w-0 justify-center">
              <div 
                className={cn(
                  navItemClass,
                  "md:p-4",
                  isActive ? "text-primary bg-primary/10" : navInactiveClass,
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute -top-1 md:top-auto md:left-0 md:h-8 md:w-1 w-8 h-1 bg-primary rounded-full shadow-[0_0_10px_rgba(59,130,246,0.8)]"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <Icon className={cn(navIconClass, isActive && "drop-shadow-[0_0_5px_rgba(59,130,246,0.5)]")} />
                <span className={cn(navLabelClass, "md:hidden")}>{item.label}</span>
                
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
