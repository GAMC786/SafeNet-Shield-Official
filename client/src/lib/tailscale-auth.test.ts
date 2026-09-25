import assert from "node:assert/strict";
import test from "node:test";
import { waitForTailscaleAuthUrl, type TailscaleAuthStatus } from "./tailscale-auth";

function status(overrides: Partial<TailscaleAuthStatus> = {}): TailscaleAuthStatus {
  return {
    backendState: "NeedsLogin",
    connected: false,
    loginRequired: true,
    ...overrides,
  };
}

test("waits for the native Tailscale engine to publish its sign-in URL", async () => {
  const responses = [
    status({ backendState: "Starting", loginRequired: false }),
    status({ authUrl: "https://login.tailscale.com/a/example" }),
  ];
  let reads = 0;

  const result = await waitForTailscaleAuthUrl(
    status({ backendState: "Starting", loginRequired: false }),
    async () => responses[reads++],
    { attempts: 3, intervalMs: 0, sleep: async () => {} },
  );

  assert.equal(result.authUrl, "https://login.tailscale.com/a/example");
  assert.equal(reads, 2);
});

test("bounds sign-in URL polling and returns the latest status", async () => {
  let reads = 0;
  const result = await waitForTailscaleAuthUrl(
    status(),
    async () => {
      reads++;
      return status();
    },
    { attempts: 3, intervalMs: 0, sleep: async () => {} },
  );

  assert.equal(reads, 3);
  assert.equal(result.loginRequired, true);
  assert.equal(result.authUrl, undefined);
});

test("does not poll after connecting or receiving a status error", async () => {
  let reads = 0;
  const readStatus = async () => {
    reads++;
    return status();
  };

  await waitForTailscaleAuthUrl(
    status({ connected: true, loginRequired: false }),
    readStatus,
    { sleep: async () => {} },
  );
  await waitForTailscaleAuthUrl(
    status({ error: "Local API unavailable" }),
    readStatus,
    { sleep: async () => {} },
  );

  assert.equal(reads, 0);
});