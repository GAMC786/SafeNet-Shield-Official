import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Navigation } from "@/components/Navigation";
import { useAuthStatus, useSettings } from "@/hooks/use-settings";
import { AlertTriangle, Loader2, RefreshCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getConfiguredApiOrigin } from "@/lib/api";
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

// Resolve the key from the browser hostname so the same build works on
// SafeNet's development and published domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in the environment.");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: "top" as const,
    socialButtonsVariant: "blockButton" as const,
  },
  variables: {
    colorPrimary: "#3b82f6",
    colorForeground: "#f8fafc",
    colorMutedForeground: "#94a3b8",
    colorDanger: "#f87171",
    colorBackground: "#0f172a",
    colorInput: "#111c32",
    colorInputForeground: "#f8fafc",
    colorNeutral: "#334155",
    fontFamily: "Space Grotesk, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-slate-900 rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white font-display tracking-wider",
    headerSubtitle: "text-slate-300",
    socialButtonsBlockButtonText: "text-white font-medium",
    formFieldLabel: "text-slate-200",
    footerActionLink: "text-blue-400 hover:text-blue-300",
    footerActionText: "text-slate-300",
    dividerText: "text-slate-400",
    identityPreviewEditButton: "text-blue-400",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-red-300",
    logoBox: "h-12",
    logoImage: "max-h-12",
    socialButtonsBlockButton: "border-slate-600 bg-slate-800 hover:bg-slate-700",
    formButtonPrimary: "bg-blue-600 hover:bg-blue-500 text-white",
    formFieldInput: "border-slate-600 bg-slate-800 text-white",
    footerAction: "border-slate-700",
    dividerLine: "bg-slate-700",
    alert: "border-red-500/40 bg-red-950/40",
    otpCodeFieldInput: "border-slate-600 bg-slate-800 text-white",
    formFieldRow: "text-slate-200",
    main: "bg-transparent",
  },
};

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
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const authStatus = useAuthStatus();
  const isAuthenticated = authStatus.data?.authenticated === true || isSignedIn === true;
  const settingsQuery = useSettings(isAuthenticated);
  const firewallConfigQuery = useFirewallConfig(isAuthenticated);
  const { data: settings } = settingsQuery;
  const isLoading =
    !clerkLoaded ||
    authStatus.isLoading ||
    (isAuthenticated && (settingsQuery.isLoading || firewallConfigQuery.isLoading));
  const isError = authStatus.isError || settingsQuery.isError;
  const error = authStatus.error || settingsQuery.error;
  const refetch = () => {
    void authStatus.refetch();
    if (isAuthenticated) {
      void settingsQuery.refetch();
    }
  };
  const isFetching = authStatus.isFetching || settingsQuery.isFetching;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
        <div className="text-center space-y-4" role="status">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <div>
            <h1 className="text-xl">Connecting to SafeNet DNS</h1>
            <p className="text-muted-foreground mt-2">Loading server settings…</p>
          </div>
        </div>
      </div>
    );
  }

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

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) {
        queryClient.clear();
      }
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function AppWithAuth() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to access SafeNet DNS",
          },
        },
        signUp: {
          start: {
            title: "Create your SafeNet account",
            subtitle: "Secure your DNS workspace",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route component={AppContent} />
        </Switch>
        <Toaster />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppWithAuth />
    </WouterRouter>
  );
}

export default App;
