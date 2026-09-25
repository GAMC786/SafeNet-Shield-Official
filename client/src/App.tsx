import { useEffect, useRef, useState } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import {
  AuthenticateWithRedirectCallback,
  ClerkProvider,
  SignIn,
  SignUp,
  useAuth,
  useClerk,
  useSignIn,
} from "@clerk/react";
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
import { PullToRefresh } from "@/components/PullToRefresh";
import { ArrowLeft } from "lucide-react";
import { useCallback } from "react";
import { apiFetch } from "./lib/api";

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
const APP_LOCK_RETURN_URI = "safenet://app-lock/recovery";
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
  const queryClient = useQueryClient();
  const refreshActivePage = useCallback(
    () => queryClient.refetchQueries({ type: "active" }).then(() => undefined),
    [queryClient],
  );

  return (
    <div className="flex h-screen min-h-0 h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
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

      <PullToRefresh
        className="safenet-main-content min-h-0 flex-1 w-full max-w-7xl mx-auto overflow-y-auto p-4 pb-24 pt-24 sm:p-6 sm:pb-24 sm:pt-28 lg:p-8 lg:pb-8 lg:pt-28"
        onRefresh={refreshActivePage}
      >
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
      </PullToRefresh>
    </div>
  );
}

function AppContent() {
  useFirewallConfig();
  return <MainLayout />;
}

