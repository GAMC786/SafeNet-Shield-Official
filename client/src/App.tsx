import { useEffect, useRef, useState } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import {
  ClerkProvider,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { queryClient } from "./lib/queryClient";
import { SafeNetAuthProvider, useSafeNetAuth } from "./lib/safenet-auth";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { Navigation } from "@/components/Navigation";
import { SystemNavigation } from "@/components/Navigation";
import { NativeStatusBarThemeSync } from "@/components/NativeStatusBarThemeSync";
import { useFirewallConfig } from "@/hooks/use-firewall-config";
import * as Sentry from "@sentry/react";
import { captureGlitchTipException } from "./lib/glitchtip";
import { NetworkStatusBanner } from "@/components/NetworkStatusBanner";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ArrowLeft } from "lucide-react";
import { useCallback } from "react";
import { apiFetch } from "./lib/api";
import { Browser } from "@capacitor/browser";
import { supabase } from "./lib/supabase";

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
import SecureDialer from "@/pages/SecureDialer";
import NotFound from "@/pages/not-found";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const APP_LOCK_RETURN_URI = "safenet://app-lock/recovery";
const runtimeConfig = window.__SAFENET_RUNTIME_CONFIG__;
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  runtimeConfig?.clerkPublishableKey || import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const configuredClerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL as
  | string
  | undefined;
const nativeApiOrigin = import.meta.env.VITE_API_URL as string | undefined;
const clerkProxyUrl =
  runtimeConfig?.clerkProxyUrl?.trim() ||
  configuredClerkProxyUrl?.trim() ||
  (window.location.hostname === "localhost" && nativeApiOrigin?.trim()
    ? `${nativeApiOrigin.trim().replace(/\/+$/, "")}/api/__clerk`
    : undefined);

