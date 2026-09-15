import { useEffect, useState } from "react";
import { CreditCard, ShieldCheck } from "lucide-react";
import { useUser } from "@clerk/react";
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

export default function Billing() {
  const { isLoaded, isSignedIn, user } = useUser();
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const { toast } = useToast();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setBillingStatus(null);
      return;
    }

    let cancelled = false;
    setIsLoadingStatus(true);
    void fetch("/api/billing/status", { credentials: "include" })
      .then(async (response) => {
        const payload = await response.json() as BillingStatus | { message?: string };
        if (!response.ok) {
          throw new Error("message" in payload ? payload.message : undefined);
        }
        if (!cancelled) {
          setBillingStatus(payload as BillingStatus);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          toast({
            title: "Billing status unavailable",
            description: error instanceof Error ? error.message : "Unable to load your subscription.",
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
  }, [isLoaded, isSignedIn, toast]);

  const postBillingAction = async (
    path: string,
    setLoading: (value: boolean) => void,
  ) => {
    setLoading(true);
    try {
      const response = await fetch(path, {
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
        description: error instanceof Error ? error.message : "Unable to contact Stripe.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const openSignIn = () => {
    window.location.assign(`${basePath}/sign-in?redirect_url=${encodeURIComponent(`${basePath}/billing`)}`);
  };

  return (
    <div className="space-y-6">
      <Header title="SafeNet Premium" subtitle="Shield DNS Server+ subscription" />

      <CyberCard className="border-primary/30 bg-primary/5">
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
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sign in before starting a trial or managing an existing subscription.
              </p>
              <Button type="button" onClick={openSignIn}>
                Sign in to continue
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
                <p className="text-muted-foreground">Signed in as</p>
                <p className="font-medium text-white">
                  {user.primaryEmailAddress?.emailAddress ?? user.username ?? user.id}
                </p>
              </div>
              {isLoadingStatus ? (
                <p className="text-sm text-muted-foreground">Checking subscription status…</p>
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
                  {isOpeningPortal ? "Opening portal…" : "Manage subscription"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </CyberCard>
    </div>
  );
}