import assert from "node:assert/strict";
import test from "node:test";

import { sendAuthEmail } from "./auth-email";

test("authentication emails use the verified SafeNet sender and secure link", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "test-resend-key";
  let sentMessage: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-resend-key");
    sentMessage = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response("{}", { status: 200 });
  };

  try {
    await sendAuthEmail({
      to: "account@example.invalid",
      subject: "Verify your SafeNet email",
      url: "https://safenet.example/verify?token=a&next=%2F",
      action: "verify your email",
    });
    assert.equal(sentMessage?.from, "SafeNet <noreply@auth.safenetinc.ca>");
    assert.deepEqual(sentMessage?.to, ["account@example.invalid"]);
    assert.match(String(sentMessage?.text), /https:\/\/safenet\.example\/verify\?token=a&next=%2F/);
    assert.match(String(sentMessage?.html), /&amp;next=/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  }
});

test("authentication email provider failures do not expose provider response bodies", async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "test-resend-key";
  globalThis.fetch = async () => new Response("private provider detail", { status: 403 });

  try {
    await assert.rejects(
      sendAuthEmail({
        to: "account@example.invalid",
        subject: "Reset your SafeNet password",
        url: "https://safenet.example/reset?token=x",
        action: "reset your password",
      }),
      (error: unknown) => error instanceof Error &&
        error.message === "SafeNet could not send the authentication email." &&
        !error.message.includes("private provider detail"),
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  }
});
