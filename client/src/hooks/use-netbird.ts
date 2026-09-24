import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { netbirdStatusSchema } from "@shared/netbird";

const queryKey = ["/api/netbird/status"];

export function useNetBirdStatus() {
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(queryKey[0], { signal, timeoutMs: 8000 });
      if (!response.ok) throw new Error("Failed to check NetBird status");
      return netbirdStatusSchema.parse(await response.json());
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });
}