function SignInPage() {
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const provider = searchParams.get("provider");
  const recoveryNonce = searchParams.get("recovery_nonce") || "";
  const recoveryReturnUri = searchParams.get("return_uri") || "";
  const providerConfig =
    provider && provider in signInProviders
      ? signInProviders[provider as keyof typeof signInProviders]
      : undefined;

  if (providerConfig) {
    return (
      <ProviderSignInPage
        provider={providerConfig}
        recoveryNonce={recoveryNonce}
        recoveryReturnUri={recoveryReturnUri}
      />
    );
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <button
        type="button"
        aria-label="Back to Premium billing"
        title="Back to Premium billing"
        onClick={() => setLocation("/billing")}
        className="absolute left-4 top-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-slate-900/80 text-slate-200 shadow-lg transition-colors hover:border-primary/50 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:left-6 sm:top-6"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

const signInProviders = {
  google: { label: "Google", strategy: "oauth_google" as const },
  microsoft: { label: "Microsoft", strategy: "oauth_microsoft" as const },
  yahoo: { label: "Yahoo", strategy: "oauth_yahoo" as const },
  apple: { label: "Apple", strategy: "oauth_apple" as const },
} as const;

type SignInProvider = (typeof signInProviders)[keyof typeof signInProviders];

function ProviderSignInPage({
  provider,
  recoveryNonce,
  recoveryReturnUri,
}: {
  provider: SignInProvider;
  recoveryNonce?: string;
  recoveryReturnUri?: string;
}) {
  const [, setLocation] = useLocation();
  const { fetchStatus, signIn } = useSignIn();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState("");

  const startProviderSignIn = async () => {
    if (fetchStatus === "fetching") return;
    setIsStarting(true);
    setError("");
    try {
      const isRecovery =
        /^[A-Za-z0-9_-]{32,128}$/.test(recoveryNonce || "") &&
        recoveryReturnUri === APP_LOCK_RETURN_URI;
      const recoveryParams = isRecovery
        ? new URLSearchParams({
            recovery_nonce: recoveryNonce!,
            return_uri: APP_LOCK_RETURN_URI,
          })
        : null;
      const completionPath = isRecovery
        ? `${basePath}/sign-in/app-lock-recovery-complete?${recoveryParams!.toString()}`
        : `${basePath}/`;
      const callbackPath = `${window.location.origin}${basePath}/sign-in/sso-callback${
        recoveryParams ? `?${recoveryParams.toString()}` : ""
      }`;
      const result = await signIn.sso({
        strategy: provider.strategy as Parameters<typeof signIn.sso>[0]["strategy"],
        redirectUrl: completionPath,
        redirectCallbackUrl: callbackPath,
      });
      if (result.error) {
        throw new Error(result.error.message);
      }
    } catch (providerError) {
      setIsStarting(false);
      setError(
        providerError instanceof Error
          ? providerError.message
          : `${provider.label} sign-in is not enabled for this SafeNet account.`,
      );
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
      <button
        type="button"
        aria-label="Back to SafeNet sign-in"
        title="Back to SafeNet sign-in"
        onClick={() => setLocation(`${basePath}/sign-in`)}
        className="absolute left-4 top-4 z-50 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-slate-900/80 text-slate-200 shadow-lg transition-colors hover:border-primary/50 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:left-6 sm:top-6"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <div className="w-full max-w-md rounded-2xl border border-primary/20 bg-slate-900/90 p-6 shadow-2xl shadow-primary/10">
        <div className="mb-6 space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-primary">
            SAFENET / APP LOCK RECOVERY
          </p>
          <h1 className="text-2xl font-bold text-white">
            Continue with {provider.label}
          </h1>
          <p className="text-sm leading-6 text-slate-300">
            Authenticate with your provider on its secure page. SafeNet does not
            collect your provider password.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void startProviderSignIn()}
          disabled={fetchStatus === "fetching" || isStarting}
          className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid={`button-provider-sign-in-${provider.label.toLowerCase()}`}
        >
          {isStarting ? "Opening secure sign-in…" : `Sign in with ${provider.label}`}
        </button>
        {error ? (
          <p
            className="mt-4 rounded-lg border border-red-500/30 bg-red-950/40 p-3 text-sm leading-5 text-red-200"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setLocation(`${basePath}/sign-in`)}
          className="mt-4 w-full rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-primary/50 hover:bg-slate-800"
        >
          Use another SafeNet sign-in option
        </button>
      </div>
    </div>
  );
}

function AppLockRecoveryCompletePage() {
  const { isLoaded, isSignedIn } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const nonce = searchParams.get("recovery_nonce") || "";
  const returnUri = searchParams.get("return_uri") || "";
  const [state, setState] = useState<"waiting" | "working" | "error">("waiting");
  const [message, setMessage] = useState("Preparing the secure Android handoff…");
  const [redirectUri, setRedirectUri] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (!isLoaded || started.current) return;
    if (!isSignedIn) {
      setState("error");
      setMessage("SafeNet sign-in did not complete. Return to the sign-in page and try again.");
      return;
    }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(nonce) || returnUri !== APP_LOCK_RETURN_URI) {
      setState("error");
      setMessage("This App Lock recovery link is invalid or expired.");
      return;
    }
    started.current = true;
    setState("working");
    void (async () => {
      try {
        const response = await apiFetch("/api/app-lock/recovery/handoff/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nonce, returnUri }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || typeof result.redirectUri !== "string") {
          throw new Error(result.message || "SafeNet could not prepare the Android handoff.");
        }
        setRedirectUri(result.redirectUri);
        setMessage("Account verified. Returning to SafeNet…");
        window.location.assign(result.redirectUri);
      } catch (error) {
        setState("error");
        setMessage(error instanceof Error ? error.message : "SafeNet could not complete recovery.");
      }
    })();
  }, [isLoaded, isSignedIn, nonce, returnUri]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-primary/20 bg-slate-900/90 p-6 text-center shadow-2xl shadow-primary/10">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-primary">
          SAFENET / APP LOCK RECOVERY
        </p>
        <h1 className="mt-3 text-2xl font-bold text-white">
          {state === "error" ? "Recovery needs attention" : "Returning to SafeNet"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{message}</p>
        {state === "error" ? (
          <a
            href={`${basePath}/sign-in`}
            className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500"
          >
            Return to SafeNet sign-in
          </a>
        ) : redirectUri ? (
          <a
            href={redirectUri}
            className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500"
          >
            Open SafeNet
          </a>
        ) : null}
      </div>
    </div>
  );
}

function SignInSsoCallbackPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 text-sm text-slate-300">
      <AuthenticateWithRedirectCallback />
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
    headerTitle: "!mt-2 !leading-tight text-white",
    headerSubtitle: "!mt-1 text-slate-300",
    socialButtonsBlockButtonText: "text-white",
    formFieldLabel: "text-slate-200",
    footerActionLink: "text-red-400 hover:text-red-300",
    footerActionText: "text-slate-300",
    dividerText: "text-slate-400",
    identityPreviewEditButton: "text-red-400",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-red-200",
    header: "!pt-6 !pb-2",
    logoBox: "rounded-lg !mx-auto !mb-4 !h-16 !w-16 !overflow-hidden",
    logoImage: "rounded-lg !h-16 !w-16 !object-contain",
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

  useEffect(() => {
    const tileWindow = window as Window & {
      __safenetHandleTailscaleTileToggle?: () => void;
      __safenetTailscaleTileTogglePending?: boolean;
      __safenetHandleSmsCompose?: (recipient: string, body: string) => void;
      __safenetPendingSmsCompose?: { recipient: string; body: string };
    };
    const handleTailscaleTileToggle = () => {
      tileWindow.__safenetTailscaleTileTogglePending = true;
      setLocation("/");
      window.dispatchEvent(new Event("safenet:tailscale-tile-toggle"));
    };
    tileWindow.__safenetHandleTailscaleTileToggle = handleTailscaleTileToggle;
    const handleSmsCompose = (recipient: string, body: string) => {
      tileWindow.__safenetPendingSmsCompose = { recipient, body };
      setLocation("/spam-call-blocker");
      window.dispatchEvent(new CustomEvent("safenet:sms-compose", {
        detail: { recipient, body },
      }));
    };
    tileWindow.__safenetHandleSmsCompose = handleSmsCompose;
    return () => {
      if (tileWindow.__safenetHandleTailscaleTileToggle === handleTailscaleTileToggle) {
        delete tileWindow.__safenetHandleTailscaleTileToggle;
      }
      if (tileWindow.__safenetHandleSmsCompose === handleSmsCompose) {
        delete tileWindow.__safenetHandleSmsCompose;
      }
    };
  }, [setLocation]);

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
          <Route
            path="/sign-in/app-lock-recovery-complete"
            component={AppLockRecoveryCompletePage}
          />
          <Route path="/sign-in/sso-callback" component={SignInSsoCallbackPage} />
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
