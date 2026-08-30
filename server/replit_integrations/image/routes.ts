import type { Express, Request, Response } from "express";
import { openai } from "./client";

export function registerImageRoutes(app: Express): void {
  app.post("/api/generate-image", async (req: Request, res: Response) => {
    try {
      const { prompt, size = "1024x1024" } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: size as "1024x1024" | "512x512" | "256x256",
      });

      const imageData = response.data?.[0];
      if (!imageData) {
        throw new Error("Image generation returned no image data");
      }

      const url =
        typeof imageData.url === "string" && imageData.url.length > 0
          ? imageData.url
          : undefined;
      const b64Json =
        typeof imageData.b64_json === "string" && imageData.b64_json.length > 0
          ? imageData.b64_json
          : undefined;

      if (!url && !b64Json) {
        throw new Error("Image generation returned no usable image data");
      }

      res.json({
        ...(url ? { url } : {}),
        ...(b64Json ? { b64_json: b64Json } : {}),
      });
    } catch (error) {
      console.error("Error generating image:", error);
      res.status(500).json({ error: "Failed to generate image" });
    }
  });
}

