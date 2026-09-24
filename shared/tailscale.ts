import { z } from "zod";

export const tailscaleStatusSchema = z.object({
  configured: z.boolean(), tailnet: z.string().nullable(), dashboardUrl: z.string(),
  status: z.enum(["not-configured", "online", "unavailable"]), checkedAt: z.string().nullable(),
  deviceCount: z.number().int().nonnegative().nullable(), message: z.string(),
});
export const tailscaleDeviceSchema = z.object({
  id: z.string(), name: z.string(), owner: z.string(), status: z.enum(["online", "offline", "unknown"]),
});
export const tailscaleDeviceStatusSchema = z.object({ device: tailscaleDeviceSchema });
export type TailscaleStatus = z.infer<typeof tailscaleStatusSchema>;
export type TailscaleDeviceStatus = z.infer<typeof tailscaleDeviceStatusSchema>;