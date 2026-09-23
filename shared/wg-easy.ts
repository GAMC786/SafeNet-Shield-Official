import { z } from "zod";

export const wgEasyTunnelVerificationSchema = z.object({
  status: z.enum(["not-run", "verified", "failed"]),
  checkedAt: z.string().nullable(),
  peerCreated: z.boolean(),
  peerDeleted: z.boolean(),
  peerHandshakeAt: z.string().nullable(),
  hostHandshakeAt: z.string().nullable(),
  message: z.string(),
});

export const wgEasyStatusSchema = z.object({
  configured: z.boolean(),
  adminUrl: z.string().nullable(),
  wireguardEndpoint: z.string().nullable(),
  status: z.enum(["not-configured", "online", "unavailable"]),
  checkedAt: z.string().nullable(),
  message: z.string(),
  tunnelVerification: wgEasyTunnelVerificationSchema,
});

export type WgEasyStatus = z.infer<typeof wgEasyStatusSchema>;