import { z } from "zod";

export const headscaleStatusSchema = z.object({
  configured: z.boolean(),
  headscaleUrl: z.string().nullable(),
  headplaneUrl: z.string().nullable(),
  status: z.enum(["not-configured", "online", "unavailable"]),
  checkedAt: z.string().nullable(),
  nodeCount: z.number().int().nonnegative().nullable(),
  message: z.string(),
});

export type HeadscaleStatus = z.infer<typeof headscaleStatusSchema>;