import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

let openaiClient: OpenAI | undefined;

function getOpenAiClient(): OpenAI {
  if (openaiClient) {
    return openaiClient;
  }

  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("AI image integration is not configured.");
  }

  openaiClient = new OpenAI({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
  return openaiClient;
}

export const openai = {
  get images() {
    return getOpenAiClient().images;
  },
};

function decodeImageData(
  base64: string | null | undefined,
  operation: "generation" | "editing",
): Buffer {
  if (base64 === null || base64 === undefined) {
    throw new Error(`Image ${operation} returned no image data`);
  }
  if (base64.length === 0) {
    throw new Error(`Image ${operation} returned empty image data`);
  }

  const imageBytes = Buffer.from(base64, "base64");
  if (imageBytes.length === 0) {
    throw new Error(`Image ${operation} returned empty image data`);
  }

  return imageBytes;
}

/**
 * Generate an image and return as Buffer.
 * Uses gpt-image-1 model via Replit AI Integrations.
 */
export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const response = await getOpenAiClient().images.generate({
    model: "gpt-image-1",
    prompt,
    size,
  });
  return decodeImageData(response.data?.[0]?.b64_json, "generation");
}

/**
 * Edit/combine multiple images into a composite.
 * Uses gpt-image-1 model via Replit AI Integrations.
 */
export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      })
    )
  );

  const response = await getOpenAiClient().images.edit({
    model: "gpt-image-1",
    image: images,
    prompt,
  });

  const imageBytes = decodeImageData(
    response.data?.[0]?.b64_json,
    "editing",
  );

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}

