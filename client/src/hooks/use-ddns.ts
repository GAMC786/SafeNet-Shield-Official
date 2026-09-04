import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { PublicDdnsUpdater, InsertDdnsUpdater } from "@shared/schema";
import { apiFetch } from "@/lib/api";
import { DDNS_STATUS_REFRESH_INTERVAL_MS } from "./ddns-constants";
import { useToast } from "@/hooks/use-toast";

export { DDNS_STATUS_REFRESH_INTERVAL_MS } from "./ddns-constants";

function getDdnsUpdateError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error("DDNS update failed. Try again.");
  }

  const separator = error.message.indexOf(": ");
  if (separator !== -1) {
    try {
      const responseBody = JSON.parse(error.message.slice(separator + 2)) as { message?: unknown };
      if (typeof responseBody.message === "string") {
        return new Error(responseBody.message);
      }
    } catch {
      // Keep the original error when the response is not JSON.
    }
  }

  return new Error(error.message.replace(/^\d+:\s*/, ""));
}

export function useDdnsUpdaters() {
  return useQuery({
    queryKey: ["/api/ddns"],
    queryFn: async () => {
      const response = await apiFetch("/api/ddns");
      if (!response.ok) throw new Error("Failed to fetch DDNS updaters");
      return response.json() as Promise<PublicDdnsUpdater[]>;
    },
    refetchInterval: DDNS_STATUS_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });
}

export function useCreateDdnsUpdater() {
  return useMutation({
    mutationFn: async (data: InsertDdnsUpdater) => {
      return apiRequest("POST", "/api/ddns", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
    },
  });
}

export function useUpdateDdnsUpdater() {
  const reactQueryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertDdnsUpdater> }) => {
      return apiRequest("PATCH", `/api/ddns/${id}`, data);
    },
    onMutate: async ({ id, data }) => {
      const queryKey = ["/api/ddns"];
      await reactQueryClient.cancelQueries({ queryKey });
      const previous = reactQueryClient.getQueryData<PublicDdnsUpdater[]>(queryKey);
      reactQueryClient.setQueryData<PublicDdnsUpdater[]>(queryKey, (current) =>
        current?.map((updater) => updater.id === id ? { ...updater, ...data } : updater),
      );
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
    },
    onError: (error: Error, _data, context) => {
      if (context?.previous) {
        reactQueryClient.setQueryData(["/api/ddns"], context.previous);
      }
      toast({
        title: "DDNS updater not updated",
        description: error.message || "Failed to update DDNS updater.",
        variant: "destructive",
      });
    },
  });
}

export function useDeleteDdnsUpdater() {
  const reactQueryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/ddns/${id}`);
    },
    onMutate: async (id) => {
      const queryKey = ["/api/ddns"];
      await reactQueryClient.cancelQueries({ queryKey });
      const previous = reactQueryClient.getQueryData<PublicDdnsUpdater[]>(queryKey);
      reactQueryClient.setQueryData<PublicDdnsUpdater[]>(queryKey, (current) =>
        current?.filter((updater) => updater.id !== id),
      );
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
    },
    onError: (error: Error, _id, context) => {
      if (context?.previous) {
        reactQueryClient.setQueryData(["/api/ddns"], context.previous);
      }
      toast({
        title: "DDNS updater not deleted",
        description: error.message || "Failed to delete DDNS updater.",
        variant: "destructive",
      });
    },
  });
}

export function useManualDdnsUpdate() {
  return useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/ddns/0/update");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
    },
  });
}

export function usePublicIp() {
  return useQuery({
    queryKey: ["public-ip-client"],
    queryFn: async () => {
      // Fetch IP directly from client to get user's actual IP, not server's
      const response = await fetch("https://api.ipify.org?format=json");
      return response.json() as Promise<{ ip: string }>;
    },
    staleTime: 60000,
  });
}

export function useUpdateDdnsWithIp() {
  return useMutation({
    mutationFn: async (clientIp: string) => {
      try {
        return await apiRequest("POST", "/api/ddns/update-all", { clientIp });
      } catch (error) {
        throw getDdnsUpdateError(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
    },
  });
}
