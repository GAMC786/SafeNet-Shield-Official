import { useEffect, useRef, useState } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
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
import { betterAuthClient } from "./lib/better-auth-client";
import { isNativeAndroid, removeNativeAuthValue, setNativeAuthValue, getNativeAuthValue } from "./lib/native-auth-storage";

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
const auth0Domain = runtimeConfig?.auth0Domain ?? "";
const auth0ClientId = runtimeConfig?.auth0ClientId ?? "";
const auth0Audience = runtimeConfig?.auth0Audience ?? "";
const auth0RedirectUri = Capacitor.getPlatform() === "android"
  ? "safenet://auth/callback"
  : `${window.location.origin}${basePath}/auth/callback`;

function base64Url(value: ArrayBuffer) {
  const binary = Array.from(new Uint8Array(value), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function startAndroidBetterAuth(returnTo = "/") {
  const random = crypto.getRandomValues(new Uint8Array(64));
  const verifier = base64Url(random.buffer);
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const codeChallenge = base64Url(digest);
  const response = await apiFetch("/api/mobile-auth/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, codeChallenge, returnTo }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.browserUrl !== "string" || typeof result.challengeId !== "string") {
    throw new Error(result.message || "SafeNet could not start secure Android sign-in.");
  }
  await setNativeAuthValue("pkce_state", state);
  await setNativeAuthValue("pkce_verifier", verifier);
  await setNativeAuthValue("mobile_auth_challenge", result.challengeId);
  await Browser.open({ url: result.browserUrl });
}

function mobileFinishUrl(id: string, state: string) {
  const url = new URL("/api/mobile-auth/finish", window.location.origin);
  url.searchParams.set("id", id);
  url.searchParams.set("state", state);
  return url.toString();
}

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
  const { loginWithRedirect } = useAuth0();
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
  const mobileAuthId = searchParams.get("mobile_auth_id") || "";
  const mobileAuthState = searchParams.get("state") || "";
  const finishUrl = /^[0-9a-f-]{36}$/i.test(mobileAuthId) &&
    /^[A-Za-z0-9_-]{32,128}$/.test(mobileAuthState)
      ? mobileFinishUrl(mobileAuthId, mobileAuthState)
      : "";
  const isRecovery = /^[A-Za-z0-9_-]{32,128}$/.test(recoveryNonce) &&
    recoveryReturnUri === APP_LOCK_RETURN_URI;
  const returnTo = isRecovery
    ? `${basePath}/sign-in/app-lock-recovery-complete?recovery_nonce=${encodeURIComponent(recoveryNonce)}&return_uri=${encodeURIComponent(APP_LOCK_RETURN_URI)}`
    : redirectUrl || `${basePath}/`;

  const signInWithGoogle = async () => {
    if (isAndroidNative) {
      setError("Android sign-in is being connected. Use web sign-in for now.");
      return;
    }
    setIsWorking(true);
    setError("");
    try {
      const result = await betterAuthClient.signIn.social({
        provider: "google",
        callbackURL: finishUrl || returnTo,
      });
      if (result.error) throw new Error(result.error.message || "Google sign-in could not start.");
      if (result.data?.url) window.location.assign(result.data.url);
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
      if (isAndroidNative) {
        await startAndroidBetterAuth(returnTo);
        return;
      }
      const result = await betterAuthClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (result.error) throw new Error(result.error.message || "Email sign-in could not complete.");
      if (finishUrl) window.location.assign(finishUrl);
      else setLocation(returnTo);
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
      const result = await betterAuthClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: `${window.location.origin}${basePath}/reset-password`,
      });
      if (result.error) throw new Error(result.error.message || "Password recovery could not start.");
      setResetMessage("If the account exists, recovery instructions will be sent.");
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
        {!isAndroidNative && runtimeConfig?.googleEnabled ? <button
          type="button"
          onClick={() => void signInWithGoogle()}
          disabled={isWorking}
          className="mb-5 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-primary/50 hover:bg-slate-700 disabled:opacity-60"
        >
          Continue with Google
        </button> : null}
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
          {!isAndroidNative ? <label className="block text-sm text-slate-200">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white"
            />
          </label> : null}
          {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
          <button
            type="submit"
            disabled={isWorking}
            className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:opacity-60"
          >
            {isWorking ? "Signing in…" : isAndroidNative ? "Continue securely" : "Sign in with email"}
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
        <button
          type="button"
          onClick={() => void loginWithRedirect({
            appState: { returnTo },
            authorizationParams: { audience: auth0Audience, redirect_uri: auth0RedirectUri },
            ...(isAndroidNative ? { openUrl: async (url: string) => { await Browser.open({ url }); } } : {}),
          })}
          className="mt-3 w-full text-xs text-slate-500 underline"
        >
          Use existing Auth0 sign-in during the transition
        </button>
        {resetMessage ? <p role="status" className="mt-2 text-sm text-emerald-300">{resetMessage}</p> : null}
        <button
          type="button"
          onClick={() => setLocation(finishUrl
            ? `${basePath}/sign-up?mobile_auth_id=${encodeURIComponent(mobileAuthId)}&state=${encodeURIComponent(mobileAuthState)}`
            : authPathWithRedirect(`${basePath}/sign-up`, redirectUrl))}
          className="mt-4 w-full text-sm text-red-300 hover:text-red-200"
        >
          Create a SafeNet account
        </button>
      </div>
    </div>
  );
}

function Auth0CallbackPage() {
  const [, setLocation] = useLocation();
  const { isLoading, isAuthenticated } = useAuth0();
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const providerError = params.get("error_description") || params.get("error");
    if (providerError) {
      setError(providerError);
      return;
    }
    if (!isLoading && isAuthenticated) setLocation(`${basePath}/`);
  }, [isAuthenticated, isLoading, setLocation]);

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
  return <Auth0CallbackPage />;
}

