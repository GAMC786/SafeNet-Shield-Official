import { Link, useLocation } from "wouter";
import { Shield, Activity, Share2, Settings, Globe, Wifi, Bug, Gauge, CreditCard, PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

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
      className="safenet-system-navigation glass-panel fixed inset-x-0 z-40 rounded-b-2xl border-b border-white/5 bg-black/80 px-3 shadow-[0_8px_30px_rgba(0,0,0,0.25)] backdrop-blur-xl md:px-6"
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
    <nav className="safenet-bottom-navigation fixed inset-x-0 z-50 rounded-t-2xl glass-panel border-t border-white/5 bg-black/80 backdrop-blur-xl">
      <div className="grid h-full w-full grid-cols-5">
        {navItems.map((item) => {
          const isActive = location === item.path;
          const Icon = item.icon;

          return (
            <Link key={item.path} href={item.path} className="flex min-w-0 justify-center">
              <div 
                className={cn(
                  navItemClass,
                  isActive ? "text-primary bg-primary/10" : navInactiveClass,
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute -top-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_10px_rgba(59,130,246,0.8)]"
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
