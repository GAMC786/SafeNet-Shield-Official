import { Switch, Route, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useSettings } from "@/hooks/use-settings";
import { AlertTriangle, Loader2, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getConfiguredApiOrigin } from "@/lib/api";
import { SoundtrackControl } from "@/components/SoundtrackControl";
import { Navigation } from "@/components/Navigation";
import { useFirewallConfig } from "@/hooks/use-firewall-config";

// Pages
import Dashboard from "@/pages/Dashboard";
import DnsSettings from "@/pages/DnsSettings";
import DdnsUpdater from "@/pages/DdnsUpdater";
import SpeedTest from "@/pages/SpeedTest";
import Firewall from "@/pages/Firewall";
import Antivirus from "@/pages/Antivirus";
import Logs from "@/pages/Logs";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/not-found";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function MainLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col safe-area-inset md:pl-20">
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

      <main className="flex-1 w-full max-w-7xl mx-auto overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8 lg:pb-8">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/command-center" component={Dashboard} />
          <Route path="/dns" component={DnsSettings} />
          <Route path="/ddns" component={DdnsUpdater} />
          <Route path="/speedtest" component={SpeedTest} />
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
  const settingsQuery = useSettings();
  useFirewallConfig();
  const isError = settingsQuery.isError;
  const error = settingsQuery.error;
  const refetch = () => void settingsQuery.refetch();
  const isFetching = settingsQuery.isFetching;

  if (isError) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <div className="glass-panel rounded-lg max-w-lg w-full p-6 sm:p-8 text-center space-y-5">
          <div className="h-14 w-14 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl">Server connection unavailable</h1>
            <p className="text-muted-foreground mt-3">
              The app opened correctly, but it could not reach the SafeNet DNS server.
            </p>
          </div>
          <div className="rounded-md bg-secondary/60 border border-border p-4 text-left text-sm space-y-2">
            <div className="flex items-center gap-2 font-medium">
              <Server className="h-4 w-4 text-primary" />
              Backend
            </div>
            <p className="text-muted-foreground break-words">
              {getConfiguredApiOrigin() || "No mobile backend URL configured"}
            </p>
            <p className="text-destructive/90 break-words">
              {error instanceof Error ? error.message : "Unable to load server settings."}
            </p>
          </div>
          <Button onClick={() => refetch()} disabled={isFetching} className="w-full">
            {isFetching ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Try again
          </Button>
          <p className="text-xs text-muted-foreground">
            Check your internet connection and confirm the backend address used when this APK was built.
          </p>
        </div>
      </div>
    );
  }

  return <MainLayout />;
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <SoundtrackControl />
        <AppContent />
        <Toaster />
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
