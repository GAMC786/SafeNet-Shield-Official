import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { PublicDdnsUpdater, InsertDdnsUpdater } from "@shared/schema";
import { apiFetch } from "@/lib/api";

export function useDdnsUpdaters() {
  return useQuery({
    queryKey: ["/api/ddns"],
    queryFn: async () => {
      const response = await apiFetch("/api/ddns");
      if (!response.ok) throw new Error("Failed to fetch DDNS updaters");
      return response.json() as Promise<PublicDdnsUpdater[]>;
    },
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
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertDdnsUpdater> }) => {
      return apiRequest("PATCH", `/api/ddns/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
    },
  });
}

export function useDeleteDdnsUpdater() {
  return useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/ddns/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
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
      return apiRequest("POST", "/api/ddns/update-all", { clientIp });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
    },
  });
}
