import { z } from "zod";

export const netbirdStatusSchema = z.object({
  configured: z.boolean(),
  managementUrl: z.string().nullable(),
  dashboardUrl: z.string().nullable(),
  status: z.enum(["not-configured", "online", "unavailable"]),
  checkedAt: z.string().nullable(),
  peerCount: z.number().int().nonnegative().nullable(),
  message: z.string(),
});

export const netbirdPeerSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string(),
  status: z.enum(["online", "offline"]),
});

export const netbirdPeerStatusSchema = z.object({
  peer: netbirdPeerSchema,
});

export type NetBirdStatus = z.infer<typeof netbirdStatusSchema>;
export type NetBirdPeerStatus = z.infer<typeof netbirdPeerStatusSchema>;