import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { apiFetch } from "@/lib/api";

export function useLogs(enabled = true) {
  return useQuery({
    queryKey: [api.logs.list.path],
    enabled,
    queryFn: async () => {
      const res = await apiFetch(api.logs.list.path);
      if (!res.ok) throw new Error("Failed to fetch logs");
      return api.logs.list.responses[200].parse(await res.json());
    },
    refetchInterval: 5000, // Auto-refresh logs every 5s for dashboard feel
  });
}

export function useStats(enabled = true) {
  return useQuery({
    queryKey: [api.logs.stats.path],
    enabled,
    queryFn: async () => {
      const res = await apiFetch(api.logs.stats.path);
      if (!res.ok) throw new Error("Failed to fetch stats");
      return api.logs.stats.responses[200].parse(await res.json());
    },
    refetchInterval: 5000,
  });
}
