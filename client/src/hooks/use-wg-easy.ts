import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { wgEasyStatusSchema } from "@shared/wg-easy";

const queryKey = ["/api/wg-easy/status"];

export function useWgEasyStatus() {
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(queryKey[0], { signal, timeoutMs: 8000 });
      if (!response.ok) throw new Error("Failed to check WG-Easy status");
      return wgEasyStatusSchema.parse(await response.json());
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });
}