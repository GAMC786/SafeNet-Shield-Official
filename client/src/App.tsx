import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Navigation } from "@/components/Navigation";
import { PinEntry } from "@/pages/PinEntry";
import { useState, useEffect } from "react";
import { useSettings } from "@/hooks/use-settings";

// Pages
import Dashboard from "@/pages/Dashboard";
import DnsSettings from "@/pages/DnsSettings";
import DdnsUpdater from "@/pages/DdnsUpdater";
import Firewall from "@/pages/Firewall";
import Antivirus from "@/pages/Antivirus";
import Logs from "@/pages/Logs";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/not-found";

function MainLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row pb-24 md:pb-0 safe-area-inset">
      <Navigation />
      
      {/* Scanline Effect */}
      <div className="scan-line" />
      
      {/* Background Grid */}
      <div className="fixed inset-0 pointer-events-none z-[-1]" 
           style={{ 
             backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)',
             backgroundSize: '40px 40px'
           }} 
      />

      <main className="flex-1 p-3 sm:p-4 md:p-8 md:ml-20 overflow-y-auto max-w-7xl mx-auto w-full safe-area-inset-bottom">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/dns" component={DnsSettings} />
          <Route path="/ddns" component={DdnsUpdater} />
          <Route path="/firewall" component={Firewall} />
          <Route path="/antivirus" component={Antivirus} />
          <Route path="/logs" component={Logs} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function AppContent() {
  const { data: settings, isLoading } = useSettings();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // If PIN is enabled, default to not authenticated until verification
  useEffect(() => {
    if (settings && !settings.isPinEnabled) {
      setIsAuthenticated(true);
    }
  }, [settings]);

  if (isLoading) return null;

  // Show PIN entry if enabled and not authenticated
  if (settings?.isPinEnabled && !isAuthenticated) {
    return <PinEntry onSuccess={() => setIsAuthenticated(true)} />;
  }

  return <MainLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
