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