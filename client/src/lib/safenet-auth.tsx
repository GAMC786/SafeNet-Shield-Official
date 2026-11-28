import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { apiFetch } from "./api";
import { betterAuthClient } from "./better-auth-client";
import { setAuthTokenProvider } from "./api";

type SafeNetUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

type SafeNetAuthState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  user: SafeNetUser | null;
  error: string | null;
  signOut: () => Promise<void>;
};

const SafeNetAuthContext = createContext<SafeNetAuthState | null>(null);
export function SafeNetAuthProvider({ children }: PropsWithChildren) {
  const { data: session, isPending: isLoading } = betterAuthClient.useSession();
  const legacyAuth = useAuth0();
  const audience = window.__SAFENET_RUNTIME_CONFIG__?.auth0Audience ?? "";
  const [canonicalUserId, setCanonicalUserId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const isAuthenticated = Boolean(session?.user) || legacyAuth.isAuthenticated;

  useEffect(() => {
    setAuthTokenProvider(async () => {
      if (!legacyAuth.isAuthenticated) return undefined;
      return legacyAuth.getAccessTokenSilently({ authorizationParams: { audience } });
    });
    return () => setAuthTokenProvider(null);
  }, [audience, legacyAuth.getAccessTokenSilently, legacyAuth.isAuthenticated]);

  useEffect(() => {
    let cancelled = false;
    setIdentityLoaded(false);
    setCanonicalUserId(null);
    setLinkError(null);
    if (!isAuthenticated) {
      setIdentityLoaded(!isLoading && !legacyAuth.isLoading);
      return () => { cancelled = true; };
    }
    void apiFetch("/api/safenet/auth/session")
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok || typeof result.userId !== "string") {
          throw new Error(result.message || "SafeNet could not link this account.");
        }
        if (!cancelled) setCanonicalUserId(result.userId);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLinkError(error instanceof Error ? error.message : "SafeNet could not link this account.");
      })
      .finally(() => {
        if (!cancelled) setIdentityLoaded(true);
      });
    return () => { cancelled = true; };
  }, [isAuthenticated, isLoading, legacyAuth.isLoading]);

  const value = useMemo<SafeNetAuthState>(() => {
    const authUser = session?.user;
    const legacyUser = legacyAuth.user;
    const userId = isAuthenticated
      ? canonicalUserId ?? authUser?.id ?? legacyUser?.sub ?? null
      : null;
    const fullName = (authUser?.name ?? legacyUser?.name)?.trim().split(/\s+/) ?? [];
    return {
      isLoaded: !isLoading && !legacyAuth.isLoading && identityLoaded,
      isSignedIn: isAuthenticated && Boolean(userId) && !linkError,
      userId,
      user: userId ? {
        id: userId,
        email: authUser?.email ?? legacyUser?.email ?? null,
        firstName: legacyUser?.given_name ?? fullName[0] ?? null,
        lastName: legacyUser?.family_name ?? (fullName.slice(1).join(" ") || null),
      } : null,
      error: linkError,
      signOut: async () => {
        if (authUser) await betterAuthClient.signOut();
        if (legacyAuth.isAuthenticated) {
          const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
          await legacyAuth.logout({ logoutParams: { returnTo: `${window.location.origin}${basePath}/` } });
        }
      },
    };
  }, [session, legacyAuth, canonicalUserId, identityLoaded, isAuthenticated, isLoading, linkError]);

  return <SafeNetAuthContext.Provider value={value}>{children}</SafeNetAuthContext.Provider>;
}

export function useSafeNetAuth() {
  const value = useContext(SafeNetAuthContext);
  if (!value) throw new Error("useSafeNetAuth must be used inside SafeNetAuthProvider.");
  return value;
}

export function useSafeNetUser() {
  const { isLoaded, isSignedIn, user } = useSafeNetAuth();
  return { isLoaded, isSignedIn, user };
}

