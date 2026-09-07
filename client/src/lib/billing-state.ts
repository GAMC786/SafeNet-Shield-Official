export type BillingAction = "checkout" | "portal";

export function getBillingAction(status: string): BillingAction {
  return status === "none" || status === "canceled" ? "checkout" : "portal";
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