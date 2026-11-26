import assert from "node:assert/strict";
import test from "node:test";
import { enqueueNativeCommand } from "./native-command-queue";

test("native commands remain serialized across feature hooks", async () => {
  const events: string[] = [];
  const first = enqueueNativeCommand(async () => {
    events.push("first-start");
    await new Promise((resolve) => setTimeout(resolve, 10));
    events.push("first-end");
    return "first";
  });
  const second = enqueueNativeCommand(async () => {
    events.push("second-start");
    events.push("second-end");
    return "second";
  });

  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
});

test("a rejected phone toggle still allows status refresh and a later retry", async () => {
  const events: string[] = [];
  const failedToggle = enqueueNativeCommand(async () => {
    events.push("toggle-start");
    throw new Error("VPN permission was cancelled");
  });
  const statusRefresh = enqueueNativeCommand(async () => {
    events.push("status-refresh");
    return { connected: false };
  });
  const retryToggle = enqueueNativeCommand(async () => {
    events.push("toggle-retry");
    return { connected: true };
  });

  await assert.rejects(failedToggle, /VPN permission was cancelled/);
  assert.deepEqual(await statusRefresh, { connected: false });
  assert.deepEqual(await retryToggle, { connected: true });
  assert.deepEqual(events, ["toggle-start", "status-refresh", "toggle-retry"]);
});