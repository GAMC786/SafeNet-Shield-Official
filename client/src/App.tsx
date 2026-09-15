import { Switch, Route, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Navigation } from "@/components/Navigation";
import { useFirewallConfig } from "@/hooks/use-firewall-config";
import * as Sentry from "@sentry/react";
import { captureGlitchTipException } from "./lib/glitchtip";
import { NetworkStatusBanner } from "@/components/NetworkStatusBanner";

// Pages
import Dashboard from "@/pages/Dashboard";
import DnsSettings from "@/pages/DnsSettings";
import DdnsUpdater from "@/pages/DdnsUpdater";
import SpeedTest from "@/pages/SpeedTest";
import Firewall from "@/pages/Firewall";
import Antivirus from "@/pages/Antivirus";
import Logs from "@/pages/Logs";
import TetherShare from "@/pages/TetherShare";
import Settings from "@/pages/Settings";
import Billing from "@/pages/Billing";
import NotFound from "@/pages/not-found";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function MainLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col safe-area-inset md:pl-20">
      <NetworkStatusBanner />
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
          <Route path="/tether" component={TetherShare} />
          <Route path="/settings" component={Settings} />
          <Route path="/billing" component={Billing} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function AppContent() {
  useFirewallConfig();
  return <MainLayout />;
}

function App() {
  return (
    <Sentry.ErrorBoundary
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
          <div className="max-w-md space-y-4">
            <h1 className="font-display text-2xl font-bold">SafeNet Shield needs to reload</h1>
            <p className="text-sm text-muted-foreground">
              An unexpected error interrupted the security console. Reload the app to continue.
            </p>
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Reload SafeNet Shield
            </button>
          </div>
        </div>
      }
      onError={(error, componentStack) =>
        captureGlitchTipException(error, { componentStack })
      }
    >
      <WouterRouter base={basePath}>
        <QueryClientProvider client={queryClient}>
          <AppContent />
          <Toaster />
        </QueryClientProvider>
      </WouterRouter>
    </Sentry.ErrorBoundary>
  );
}

export default App;
