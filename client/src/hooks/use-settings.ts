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
      const { pinCode, ...safeData } = data;
      queryClient.setQueryData<PublicAppSettings>(queryKey, (current) =>
        current
          ? {
              ...current,
              ...safeData,
              ...(pinCode !== undefined ? { pinConfigured: Boolean(pinCode) } : {}),
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

export function useVerifyPin() {
  return useMutation({
    mutationFn: async (pin: string) => {
      const res = await apiFetch(api.settings.verifyPin.path, {
        method: api.settings.verifyPin.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const error = new Error(body.message || "Invalid PIN") as Error & { status?: number; retryAfter?: number };
        error.status = res.status;
        const retryAfter = res.headers.get("Retry-After");
        error.retryAfter = retryAfter ? Number(retryAfter) : undefined;
        throw error;
      }
      return api.settings.verifyPin.responses[200].parse(await res.json());
    },
  });
}

export function useRequestPinRecovery() {
  return useMutation({
    mutationFn: async (email: string) => {
      const input = api.settings.requestPinRecovery.input.parse({ email });
      const res = await apiFetch(api.settings.requestPinRecovery.path, {
        method: api.settings.requestPinRecovery.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Could not request PIN recovery");
      return api.settings.requestPinRecovery.responses[200].parse(body);
    },
  });
}

export function useResetPinRecovery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; code: string; pin: string }) => {
      const validated = api.settings.resetPinRecovery.input.parse(input);
      const res = await apiFetch(api.settings.resetPinRecovery.path, {
        method: api.settings.resetPinRecovery.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Could not reset PIN");
      return api.settings.resetPinRecovery.responses[200].parse(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [api.auth.status.path] });
      void queryClient.invalidateQueries({ queryKey: [api.settings.get.path] });
    },
  });
}
