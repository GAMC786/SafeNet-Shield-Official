import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { DdnsUpdater, InsertDdnsUpdater } from "@shared/schema";

export function useDdnsUpdaters() {
  return useQuery({
    queryKey: ["/api/ddns"],
    queryFn: async () => {
      const response = await fetch("/api/ddns");
      return response.json() as Promise<DdnsUpdater[]>;
    },
  });
}

export function useCreateDdnsUpdater() {
  return useMutation({
    mutationFn: async (data: InsertDdnsUpdater) => {
      return apiRequest("/api/ddns", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
    },
  });
}

export function useUpdateDdnsUpdater() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertDdnsUpdater> }) => {
      return apiRequest(`/api/ddns/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
    },
  });
}

export function useDeleteDdnsUpdater() {
  return useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/ddns/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
    },
  });
}

export function useManualDdnsUpdate() {
  return useMutation({
    mutationFn: async () => {
      return apiRequest("/api/ddns/manual/update", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
    },
  });
}
