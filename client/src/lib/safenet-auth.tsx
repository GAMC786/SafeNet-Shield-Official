import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { apiFetch, setAuthTokenProvider } from "./api";

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
const audience = window.__SAFENET_RUNTIME_CONFIG__?.auth0Audience ?? "";

export function SafeNetAuthProvider({ children }: PropsWithChildren) {
  const { isLoading, isAuthenticated, user: auth0User, getAccessTokenSilently, logout } = useAuth0();
  const [canonicalUserId, setCanonicalUserId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);

  useEffect(() => {
    setAuthTokenProvider(async () => {
      if (!isAuthenticated) return undefined;
      return getAccessTokenSilently({ authorizationParams: { audience } });
    });
    return () => setAuthTokenProvider(null);
  }, [getAccessTokenSilently, isAuthenticated]);

  useEffect(() => {
    let cancelled = false;
    setIdentityLoaded(false);
    setCanonicalUserId(null);
    setLinkError(null);
    if (!isAuthenticated) {
      setIdentityLoaded(!isLoading);
      return () => { cancelled = true; };
    }
    void apiFetch("/api/auth/session")
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
  }, [isAuthenticated, isLoading]);

  const value = useMemo<SafeNetAuthState>(() => {
    const userId = isAuthenticated ? canonicalUserId ?? auth0User?.sub ?? null : null;
    const fullName = auth0User?.name?.trim().split(/\s+/) ?? [];
    return {
      isLoaded: !isLoading && identityLoaded,
      isSignedIn: isAuthenticated && Boolean(userId) && !linkError,
      userId,
      user: userId ? {
        id: userId,
        email: auth0User?.email ?? null,
        firstName: auth0User?.given_name ?? fullName[0] ?? null,
        lastName: auth0User?.family_name ?? (fullName.slice(1).join(" ") || null),
      } : null,
      error: linkError,
      signOut: async () => {
        const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
        await logout({ logoutParams: { returnTo: `${window.location.origin}${basePath}/` } });
      },
    };
  }, [auth0User, canonicalUserId, identityLoaded, isAuthenticated, isLoading, linkError, logout]);

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

