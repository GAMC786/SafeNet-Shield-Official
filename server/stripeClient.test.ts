import assert from "node:assert/strict";
import test from "node:test";
import { getStripeConnectionAuthHeader } from "./stripeClient";

test("published Stripe clients use the deployment connection when both tokens exist", () => {
  assert.equal(
    getStripeConnectionAuthHeader({
      NODE_ENV: "production",
      REPL_IDENTITY: "source-repl-token",
      WEB_REPL_RENEWAL: "published-deployment-token",
    }),
    "depl published-deployment-token",
  );
});

test("development Stripe clients use the repl connection", () => {
  assert.equal(
    getStripeConnectionAuthHeader({
      NODE_ENV: "development",
      REPL_IDENTITY: "source-repl-token",
      WEB_REPL_RENEWAL: "published-deployment-token",
    }),
    "repl source-repl-token",
  );
});

test("Stripe connection auth is unavailable without an injected token", () => {
  assert.equal(getStripeConnectionAuthHeader({ NODE_ENV: "production" }), null);
});