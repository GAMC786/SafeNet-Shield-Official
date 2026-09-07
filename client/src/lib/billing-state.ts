export type BillingAction = "checkout" | "portal";

export type BillingRecovery = {
  action: BillingAction;
  actionLabel: string;
  message: string;
  supportEscalation: boolean;
};

export function getBillingAction(status: string): BillingAction {
  return status === "none" || status === "canceled" ? "checkout" : "portal";
}

export function getBillingRecovery(status: string): BillingRecovery {
  switch (status) {
    case "past_due":
      return {
        action: "portal",
        actionLabel: "Update payment details",
        message: "Payment is past due. Update your payment method in Stripe to restore access.",
        supportEscalation: false,
      };
    case "unpaid":
      return {
        action: "portal",
        actionLabel: "Update payment details",
        message: "Your subscription is unpaid. Update your payment method in Stripe to retry payment and restore access.",
        supportEscalation: false,
      };
    case "paused":
      return {
        action: "portal",
        actionLabel: "Update payment details",
        message: "Your subscription is paused. Update your payment method in Stripe. If it stays paused, contact SafeNet support to resume access.",
        supportEscalation: true,
      };
    case "canceled":
      return {
        action: "checkout",
        actionLabel: "Subscribe for $5/month",
        message: "Your subscription has expired. You can subscribe again at any time.",
        supportEscalation: false,
      };
    case "active":
    case "trialing":
      return {
        action: "portal",
        actionLabel: "Manage subscription",
        message: "Your SafeNet subscription is active.",
        supportEscalation: false,
      };
    default: {
      const action = getBillingAction(status);
      return {
        action,
        actionLabel: action === "checkout" ? "Subscribe for $5/month" : "Manage subscription",
        message: action === "checkout"
          ? "Subscribe to activate monthly SafeNet access."
          : "Manage your SafeNet subscription in Stripe.",
        supportEscalation: false,
      };
    }
  }
}

export function shouldPollForCheckoutConvergence(input: {
  returningFromCheckout: boolean;
  entitled: boolean | undefined;
  now: number;
  deadline: number;
}) {
  return input.returningFromCheckout &&
    input.entitled !== true &&
    input.now < input.deadline;
}