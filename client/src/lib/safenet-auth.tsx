import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useAuth as useClerkAuth, useClerk, useUser as useClerkUser } from "@clerk/react";
import type { Session } from "@supabase/supabase-js";
import { apiFetch } from "./api";
import { supabase } from "./supabase";

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
  const clerkAuth = useClerkAuth();
  const clerk = useClerk();
  const { user: clerkUser } = useClerkUser();
  const [session, setSession] = useState<Session | null>(null);
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setSessionLoaded(true);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionLoaded(true);
      setSupabaseUserId(null);
      setLinkError(null);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setSupabaseUserId(null);
      setLinkError(null);
      return () => {
        cancelled = true;
      };
    }
    void apiFetch("/api/auth/session")
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok || typeof result.userId !== "string") {
          throw new Error(result.message || "SafeNet could not link this account.");
        }
        if (!cancelled) setSupabaseUserId(result.userId);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLinkError(error instanceof Error ? error.message : "SafeNet could not link this account.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const value = useMemo<SafeNetAuthState>(() => {
    const hasSupabaseSession = Boolean(session);
    const userId = hasSupabaseSession ? supabaseUserId : clerkAuth.userId ?? null;
    const email = session?.user.email ?? clerkUser?.primaryEmailAddress?.emailAddress ?? null;
    const metadataName = session?.user.user_metadata?.full_name;
    const [firstName, ...lastParts] =
      typeof metadataName === "string" ? metadataName.trim().split(/\s+/) : [];
    const user = userId
      ? {
          id: userId,
          email,
          firstName: firstName ?? clerkUser?.firstName ?? null,
          lastName: lastParts.join(" ") || clerkUser?.lastName || null,
        }
      : null;

    return {
      isLoaded: session
        ? sessionLoaded && (Boolean(supabaseUserId) || Boolean(linkError))
        : clerkAuth.isLoaded,
      isSignedIn: session ? Boolean(supabaseUserId) : Boolean(clerkAuth.isSignedIn),
      userId,
      user,
      error: linkError,
      signOut: async () => {
        await Promise.allSettled([supabase.auth.signOut(), clerk.signOut()]);
      },
    };
  }, [
    clerk,
    clerkAuth.isLoaded,
    clerkAuth.isSignedIn,
    clerkAuth.userId,
    clerkUser?.firstName,
    clerkUser?.lastName,
    clerkUser?.primaryEmailAddress?.emailAddress,
    linkError,
    session,
    sessionLoaded,
    supabaseUserId,
  ]);

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

export function useSafeNetClerk() {
  const { signOut } = useSafeNetAuth();
  return { signOut };
}
