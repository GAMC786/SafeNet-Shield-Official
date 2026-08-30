import assert from "node:assert/strict";
import test from "node:test";
import { batchProcess, batchProcessWithSSE } from "./utils";

test("batchProcess retries rate-limit failures and reports one completion", async () => {
  let attempts = 0;
  const progress: Array<[number, number, string]> = [];

  const results = await batchProcess(
    ["item"],
    async (item) => {
      attempts++;
      if (attempts < 3) {
        throw new Error("429 Too Many Requests");
      }
      return `${item}-processed`;
    },
    {
      retries: 3,
      minTimeout: 0,
      maxTimeout: 0,
      onProgress: (completed, total, item) => {
        progress.push([completed, total, item as string]);
      },
    },
  );

  assert.deepEqual(results, ["item-processed"]);
  assert.equal(attempts, 3);
  assert.deepEqual(progress, [[1, 1, "item"]]);
});

test("batchProcess aborts non-rate-limit failures without retrying", async () => {
  let attempts = 0;

  await assert.rejects(
    batchProcess(
      ["item"],
      async () => {
        attempts++;
        throw new Error("Invalid request");
      },
      { retries: 5, minTimeout: 0, maxTimeout: 0 },
    ),
    { message: "Invalid request" },
  );

  assert.equal(attempts, 1);
});

test("batchProcessWithSSE retries when the p-retry context contains a rate-limit error", async () => {
  let attempts = 0;
  const events: Array<{ type: string; [key: string]: unknown }> = [];

  const results = await batchProcessWithSSE(
    ["item"],
    async (item) => {
      attempts++;
      if (attempts === 1) {
        throw new Error("rate limit exceeded");
      }
      return `${item}-processed`;
    },
    (event) => events.push(event),
    { retries: 2, minTimeout: 0, maxTimeout: 0 },
  );

  assert.deepEqual(results, ["item-processed"]);
  assert.equal(attempts, 2);
  assert.deepEqual(
    events.map(({ type }) => type),
    ["started", "processing", "progress", "complete"],
  );
  assert.equal(events[2]?.result, "item-processed");
});

test("batchProcessWithSSE aborts non-rate-limit failures without retrying", async () => {
  let attempts = 0;
  const events: Array<{ type: string; [key: string]: unknown }> = [];

  const results = await batchProcessWithSSE(
    ["item"],
    async () => {
      attempts++;
      throw new Error("Invalid request");
    },
    (event) => events.push(event),
    { retries: 5, minTimeout: 0, maxTimeout: 0 },
  );

  assert.equal(attempts, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0], undefined);
  assert.equal(events[2]?.type, "progress");
  assert.equal(events[2]?.error, "Invalid request");
  assert.deepEqual(events.at(-1), { type: "complete", processed: 1, errors: 1 });
});