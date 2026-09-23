import { z } from "zod";

export const wgEasyStatusSchema = z.object({
  configured: z.boolean(),
  adminUrl: z.string().nullable(),
  wireguardEndpoint: z.string().nullable(),
  status: z.enum(["not-configured", "online", "unavailable"]),
  checkedAt: z.string().nullable(),
  message: z.string(),
});

export type WgEasyStatus = z.infer<typeof wgEasyStatusSchema>;