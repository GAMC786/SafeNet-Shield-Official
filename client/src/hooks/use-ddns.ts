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
    queryKey: ["/api/public-ip"],
    queryFn: async () => {
      const response = await fetch("/api/public-ip");
      return response.json() as Promise<{ ip: string }>;
    },
    staleTime: 60000,
  });
}
