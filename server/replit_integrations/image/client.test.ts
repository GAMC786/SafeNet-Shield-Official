import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-key";

const { editImages, generateImageBuffer, openai } = await import("./client");

test("generateImageBuffer rejects a response with no image data", async (t) => {
  t.mock.method(openai.images, "generate", async () => ({ data: [] }));

  await assert.rejects(
    generateImageBuffer("test prompt"),
    { message: "Image generation returned no image data" },
  );
});

test("generateImageBuffer rejects an empty base64 image", async (t) => {
  t.mock.method(openai.images, "generate", async () => ({
    data: [{ b64_json: "" }],
  }));

  await assert.rejects(
    generateImageBuffer("test prompt"),
    { message: "Image generation returned empty image data" },
  );
});

test("editImages rejects missing image data without writing an empty file", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "safenet-image-test-"));
  const inputPath = path.join(directory, "input.png");
  const outputPath = path.join(directory, "output.png");
  await writeFile(inputPath, Buffer.from("not a real image"));
  t.mock.method(openai.images, "edit", async () => ({ data: [] }));

  try {
    await assert.rejects(
      editImages([inputPath], "test prompt", outputPath),
      { message: "Image editing returned no image data" },
    );
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});