function stripBase(path: string) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function getSafeAuthRedirect(search: string) {
  const requestedRedirect = new URLSearchParams(search).get("redirect_url");
  if (!requestedRedirect) return undefined;

  try {
    const target = new URL(requestedRedirect, window.location.origin);
    if (
      target.origin !== window.location.origin ||
      (basePath && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`)) ||
      target.pathname.startsWith("//")
    ) {
      return undefined;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return undefined;
  }
}

function authPathWithRedirect(path: string, redirectUrl?: string) {
  return redirectUrl
    ? `${path}?redirect_url=${encodeURIComponent(redirectUrl)}`
    : path;
}

function getSupabaseCallbackUrl(returnTo: string) {
  const isAndroidNative = Capacitor.getPlatform() === "android";
  const callback = isAndroidNative
    ? new URL("com.safenet.dns://callback")
    : new URL(`${basePath}/auth/callback`, window.location.origin);
  if (!isAndroidNative || returnTo !== `${basePath}/`) {
    callback.searchParams.set("return_to", returnTo);
  }
  return callback.toString();
}

function MainLayout() {
  const queryClient = useQueryClient();
  const refreshActivePage = useCallback(
    () => queryClient.refetchQueries({ type: "active" }).then(() => undefined),
    [queryClient],
  );

  return (
    <div className="flex h-screen min-h-0 h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <SystemNavigation />
      <Navigation />
      
      {/* Scanline Effect */}
      <div className="scan-line" />
      
      {/* Background Grid */}
      <div className="safenet-background-grid fixed inset-0 pointer-events-none z-[-1]" />

      <PullToRefresh
        className="safenet-main-content min-h-0 flex-1 w-full max-w-7xl mx-auto overflow-y-auto p-4 pb-24 pt-24 sm:p-6 sm:pb-24 sm:pt-28 lg:p-8 lg:pb-8 lg:pt-28"
        onRefresh={refreshActivePage}
      >
        <NetworkStatusBanner />
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
          <Route path="/secure-dialer" component={SecureDialer} />
          <Route path="/spam-call-blocker" component={SecureDialer} />
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

function AuthBackButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-slate-900/80 text-slate-200 shadow-lg transition-colors hover:border-primary/50 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

function SignInPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const searchParams = new URLSearchParams(window.location.search);
  const redirectUrl = getSafeAuthRedirect(window.location.search);
  const isAndroidNative = Capacitor.getPlatform() === "android";
  const recoveryNonce = searchParams.get("recovery_nonce") || "";
  const recoveryReturnUri = searchParams.get("return_uri") || "";
  const isRecovery = /^[A-Za-z0-9_-]{32,128}$/.test(recoveryNonce) &&
    recoveryReturnUri === APP_LOCK_RETURN_URI;
  const returnTo = isRecovery
    ? `${basePath}/sign-in/app-lock-recovery-complete?recovery_nonce=${encodeURIComponent(recoveryNonce)}&return_uri=${encodeURIComponent(APP_LOCK_RETURN_URI)}`
    : redirectUrl || `${basePath}/`;

  const signInWithGoogle = async () => {
    setIsWorking(true);
    setError("");
    try {
      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getSupabaseCallbackUrl(returnTo),
          skipBrowserRedirect: true,
        },
      });
      if (authError) throw authError;
      if (!data.url) throw new Error("Supabase did not return a Google sign-in URL.");
      if (isAndroidNative) {
        await Browser.open({ url: data.url });
      } else {
        window.location.assign(data.url);
      }
    } catch (authError) {
      setIsWorking(false);
      setError(authError instanceof Error ? authError.message : "Google sign-in could not start.");
    }
  };

  const signInWithEmail = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsWorking(true);
    setError("");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError(authError.message);
        return;
      }
      setLocation(returnTo);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Email sign-in could not complete.");
    } finally {
      setIsWorking(false);
    }
  };

  const sendPasswordReset = async () => {
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    setIsWorking(true);
    setError("");
    setResetMessage("");
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: getSupabaseCallbackUrl(`${basePath}/reset-password`) },
      );
      if (resetError) setError(resetError.message);
      else setResetMessage("Check your email for a password reset link.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Password reset could not start.");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-[440px] rounded-2xl border border-primary/20 bg-slate-900/90 p-6 shadow-2xl shadow-primary/10">
        <AuthBackButton
          label="Back to Premium billing"
          onClick={() => setLocation("/billing")}
        />
        <h1 className="mb-2 text-2xl font-bold text-white">Welcome back</h1>
        <p className="mb-6 text-sm text-slate-300">Sign in to manage your SafeNet account.</p>
        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          disabled={isWorking}
          className="mb-5 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-primary/50 hover:bg-slate-700 disabled:opacity-60"
        >
          Continue with Google
        </button>
        <div className="mb-5 flex items-center gap-3 text-xs text-slate-500">
          <span className="h-px flex-1 bg-slate-700" />
          <span>OR USE EMAIL</span>
          <span className="h-px flex-1 bg-slate-700" />
        </div>
        <form onSubmit={(event) => void signInWithEmail(event)} className="space-y-4">
          <label className="block text-sm text-slate-200">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
            />
          </label>
          <label className="block text-sm text-slate-200">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
            />
          </label>
          {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
          <button
            type="submit"
            disabled={isWorking}
            className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-60"
          >
            {isWorking ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => void sendPasswordReset()}
          disabled={isWorking}
          className="mt-4 w-full text-sm text-slate-300 hover:text-white disabled:opacity-60"
        >
          Forgot password?
        </button>
        {resetMessage ? <p role="status" className="mt-2 text-sm text-emerald-300">{resetMessage}</p> : null}
        <button
          type="button"
          onClick={() => setLocation(authPathWithRedirect(`${basePath}/sign-up`, redirectUrl))}
          className="mt-4 w-full text-sm text-red-300 hover:text-red-200"
        >
          Create a SafeNet account
        </button>
      </div>
    </div>
  );
}

function SupabaseAuthCallbackPage() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const returnTo = getSafeAuthRedirect(`?redirect_url=${encodeURIComponent(url.searchParams.get("return_to") || "/")}`) || "/";
    void (async () => {
      try {
        const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
        if (providerError) {
          setError(providerError);
          return;
        }
        const code = url.searchParams.get("code");
        if (!code) {
          setError("No sign-in code was returned. Start Google sign-in again from this browser.");
          return;
        }
        const { error: authError } = await supabase.auth.exchangeCodeForSession(code);
        if (authError) {
          setError(
            /flow state|code verifier/i.test(authError.message)
              ? "The sign-in started in a different browser session. Open SafeNet in this browser and try again."
              : authError.message,
          );
          return;
        }
        setLocation(returnTo);
      } catch (authError) {
        setError(authError instanceof Error ? authError.message : "Sign-in verification failed.");
      }
    })();
  }, [setLocation]);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-primary/20 bg-slate-900/90 p-6 text-center text-slate-200">
        <h1 className="text-xl font-semibold">Completing secure sign-in</h1>
        <p className="mt-3 text-sm">{error || "Please wait while SafeNet verifies your account…"}</p>
        {error ? <button className="mt-5 text-red-300" onClick={() => setLocation(`${basePath}/sign-in`)}>Return to sign in</button> : null}
      </div>
    </div>
  );
}

function AppLockRecoveryCompletePage() {
  const { isLoaded, isSignedIn } = useSafeNetAuth();
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
  return <SupabaseAuthCallbackPage />;
}

function SignUpPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const redirectUrl = getSafeAuthRedirect(window.location.search);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsWorking(true);
    setError("");
    try {
      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: getSupabaseCallbackUrl(`${basePath}/`),
        },
      });
      if (signupError) {
        setError(signupError.message);
        return;
      }
      if (data.session) {
        setLocation(redirectUrl || `${basePath}/`);
      } else {
        setMessage("Check your email for a confirmation link before signing in.");
      }
    } catch (signupError) {
      setError(signupError instanceof Error ? signupError.message : "Account creation could not complete.");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-[440px] rounded-2xl border border-primary/20 bg-slate-900/90 p-6">
        <AuthBackButton
          label="Back to SafeNet sign-in"
          onClick={() => setLocation(authPathWithRedirect(`${basePath}/sign-in`, redirectUrl))}
        />
        <h1 className="mb-5 text-2xl font-bold text-white">Create your SafeNet account</h1>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <label className="block text-sm text-slate-200">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
            />
          </label>
          <label className="block text-sm text-slate-200">
            Password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
            />
          </label>
          {message ? <p role="status" className="text-sm text-emerald-300">{message}</p> : null}
          {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
          <button
            type="submit"
            disabled={isWorking}
            className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isWorking ? "Creating account…" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsWorking(true);
    setError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setMessage("Password updated. You can continue using SafeNet.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Password could not be updated.");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-[440px] rounded-2xl border border-primary/20 bg-slate-900/90 p-6">
        <h1 className="mb-5 text-2xl font-bold text-white">Choose a new password</h1>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <label className="block text-sm text-slate-200">
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
            />
          </label>
          {message ? <p role="status" className="text-sm text-emerald-300">{message}</p> : null}
          {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
          <button type="submit" disabled={isWorking} className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {isWorking ? "Saving…" : "Update password"}
          </button>
        </form>
        <button type="button" onClick={() => setLocation(`${basePath}/`)} className="mt-4 w-full text-sm text-slate-300">
          Return to SafeNet
        </button>
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { userId } = useSafeNetAuth();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (previousUserId.current !== undefined && previousUserId.current !== userId) {
      queryClient.clear();
    }
    previousUserId.current = userId;
  }, [queryClient, userId]);

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
    if (Capacitor.getPlatform() !== "android") return;

    let disposed = false;
    let handledCallbackUrl: string | undefined;
    let listener: PluginListenerHandle | undefined;

    const forwardCallback = (callbackUrl?: string) => {
      if (!callbackUrl || callbackUrl === handledCallbackUrl) return;
      let callback: URL;
      try {
        callback = new URL(callbackUrl);
      } catch {
        return;
      }
      if (
        callback.protocol !== "com.safenet.dns:" ||
        callback.hostname !== "callback" ||
        callback.pathname !== ""
      ) return;
      handledCallbackUrl = callbackUrl;
      const code = callback.searchParams.get("code");
      if (!code) {
        setLocation("/sign-in");
        return;
      }
      void supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          console.error("Unable to complete the Supabase Android sign-in callback.", error);
          setLocation("/sign-in");
          return;
        }
        const requestedReturn = callback.searchParams.get("return_to") || "/";
        const safeReturn = getSafeAuthRedirect(
          `?redirect_url=${encodeURIComponent(requestedReturn)}`,
        ) || "/";
        setLocation(safeReturn);
      }).catch((error: unknown) => {
        console.error("Unable to complete the Supabase Android sign-in callback.", error);
        setLocation("/sign-in");
      }).finally(() => {
        void Browser.close().catch(() => undefined);
      });
    };

    void CapacitorApp.addListener("appUrlOpen", ({ url }) => {
      forwardCallback(url);
    }).then((registeredListener) => {
      if (disposed) {
        void registeredListener.remove();
      } else {
        listener = registeredListener;
      }
    }).catch((error: unknown) => {
      console.error("Unable to register the Android Supabase callback listener.", error);
    });

    void CapacitorApp.getLaunchUrl()
      .then((launch) => forwardCallback(launch?.url))
      .catch(() => undefined);

    return () => {
      disposed = true;
      void listener?.remove();
    };
  }, []);

  useEffect(() => {
    const tileWindow = window as Window & {
      __safenetHandleSmsCompose?: (recipient: string, body: string) => void;
      __safenetPendingSmsCompose?: { recipient: string; body: string };
    };
    const handleSmsCompose = (recipient: string, body: string) => {
      tileWindow.__safenetPendingSmsCompose = { recipient, body };
      setLocation("/spam-call-blocker");
      window.dispatchEvent(new CustomEvent("safenet:sms-compose", {
        detail: { recipient, body },
      }));
    };
    tileWindow.__safenetHandleSmsCompose = handleSmsCompose;
    return () => {
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
      <SafeNetAuthProvider>
        <QueryClientProvider client={queryClient}>
          <ClerkQueryClientCacheInvalidator />
          <Switch>
            <Route
              path="/sign-in/app-lock-recovery-complete"
              component={AppLockRecoveryCompletePage}
            />
            <Route path="/auth/callback" component={SupabaseAuthCallbackPage} />
            <Route path="/reset-password" component={ResetPasswordPage} />
            <Route path="/sign-in/sso-callback" component={SignInSsoCallbackPage} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={AppContent} />
          </Switch>
          <Toaster />
        </QueryClientProvider>
      </SafeNetAuthProvider>
    </ClerkProvider>
  );
}

function App() {
  useEffect(() => {
    window.localStorage.removeItem("safenet-color-mode");
  }, []);

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
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem={false}
        storageKey="safenet-theme"
      >
        <NativeStatusBarThemeSync />
        <WouterRouter base={basePath}>
          <ClerkProviderWithRoutes />
        </WouterRouter>
      </ThemeProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
