import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { headscaleStatusSchema } from "@shared/headscale";

const queryKey = ["/api/headscale/status"];

export function useHeadscaleStatus() {
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(queryKey[0], { signal, timeoutMs: 8000 });
      if (!response.ok) throw new Error("Failed to check Headscale status");
      return headscaleStatusSchema.parse(await response.json());
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });
}