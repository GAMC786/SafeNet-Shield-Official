import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { type InsertAppSettings, type PublicAppSettings } from "@shared/schema";
import { apiFetch } from "@/lib/api";
import { firewallConfigQueryKey } from "@/hooks/firewall-config-key";

export function useAuthStatus() {
  return useQuery({
    queryKey: [api.auth.status.path],
    queryFn: async ({ signal }) => {
      const res = await apiFetch(api.auth.status.path, {
        signal,
        timeoutMs: 10000,
        cache: "no-store",
      });
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
    onMutate: async (data) => {
      const queryKey = [api.settings.get.path];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<PublicAppSettings>(queryKey);
      queryClient.setQueryData<PublicAppSettings>(queryKey, (current) =>
        current
          ? {
              ...current,
              ...data,
            }
          : current,
      );
      return { previous };
    },
    onSuccess: (updatedSettings) => {
      queryClient.setQueryData([api.settings.get.path], updatedSettings);
      void queryClient.invalidateQueries({ queryKey: [api.settings.get.path] });
      void queryClient.invalidateQueries({ queryKey: firewallConfigQueryKey });
    },
    onError: (error: Error, _data, context) => {
      if (context?.previous) {
        queryClient.setQueryData([api.settings.get.path], context.previous);
      }
    },
  });
}
