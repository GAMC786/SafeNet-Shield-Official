import { useEffect, useRef } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { ClerkProvider, SignIn, SignUp, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Navigation } from "@/components/Navigation";
import { SystemNavigation } from "@/components/Navigation";
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
import SpamCallBlocker from "@/pages/SpamCallBlocker";
import NotFound from "@/pages/not-found";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY.");
}

function stripBase(path: string) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function MainLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col safe-area-inset md:pl-20">
      <NetworkStatusBanner />
      <SystemNavigation />
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

      <main className="flex-1 w-full max-w-7xl mx-auto overflow-y-auto p-4 pb-24 pt-24 sm:p-6 sm:pb-24 sm:pt-28 lg:p-8 lg:pb-8 lg:pt-28">
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
          <Route path="/spam-call-blocker" component={SpamCallBlocker} />
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

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
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

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#ef4444",
    colorForeground: "#f8fafc",
    colorMutedForeground: "#94a3b8",
    colorDanger: "#f87171",
    colorBackground: "#111827",
    colorInput: "#1f2937",
    colorInputForeground: "#f8fafc",
    colorNeutral: "#475569",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-slate-900 rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white",
    headerSubtitle: "text-slate-300",
    socialButtonsBlockButtonText: "text-white",
    formFieldLabel: "text-slate-200",
    footerActionLink: "text-red-400 hover:text-red-300",
    footerActionText: "text-slate-300",
    dividerText: "text-slate-400",
    identityPreviewEditButton: "text-red-400",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-red-200",
    logoBox: "rounded-lg",
    logoImage: "rounded-lg",
    socialButtonsBlockButton: "border-slate-700 bg-slate-800 hover:bg-slate-700",
    formButtonPrimary: "bg-red-600 hover:bg-red-500 text-white",
    formFieldInput: "border-slate-700 bg-slate-800 text-white",
    footerAction: "border-slate-700",
    dividerLine: "bg-slate-700",
    alert: "border-red-500/40 bg-red-950/50",
    otpCodeFieldInput: "border-slate-700 bg-slate-800 text-white",
    formFieldRow: "text-slate-200",
    main: "bg-transparent",
  },
};

function ClerkProviderWithRoutes() {
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
            subtitle: "Sign in to manage your SafeNet account",
          },
        },
        signUp: {
          start: {
            title: "Create your SafeNet account",
            subtitle: "Protect your subscription with account sign-in",
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
        <ClerkProviderWithRoutes />
      </WouterRouter>
    </Sentry.ErrorBoundary>
  );
}

export default App;
