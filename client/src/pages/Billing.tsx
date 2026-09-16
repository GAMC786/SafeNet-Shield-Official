import { useEffect, useState } from "react";
import { CreditCard, ExternalLink, Loader2, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useClerk, useUser } from "@clerk/react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type BillingStatus = {
  linked: boolean;
  hasEntitlement: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

const BILLING_REQUEST_TIMEOUT_MS = 12_000;

async function fetchBilling(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    BILLING_REQUEST_TIMEOUT_MS,
  );

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function billingErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The billing service took too long to respond. Check your connection and try again.";
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function Billing() {
  const { signOut } = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [billingStatusError, setBillingStatusError] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { toast } = useToast();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setBillingStatus(null);
      setBillingStatusError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingStatus(true);
    setBillingStatusError(null);
    void fetchBilling("/api/billing/status", { credentials: "include" })
      .then(async (response) => {
        const payload = await response.json() as BillingStatus | { message?: string };
        if (!response.ok) {
          throw new Error("message" in payload ? payload.message : undefined);
        }
        if (!cancelled) {
          setBillingStatus(payload as BillingStatus);
          setBillingStatusError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = billingErrorMessage(error, "Unable to load your subscription.");
          setBillingStatus(null);
          setBillingStatusError(message);
          toast({
            title: "Billing status unavailable",
            description: message,
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingStatus(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, statusAttempt, toast]);

  const postBillingAction = async (
    path: string,
    setLoading: (value: boolean) => void,
  ) => {
    setLoading(true);
    try {
      const response = await fetchBilling(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const payload = await response.json() as { url?: string; message?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.message || "The billing service could not complete this request.");
      }
      window.location.assign(payload.url);
    } catch (error) {
      toast({
        title: "Billing action failed",
        description: billingErrorMessage(error, "Unable to contact Stripe."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const openSignIn = () => {
    window.location.assign(`${basePath}/sign-in?redirect_url=${encodeURIComponent(`${basePath}/billing`)}`);
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      window.location.assign(`${basePath}/billing`);
    } catch (error) {
      toast({
        title: "Could not sign out",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSigningOut(false);
    }
  };

  const accountLabel = user?.primaryEmailAddress?.emailAddress ?? user?.username ?? user?.id;

  return (
    <div className="space-y-6">
      <Header title="SafeNet Premium" subtitle="Shield DNS Server+ subscription" />

      <CyberCard>
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/20 p-3">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">SafeNet Shield DNS Server+</h2>
                <p className="text-sm text-muted-foreground">CAD $5/month</p>
              </div>
            </div>
            <p className="max-w-xl text-sm text-muted-foreground">
              Start with a 7-day free trial through Stripe-hosted Checkout.
            </p>
          </div>
          <CreditCard className="hidden h-16 w-16 text-primary/30 md:block" />
        </div>
      </CyberCard>

      <CyberCard>
        <div className="max-w-xl space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Start or manage billing</h2>
            <p className="text-sm text-muted-foreground">
              Billing access is tied to your signed-in SafeNet account.
            </p>
          </div>
          {!isLoaded ? (
            <p className="text-sm text-muted-foreground">Loading your account…</p>
          ) : !isSignedIn ? (
            <div className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
                  <UserRound className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-white">Sign in to manage billing</p>
                  <p className="text-sm leading-5 text-muted-foreground">
                    Start your trial or open an existing subscription.
                  </p>
                </div>
              </div>
              <Button type="button" className="w-full shrink-0 sm:w-auto" onClick={openSignIn}>
                Sign in to continue
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10">
                    <UserRound className="h-5 w-5 text-emerald-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Signed in as
                    </p>
                    <p className="truncate font-medium text-white">{accountLabel}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full shrink-0 sm:w-auto"
                  disabled={isSigningOut}
                  onClick={() => void handleSignOut()}
                >
                  {isSigningOut ? <Loader2 className="animate-spin" /> : <LogOut />}
                  {isSigningOut ? "Signing out…" : "Sign out"}
                </Button>
              </div>
              {isLoadingStatus ? (
                <p className="text-sm text-muted-foreground">Checking subscription status…</p>
              ) : billingStatusError ? (
                <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-red-200">{billingStatusError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full shrink-0 sm:w-auto"
                    onClick={() => setStatusAttempt((attempt) => attempt + 1)}
                  >
                    Try again
                  </Button>
                </div>
              ) : billingStatus?.hasEntitlement ? (
                <p className="text-sm text-emerald-400">
                  SafeNet Shield DNS Server+ is active
                  {billingStatus.cancelAtPeriodEnd ? " and will end at the current period." : "."}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No active SafeNet subscription is linked to this account.
                </p>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  disabled={isStartingCheckout}
                  onClick={() => void postBillingAction("/api/billing/checkout", setIsStartingCheckout)}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  {isStartingCheckout ? "Opening Stripe…" : "Start free trial"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isOpeningPortal || !billingStatus?.linked}
                  onClick={() => void postBillingAction("/api/billing/portal", setIsOpeningPortal)}
                >
                  {isOpeningPortal ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                  {isOpeningPortal ? "Opening portal…" : "Manage subscription"}
                </Button>
              </div>
              {!billingStatus?.linked && !isLoadingStatus && (
                <p className="text-xs text-muted-foreground">
                  Manage subscription becomes available after Stripe links your account.
                </p>
              )}
            </div>
          )}
        </div>
      </CyberCard>
    </div>
  );
}