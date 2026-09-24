import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { tailscaleStatusSchema } from "@shared/tailscale";

const queryKey = ["/api/tailscale/status"];
export function useTailscaleStatus() {
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(queryKey[0], { signal, timeoutMs: 8000 });
      if (!response.ok) throw new Error("Failed to check Tailscale status");
      return tailscaleStatusSchema.parse(await response.json());
    },
    refetchInterval: 30000, refetchIntervalInBackground: true,
  });
}