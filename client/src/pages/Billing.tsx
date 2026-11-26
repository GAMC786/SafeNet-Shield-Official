import { useEffect, useRef, useState } from "react";
import { CreditCard, ExternalLink, Loader2, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useLocation } from "wouter";
import { useSafeNetClerk as useClerk, useSafeNetUser as useUser } from "@/lib/safenet-auth";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { Purchases } from "@revenuecat/purchases-capacitor";
import type { CustomerInfo, PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type BillingStatus = {
  provider: "revenuecat";
  linked: boolean;
  hasEntitlement: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

const BILLING_REQUEST_TIMEOUT_MS = 12_000;
const CLERK_LOAD_TIMEOUT_MS = 12_000;
const CLERK_STALL_QUERY_PARAM = "billing_clerk_stall";
const CLERK_RETURN_REFRESH_QUERY_PARAM = "clerk_return_refresh";
const CLERK_RETURN_REFRESH_SESSION_KEY = "safenet:clerk-return-refresh";
const CLERK_RETURN_CACHE_BUST_PARAM = "clerk_session_reload";
const REVENUECAT_ANDROID_API_KEY = import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY as
  | string
  | undefined;
const REVENUECAT_ANDROID_PACKAGE_IDENTIFIER = "$rc_monthly";
const REVENUECAT_ANDROID_PRODUCT_IDENTIFIER = "premium_monthly:monthly";
const GOOGLE_PLAY_SUBSCRIPTIONS_URL = "https://play.google.com/store/account/subscriptions";
const REVENUECAT_ANONYMOUS_ID_PREFIX = "$RCAnonymousID:";

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

function isRevenueCatAnonymousId(appUserId: string) {
  return appUserId.startsWith(REVENUECAT_ANONYMOUS_ID_PREFIX);
}

export default function Billing() {
  const [, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [billingStatusError, setBillingStatusError] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [clerkLoadTimedOut, setClerkLoadTimedOut] = useState(false);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [isOpeningPlaySubscriptions, setIsOpeningPlaySubscriptions] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [nativePurchasesReady, setNativePurchasesReady] = useState(false);
  const [nativeIdentityReady, setNativeIdentityReady] = useState(false);
  const [nativeCustomerInfo, setNativeCustomerInfo] = useState<CustomerInfo | null>(null);
  const [nativeEntitlementIdentifier, setNativeEntitlementIdentifier] = useState("premium");
  const [nativePackage, setNativePackage] = useState<PurchasesPackage | null>(null);
  const [nativeBillingError, setNativeBillingError] = useState<string | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const { toast } = useToast();
  const clerkReturnRefreshTimeout = useRef<number | null>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const isAndroid = Capacitor.getPlatform() === "android";
  const clerkStartupStallRequested =
    isAndroid &&
    new URLSearchParams(window.location.search).get(CLERK_STALL_QUERY_PARAM) === "1";
  const clerkIsLoaded = isLoaded && !clerkStartupStallRequested;

  useEffect(() => {
    if (clerkIsLoaded) {
      setClerkLoadTimedOut(false);
      return;
    }

    const timeoutId = window.setTimeout(
      () => setClerkLoadTimedOut(true),
      CLERK_LOAD_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [clerkIsLoaded]);

  useEffect(() => {
    const returnUrl = new URL(window.location.href);
    if (returnUrl.searchParams.has(CLERK_RETURN_CACHE_BUST_PARAM)) {
      returnUrl.searchParams.delete(CLERK_RETURN_CACHE_BUST_PARAM);
      window.history.replaceState(
        window.history.state,
        "",
        `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`,
      );
      return;
    }

    let hasPendingAuthReturn = false;
    try {
      hasPendingAuthReturn =
        window.sessionStorage.getItem(CLERK_RETURN_REFRESH_SESSION_KEY) === "1";
    } catch {
      // The redirect query parameter below remains a fallback if storage is unavailable.
    }
    const hasAuthReturnMarker =
      returnUrl.searchParams.get(CLERK_RETURN_REFRESH_QUERY_PARAM) === "1";
    if (!hasPendingAuthReturn && !hasAuthReturnMarker) return;
    if (!clerkIsLoaded) return;

    returnUrl.searchParams.delete(CLERK_RETURN_REFRESH_QUERY_PARAM);
    const cleanUrl = `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;

    if (isSignedIn) {
      if (clerkReturnRefreshTimeout.current !== null) {
        window.clearTimeout(clerkReturnRefreshTimeout.current);
        clerkReturnRefreshTimeout.current = null;
      }
      try {
        window.sessionStorage.removeItem(CLERK_RETURN_REFRESH_SESSION_KEY);
      } catch {
        // The sign-in state is already available, so this cleanup is optional.
      }
      window.history.replaceState(window.history.state, "", cleanUrl);
      return;
    }

    if (clerkReturnRefreshTimeout.current !== null) return;

    // Give Clerk time to finish persisting the OAuth session before reloading.
    clerkReturnRefreshTimeout.current = window.setTimeout(() => {
      clerkReturnRefreshTimeout.current = null;
      try {
        window.sessionStorage.removeItem(CLERK_RETURN_REFRESH_SESSION_KEY);
      } catch {
        // The URL fallback still guarantees this reload is only attempted once.
      }
      const reloadUrl = new URL(cleanUrl, window.location.origin);
      reloadUrl.searchParams.set(CLERK_RETURN_CACHE_BUST_PARAM, String(Date.now()));
      window.location.replace(`${reloadUrl.pathname}${reloadUrl.search}${reloadUrl.hash}`);
    }, 1500);

    return () => {
      if (clerkReturnRefreshTimeout.current !== null) {
        window.clearTimeout(clerkReturnRefreshTimeout.current);
        clerkReturnRefreshTimeout.current = null;
      }
    };
  }, [clerkIsLoaded, isSignedIn]);

  useEffect(() => {
    if (!isAndroid) {
      setNativePurchasesReady(false);
      setNativeCustomerInfo(null);
      setNativePackage(null);
      setNativeBillingError(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      if (!REVENUECAT_ANDROID_API_KEY) {
        throw new Error("RevenueCat Android billing is not configured for this build.");
      }

      const configResponse = await fetchBilling("/api/billing/config", { cache: "no-store" });
      const billingConfig = await configResponse.json() as {
        configured?: boolean;
        entitlementIdentifier?: string;
      };
      if (!configResponse.ok || billingConfig.configured !== true || !billingConfig.entitlementIdentifier) {
        throw new Error("Google Play billing is not configured for SafeNet yet.");
      }

      const configured = await Purchases.isConfigured();
      if (!configured.isConfigured) {
        // Anonymous RevenueCat identity lets Android purchases work without Clerk.
        await Purchases.configure({ apiKey: REVENUECAT_ANDROID_API_KEY });
      }

      const [offerings, customerInfoResult] = await Promise.all([
        Purchases.getOfferings(),
        Purchases.getCustomerInfo(),
      ]);
      const appUser = await Purchases.getAppUserID();
      const monthlyPackage =
        offerings.current?.availablePackages.find(
          (candidate) =>
            candidate.identifier === REVENUECAT_ANDROID_PACKAGE_IDENTIFIER &&
            candidate.product.identifier === REVENUECAT_ANDROID_PRODUCT_IDENTIFIER,
        ) ??
        null;

      if (!cancelled) {
        setNativeCustomerInfo(customerInfoResult.customerInfo);
        setNativePackage(monthlyPackage);
        setNativePurchasesReady(true);
        setNativeIdentityReady(isRevenueCatAnonymousId(appUser.appUserID));
        setNativeEntitlementIdentifier(billingConfig.entitlementIdentifier);
        setNativeBillingError(
          monthlyPackage ? null : "RevenueCat has no active Android monthly offering yet.",
        );
      }
    })().catch((error) => {
      if (!cancelled) {
        setNativePurchasesReady(false);
        setNativeIdentityReady(false);
        setNativePackage(null);
        setNativeBillingError(
          billingErrorMessage(error, "Unable to load Google Play billing."),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isAndroid]);

  useEffect(() => {
    if (!isAndroid || !nativePurchasesReady) return;

    let cancelled = false;
    if (!clerkIsLoaded && !clerkLoadTimedOut) {
      void Purchases.getAppUserID().then(({ appUserID }) => {
        if (!cancelled) setNativeIdentityReady(isRevenueCatAnonymousId(appUserID));
      }).catch(() => {
        if (!cancelled) setNativeIdentityReady(false);
      });
      return () => {
        cancelled = true;
      };
    }

    setNativeIdentityReady(false);
    const currentClerkUserId = clerkIsLoaded && isSignedIn && user?.id ? user.id : null;
    void (async () => {
      const current = await Purchases.getAppUserID();
      if (currentClerkUserId && current.appUserID !== currentClerkUserId) {
        const result = await Purchases.logIn({ appUserID: currentClerkUserId });
        if (!cancelled) setNativeCustomerInfo(result.customerInfo);
      } else if (!currentClerkUserId && !isRevenueCatAnonymousId(current.appUserID)) {
        const result = await Purchases.logOut();
        if (!cancelled) setNativeCustomerInfo(result.customerInfo);
      }

      const info = await Purchases.getCustomerInfo();
      if (!cancelled) {
        setNativeCustomerInfo(info.customerInfo);
        setNativeIdentityReady(true);
        setNativeBillingError(null);
      }
    })().catch((error) => {
      if (!cancelled) {
        setNativeIdentityReady(false);
        setNativeBillingError(
          billingErrorMessage(error, "Unable to link your RevenueCat purchase history."),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [clerkIsLoaded, clerkLoadTimedOut, isAndroid, isSignedIn, nativePurchasesReady, user?.id]);

  useEffect(() => {
    if (!isAndroid || !nativePurchasesReady) return;

    const refreshCustomerInfo = () => {
      if (document.visibilityState !== "visible") return;
      void Purchases.getCustomerInfo()
        .then(({ customerInfo }) => setNativeCustomerInfo(customerInfo))
        .catch((error) => {
          setNativeBillingError(
            billingErrorMessage(error, "Unable to refresh your Google Play subscription."),
          );
        });
    };

    document.addEventListener("visibilitychange", refreshCustomerInfo);
    return () => document.removeEventListener("visibilitychange", refreshCustomerInfo);
  }, [isAndroid, nativePurchasesReady]);

  useEffect(() => {
    if (isAndroid) {
      setBillingStatus(null);
      setBillingStatusError(null);
      setIsLoadingStatus(false);
      return;
    }

    if (!clerkIsLoaded || !isSignedIn) {
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
  }, [clerkIsLoaded, isAndroid, isSignedIn, statusAttempt, toast]);

  const openManagementPortal = async () => {
    setIsOpeningPortal(true);
    try {
      const response = await fetchBilling("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const payload = await response.json() as { url?: string; message?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.message || "RevenueCat could not open subscription management.");
      }
      window.location.assign(payload.url);
    } catch (error) {
      toast({
        title: "Billing action failed",
        description: billingErrorMessage(error, "Unable to contact RevenueCat."),
        variant: "destructive",
      });
    } finally {
      setIsOpeningPortal(false);
    }
  };

  const purchaseNativePackage = async () => {
    if (!nativeIdentityReady || !nativePackage) return;
    setIsPurchasing(true);
    try {
      const result = await Purchases.purchasePackage({ aPackage: nativePackage });
      setNativeCustomerInfo(result.customerInfo);
      toast({
        title: "Subscription active",
        description: "Google Play confirmed your SafeNet Premium purchase.",
      });
    } catch (error) {
      toast({
        title: "Purchase not completed",
        description: billingErrorMessage(error, "Google Play could not complete the purchase."),
        variant: "destructive",
      });
    } finally {
      setIsPurchasing(false);
    }
  };

  const restoreNativePurchases = async () => {
    if (!nativeIdentityReady) return;
    setIsRestoring(true);
    try {
      const result = await Purchases.restorePurchases();
      setNativeCustomerInfo(result.customerInfo);
      const restoredEntitlement =
        result.customerInfo.entitlements.active[nativeEntitlementIdentifier];
      toast({
        title: restoredEntitlement ? "Subscription restored" : "No active purchase found",
        description: restoredEntitlement
          ? "Your Google Play subscription is active in SafeNet."
          : "No active SafeNet subscription was found for the Google Play account on this device.",
      });
    } catch (error) {
      toast({
        title: "Restore failed",
        description: billingErrorMessage(error, "RevenueCat could not restore your purchases."),
        variant: "destructive",
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const openPlaySubscriptions = async () => {
    setIsOpeningPlaySubscriptions(true);
    try {
      await Browser.open({ url: GOOGLE_PLAY_SUBSCRIPTIONS_URL });
    } catch (error) {
      toast({
        title: "Could not open Google Play",
        description: billingErrorMessage(error, "Open Play Store subscriptions to manage your plan."),
        variant: "destructive",
      });
    } finally {
      setIsOpeningPlaySubscriptions(false);
    }
  };

  const openSignIn = () => {
    const billingReturnUrl = `${basePath}/billing?${CLERK_RETURN_REFRESH_QUERY_PARAM}=1`;
    try {
      window.sessionStorage.setItem(CLERK_RETURN_REFRESH_SESSION_KEY, "1");
    } catch {
      // The redirect query parameter remains available as a fallback.
    }
    setLocation(`/sign-in?redirect_url=${encodeURIComponent(billingReturnUrl)}`);
  };

  const retryClerkLoading = () => {
    const retryUrl = new URL(window.location.href);
    retryUrl.searchParams.delete(CLERK_STALL_QUERY_PARAM);
    window.location.assign(`${retryUrl.pathname}${retryUrl.search}${retryUrl.hash}`);
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

  const accountLabel = user?.email ?? user?.id;
  const nativeEntitlement =
    nativeCustomerInfo?.entitlements.active[nativeEntitlementIdentifier] ?? null;

  return (
    <div className="space-y-6">
      <Header
        title="SafeNet Premium"
        subtitle="Pay via Google Play Store - CAD $3.00 Monthly - Subscribe and Conquer!"
        subtitleClassName="normal-case tracking-normal"
      />

      <CyberCard>
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="safenet-premium-feature rounded-lg bg-primary/20 p-3">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">SafeNet Shield DNS Server+</h2>
                <p className="text-sm text-muted-foreground">RevenueCat subscription</p>
              </div>
            </div>
            <p className="max-w-xl text-sm text-muted-foreground">
              {isAndroid
                ? "Google Play processes Android subscriptions. SafeNet account sign-in is not required to subscribe or restore purchases."
                : "Android subscriptions are purchased and restored through Google Play."}
            </p>
          </div>
          <CreditCard className="hidden h-16 w-16 text-primary/30 md:block" />
        </div>
      </CyberCard>

      <CyberCard>
        <div className="max-w-xl space-y-4">
          {isAndroid ? (
            <div data-testid="android-billing-panel" className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Google Play subscriptions</h2>
                <p className="text-sm text-muted-foreground">
                  Subscribe, restore, or manage your plan with the Google Play account on this device. No SafeNet sign-in is needed.
                </p>
              </div>

              {!nativePurchasesReady && !nativeBillingError ? (
                <p className="text-sm text-muted-foreground">Loading Google Play billing…</p>
              ) : nativePurchasesReady && !nativeIdentityReady ? (
                <p className="text-sm text-muted-foreground">Checking this device’s purchase account…</p>
              ) : nativeIdentityReady && nativeEntitlement ? (
                <div data-testid="billing-status-active" className="space-y-1">
                  <p className="text-sm text-emerald-400">
                    SafeNet Shield DNS Server+ is active
                    {!nativeEntitlement.willRenew
                      ? " and will end at the current billing period."
                      : "."}
                  </p>
                  {nativeEntitlement.expirationDate && (
                    <p className="text-xs text-muted-foreground">
                      Renews or expires {new Date(nativeEntitlement.expirationDate).toLocaleDateString()}.
                    </p>
                  )}
                </div>
              ) : nativePurchasesReady && nativeIdentityReady ? (
                <p data-testid="billing-status-inactive" className="text-sm text-muted-foreground">
                  No active subscription was found for this RevenueCat customer. You can subscribe or restore purchases below.
                </p>
              ) : null}

              {nativeBillingError && (
                <p className="text-sm text-amber-200" role="alert">{nativeBillingError}</p>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  data-testid="billing-purchase"
                  type="button"
                  disabled={!nativePurchasesReady || !nativeIdentityReady || !nativePackage || Boolean(nativeEntitlement) || isPurchasing || isRestoring}
                  onClick={() => void purchaseNativePackage()}
                >
                  {isPurchasing && <Loader2 className="animate-spin" />}
                  {isPurchasing
                    ? "Opening Google Play…"
                    : nativeEntitlement
                      ? "Subscription active"
                      : `Subscribe${nativePackage ? ` for ${nativePackage.product.priceString}` : ""}`}
                </Button>
                <Button
                  data-testid="billing-restore"
                  type="button"
                  variant="outline"
                  disabled={!nativePurchasesReady || !nativeIdentityReady || isPurchasing || isRestoring}
                  onClick={() => void restoreNativePurchases()}
                >
                  {isRestoring && <Loader2 className="animate-spin" />}
                  {isRestoring ? "Restoring…" : "Restore purchases"}
                </Button>
                <Button
                  data-testid="billing-play-manage"
                  type="button"
                  variant="outline"
                  disabled={isOpeningPlaySubscriptions || isPurchasing || isRestoring}
                  onClick={() => void openPlaySubscriptions()}
                >
                  {isOpeningPlaySubscriptions ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                  {isOpeningPlaySubscriptions ? "Opening Google Play…" : "Manage in Google Play"}
                </Button>
              </div>
            </div>
          ) : (
          <div>
            <h2 className="text-lg font-semibold text-white">Start or manage billing</h2>
            <p className="text-sm text-muted-foreground">
              Billing access is tied to your signed-in SafeNet account.
            </p>
          </div>
          )}
          {!isAndroid && !clerkIsLoaded && !clerkLoadTimedOut ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">Loading your account…</p>
              <Button
                data-testid="billing-sign-in-loading"
                type="button"
                className="w-full shrink-0 sm:w-auto"
                onClick={openSignIn}
              >
                Sign in to continue
              </Button>
            </div>
          ) : !isAndroid && !clerkIsLoaded ? (
            <div
              data-testid="billing-clerk-recovery"
              className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-sm text-red-200">
                Your account could not be loaded. Check your connection and try again.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  data-testid="billing-clerk-retry"
                  type="button"
                  variant="outline"
                  className="w-full shrink-0 sm:w-auto"
                  onClick={retryClerkLoading}
                >
                  Retry
                </Button>
                <Button
                  data-testid="billing-sign-in-recovery"
                  type="button"
                  className="w-full shrink-0 sm:w-auto"
                  onClick={openSignIn}
                >
                  Sign in to continue
                </Button>
              </div>
            </div>
          ) : !isAndroid && !isSignedIn ? (
            <div
              data-testid="billing-signed-out"
              className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
                  <UserRound className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-white">Sign in to manage billing</p>
                  <p className="text-sm leading-5 text-muted-foreground">
                    Check your RevenueCat entitlement or manage an existing subscription.
                  </p>
                </div>
              </div>
              <Button
                data-testid="billing-sign-in"
                type="button"
                className="w-full shrink-0 sm:w-auto"
                onClick={openSignIn}
              >
                Sign in to continue
              </Button>
            </div>
          ) : !isAndroid ? (
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
                    <p
                      data-testid="billing-account"
                      data-clerk-user-id={user?.id}
                      className="truncate font-medium text-white"
                    >
                      {accountLabel}
                    </p>
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
                <p data-testid="billing-status-active" className="text-sm text-emerald-400">
                  SafeNet Shield DNS Server+ is active
                   {billingStatus.cancelAtPeriodEnd ? " and will end at the end of the current billing period." : "."}
                </p>
              ) : (
                  <p data-testid="billing-status-inactive" className="text-sm text-muted-foreground">
                    No active SafeNet RevenueCat entitlement is linked to this account.
                  </p>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isOpeningPortal || !billingStatus?.hasEntitlement}
                  onClick={() => void openManagementPortal()}
                >
                  {isOpeningPortal ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                  {isOpeningPortal ? "Opening portal…" : "Manage subscription"}
                </Button>
              </div>
              {!billingStatus?.linked && !isLoadingStatus && (
                <p className="text-xs text-muted-foreground">
                  Purchase access in the SafeNet Android app, then return here to review your RevenueCat status.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </CyberCard>
    </div>
  );
}