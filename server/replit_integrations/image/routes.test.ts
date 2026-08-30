import assert from "node:assert/strict";
import test from "node:test";
import type { Express, Request, Response } from "express";

process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key";

const { openai } = await import("./client");
const { registerImageRoutes } = await import("./routes");

type RouteHandler = (req: Request, res: Response) => unknown;

function getGenerateImageHandler(): RouteHandler {
  let handler: RouteHandler | undefined;
  const app = {
    post: (_path: string, callback: RouteHandler) => {
      handler = callback;
      return app;
    },
  };

  registerImageRoutes(app as unknown as Express);
  assert.ok(handler);
  return handler;
}

function responseRecorder() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(payload: unknown) {
      body = payload;
      return response;
    },
  };

  return {
    response: response as unknown as Response,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

test("generate-image returns a server error when the API has no image entry", async (t) => {
  t.mock.method(openai.images, "generate", async () => ({ data: [] }));
  const recorder = responseRecorder();

  await getGenerateImageHandler()(
    { body: { prompt: "test prompt" } } as Request,
    recorder.response,
  );

  assert.equal(recorder.statusCode, 500);
  assert.deepEqual(recorder.body, { error: "Failed to generate image" });
});

test("generate-image does not return an image entry with empty fields", async (t) => {
  t.mock.method(openai.images, "generate", async () => ({
    data: [{ url: "", b64_json: "" }],
  }));
  const recorder = responseRecorder();

  await getGenerateImageHandler()(
    { body: { prompt: "test prompt" } } as Request,
    recorder.response,
  );

  assert.equal(recorder.statusCode, 500);
  assert.deepEqual(recorder.body, { error: "Failed to generate image" });
});

test("generate-image returns whichever usable image representation is provided", async (t) => {
  t.mock.method(openai.images, "generate", async () => ({
    data: [{ b64_json: "encoded-image" }],
  }));
  const recorder = responseRecorder();

  await getGenerateImageHandler()(
    { body: { prompt: "test prompt" } } as Request,
    recorder.response,
  );

  assert.equal(recorder.statusCode, 200);
  assert.deepEqual(recorder.body, { b64_json: "encoded-image" });
});