function SignUpPage() {
  const [, setLocation] = useLocation();
  const { loginWithRedirect } = useAuth0();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const searchParams = new URLSearchParams(window.location.search);
  const redirectUrl = getSafeAuthRedirect(window.location.search);
  const isAndroidNative = Capacitor.getPlatform() === "android";
  const mobileAuthId = searchParams.get("mobile_auth_id") || "";
  const mobileAuthState = searchParams.get("state") || "";
  const finishUrl = /^[0-9a-f-]{36}$/i.test(mobileAuthId) &&
    /^[A-Za-z0-9_-]{32,128}$/.test(mobileAuthState)
      ? mobileFinishUrl(mobileAuthId, mobileAuthState)
      : "";

  const submit = async () => {
    setIsWorking(true);
    setError("");
    try {
      if (isAndroidNative) {
        await loginWithRedirect({
          appState: { returnTo: redirectUrl || "/" },
          authorizationParams: {
            audience: auth0Audience,
            screen_hint: "signup",
            redirect_uri: auth0RedirectUri,
          },
          openUrl: async (url: string) => { await Browser.open({ url }); },
        });
        return;
      }
      const result = await betterAuthClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL: finishUrl || redirectUrl || `${basePath}/`,
      });
      if (result.error) throw new Error(result.error.message || "Account creation could not complete.");
      setMessage("Check your email to verify your SafeNet account before signing in.");
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
          onClick={() => setLocation(finishUrl
            ? `${basePath}/sign-in?mobile_auth_id=${encodeURIComponent(mobileAuthId)}&state=${encodeURIComponent(mobileAuthState)}&redirect_url=${encodeURIComponent(redirectUrl || "/")}`
            : authPathWithRedirect(`${basePath}/sign-in`, redirectUrl))}
        />
        <h1 className="mb-5 text-2xl font-bold text-white">Create your SafeNet account</h1>
        {isAndroidNative ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Android account creation still uses SafeNet’s existing secure browser sign-in while the Better Auth handoff is being completed.
            </p>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={isWorking}
              className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              Continue in secure browser
            </button>
          </div>
        ) : <div className="space-y-4">
          {message ? <p role="status" className="text-sm text-emerald-300">{message}</p> : null}
          {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
          <label className="block text-sm text-slate-200">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-slate-200">
            Email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-slate-200">
            Password
            <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" />
          </label>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={isWorking}
            className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isWorking ? "Creating account…" : "Create account"}
          </button>
        </div>}
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
  const token = new URLSearchParams(window.location.search).get("token") || "";

  const submit = async () => {
    setIsWorking(true);
    setError("");
    setMessage("");
    try {
      if (!token) throw new Error("This password reset link is missing or expired.");
      const result = await betterAuthClient.resetPassword({ newPassword: password, token });
      if (result.error) throw new Error(result.error.message || "Password could not be reset.");
      setMessage("Your password was updated. You can now sign in.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Password could not be reset.");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-[440px] rounded-2xl border border-primary/20 bg-slate-900/90 p-6">
        <h1 className="mb-3 text-2xl font-bold text-white">Password recovery</h1>
        <p className="text-sm text-slate-300">Choose a new password for your SafeNet account.</p>
        {message ? <p role="status" className="mt-3 text-sm text-emerald-300">{message}</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
        <label className="mt-4 block text-sm text-slate-200">
          New password
          <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white" />
        </label>
        <button type="button" onClick={() => void submit()} disabled={isWorking || !token} className="mt-4 w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {isWorking ? "Updating…" : "Update password"}
        </button>
        <button type="button" onClick={() => setLocation(`${basePath}/sign-in`)} className="mt-4 w-full text-sm text-slate-300">
          Return to sign in
        </button>
      </div>
    </div>
  );
}

function AuthQueryClientCacheInvalidator() {
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

function Auth0NativeCallbackListener() {
  const [, setLocation] = useLocation();
  const { handleRedirectCallback } = useAuth0();

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;

    let disposed = false;
    let handledCallbackUrl: string | undefined;
    let listener: PluginListenerHandle | undefined;

    const forwardCallback = async (callbackUrl?: string) => {
      if (!callbackUrl || callbackUrl === handledCallbackUrl) return;
      let callback: URL;
      try {
        callback = new URL(callbackUrl);
      } catch {
        return;
      }
      if (
        callback.protocol !== "safenet:" ||
        callback.hostname !== "auth" ||
        callback.pathname !== "/callback"
      ) return;
      handledCallbackUrl = callbackUrl;
      try {
        const code = callback.searchParams.get("code");
        const state = callback.searchParams.get("state");
        if (code && state) {
          const [expectedState, verifier] = await Promise.all([
            getNativeAuthValue("pkce_state"),
            getNativeAuthValue("pkce_verifier"),
          ]);
          if (!expectedState || state !== expectedState || !verifier) {
            throw new Error("The Android sign-in response did not match its request.");
          }
          const response = await apiFetch("/api/mobile-auth/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, state, verifier }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || typeof result.accessToken !== "string") {
            throw new Error(result.message || "SafeNet could not finish Android sign-in.");
          }
          await setNativeAuthValue("better_auth_token", result.accessToken);
          await Promise.all([
            removeNativeAuthValue("pkce_state"),
            removeNativeAuthValue("pkce_verifier"),
            removeNativeAuthValue("mobile_auth_challenge"),
          ]);
          await Browser.close().catch(() => undefined);
          const returnTo = typeof result.returnTo === "string" &&
            result.returnTo.startsWith("/") && !result.returnTo.startsWith("//")
              ? result.returnTo
              : "/";
          window.location.replace(returnTo);
          return;
        }
        const result = await handleRedirectCallback(callbackUrl);
        const requestedReturn = result.appState?.returnTo || "/";
        const safeReturn = getSafeAuthRedirect(
          `?redirect_url=${encodeURIComponent(requestedReturn)}`,
        ) || "/";
        setLocation(safeReturn);
      } catch (error) {
        console.error("Unable to complete the Auth0 Android sign-in callback.", error);
        setLocation("/sign-in");
      } finally {
        void Browser.close().catch(() => undefined);
      }
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
      console.error("Unable to register the Android Auth0 callback listener.", error);
    });

    void CapacitorApp.getLaunchUrl()
      .then((launch) => forwardCallback(launch?.url))
      .catch(() => undefined);

    return () => {
      disposed = true;
      void listener?.remove();
    };
  }, [handleRedirectCallback, setLocation]);

  return null;
}

