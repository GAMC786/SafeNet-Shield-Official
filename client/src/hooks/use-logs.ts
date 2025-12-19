import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";

export function useLogs() {
  return useQuery({
    queryKey: [api.logs.list.path],
    queryFn: async () => {
      const res = await fetch(api.logs.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch logs");
      return api.logs.list.responses[200].parse(await res.json());
    },
    refetchInterval: 5000, // Auto-refresh logs every 5s for dashboard feel
  });
}

export function useStats() {
  return useQuery({
    queryKey: [api.logs.stats.path],
    queryFn: async () => {
      const res = await fetch(api.logs.stats.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return api.logs.stats.responses[200].parse(await res.json());
    },
    refetchInterval: 5000,
  });
}
