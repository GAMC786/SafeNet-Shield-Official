import { useState } from "react";
import { CreditCard, ShieldCheck } from "lucide-react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function Billing() {
  const [email, setEmail] = useState("");
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const { toast } = useToast();

  const postBillingAction = async (path: string, setLoading: (value: boolean) => void) => {
    setLoading(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
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
              Use the email associated with your Stripe subscription.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="billing-email">Email address</Label>
            <Input
              id="billing-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              disabled={isStartingCheckout || !email.trim()}
              onClick={() => void postBillingAction("/api/billing/checkout", setIsStartingCheckout)}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              {isStartingCheckout ? "Opening Stripe..." : "Start free trial"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Subscription management will be available after account sign-in is enabled.
          </p>
        </div>
      </CyberCard>
    </div>
  );
}