function Auth0ProviderWithRoutes() {
  const [, setLocation] = useLocation();

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
    <Auth0Provider
      domain={auth0Domain}
      clientId={auth0ClientId}
      cacheLocation="localstorage"
      useRefreshTokens
      authorizationParams={{
        audience: auth0Audience,
        redirect_uri: auth0RedirectUri,
        scope: "openid profile email",
      }}
      onRedirectCallback={(appState) => setLocation(stripBase(appState?.returnTo || "/"))}
    >
      <SafeNetAuthProvider>
        <QueryClientProvider client={queryClient}>
          <Auth0NativeCallbackListener />
          <AuthQueryClientCacheInvalidator />
          <Switch>
            <Route
              path="/sign-in/app-lock-recovery-complete"
              component={AppLockRecoveryCompletePage}
            />
            <Route path="/auth/callback" component={Auth0CallbackPage} />
            <Route path="/reset-password" component={ResetPasswordPage} />
            <Route path="/sign-in/sso-callback" component={SignInSsoCallbackPage} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={AppContent} />
          </Switch>
          <Toaster />
        </QueryClientProvider>
      </SafeNetAuthProvider>
    </Auth0Provider>
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
          <Auth0ProviderWithRoutes />
        </WouterRouter>
      </ThemeProvider>
    </Sentry.ErrorBoundary>
  );
}

export default App;
