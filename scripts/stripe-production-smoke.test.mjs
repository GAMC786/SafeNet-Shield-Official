import assert from "node:assert/strict";
import test from "node:test";
import { runStripeProductionSmoke } from "./stripe-production-smoke.mjs";

function response(status, body) {
  return {
    status,
    json: async () => body,
  };
}

test("Stripe production smoke verifies readiness and unsigned webhook rejection", async () => {
  const requests = [];
  const result = await runStripeProductionSmoke({
    baseUrl: "https://published.safenet.example",
    fetchImpl: async (url, options) => {
      requests.push({ url: url.toString(), options });
      if (url.pathname === "/api/stripe/health") {
        return response(200, { ready: true });
      }
      return response(400, { message: "Invalid Stripe webhook." });
    },
  });

  assert.deepEqual(result, {
    billingReady: true,
    webhookUnsignedRequestStatus: 400,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://published.safenet.example/api/stripe/health");
  assert.equal(requests[1].url, "https://published.safenet.example/api/stripe/webhook");
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[1].options.headers["Content-Type"], "application/json");
  assert.equal(requests[1].options.body, '{"type":"safenet.billing.smoke"}');
});

test("Stripe production smoke reports disconnected billing without exposing response data", async () => {
  const privateResponseData = "sk_live_private-test-data";
  await assert.rejects(
    runStripeProductionSmoke({
      baseUrl: "https://published.safenet.example",
      fetchImpl: async () => response(503, {
        ready: false,
        message: privateResponseData,
      }),
    }),
    (error) => {
      assert.match(error.message, /readiness check failed with HTTP 503/);
      assert.doesNotMatch(error.message, new RegExp(privateResponseData));
      return true;
    },
  );
});

test("Stripe production smoke rejects URLs containing credentials", async () => {
  await assert.rejects(
    runStripeProductionSmoke({
      baseUrl: "https://stripe-secret:password@published.safenet.example",
      fetchImpl: async () => {
        throw new Error("must not make a request");
      },
    }),
    /must not include URL credentials/,
  );
});