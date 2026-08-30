import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { type InsertAppSettings } from "@shared/schema";
import { apiFetch } from "@/lib/api";

export function useAuthStatus() {
  return useQuery({
    queryKey: [api.auth.status.path],
    queryFn: async ({ signal }) => {
      const res = await apiFetch(api.auth.status.path, { signal, timeoutMs: 10000 });
      if (!res.ok) throw new Error("Failed to check authentication");
      return api.auth.status.responses[200].parse(await res.json());
    },
  });
}

export function useSettings(enabled = true) {
  return useQuery({
    queryKey: [api.settings.get.path],
    enabled,
    queryFn: async ({ signal }) => {
      const res = await apiFetch(api.settings.get.path, { signal, timeoutMs: 10000 });
      if (!res.ok) throw new Error("Failed to fetch settings");
      return api.settings.get.responses[200].parse(await res.json());
    },
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<InsertAppSettings>) => {
      const validated = api.settings.update.input.parse(data);
      const res = await apiFetch(api.settings.update.path, {
        method: api.settings.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update settings");
      return api.settings.update.responses[200].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.settings.get.path] }),
  });
}

export function useVerifyPin() {
  return useMutation({
    mutationFn: async (pin: string) => {
      const res = await apiFetch(api.settings.verifyPin.path, {
        method: api.settings.verifyPin.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Invalid PIN");
      return api.settings.verifyPin.responses[200].parse(await res.json());
    },
  });
}
