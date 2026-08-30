import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type errorSchemas } from "@shared/routes";
import { type InsertDnsServer, type DnsServer } from "@shared/schema";
import { z } from "zod";
import { apiFetch } from "@/lib/api";

export function useDnsServers() {
  return useQuery({
    queryKey: [api.dns.list.path],
    queryFn: async () => {
      const res = await apiFetch(api.dns.list.path);
      if (!res.ok) throw new Error("Failed to fetch DNS servers");
      return api.dns.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateDnsServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertDnsServer) => {
      const validated = api.dns.create.input.parse(data);
      const res = await apiFetch(api.dns.create.path, {
        method: api.dns.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 400) {
           // Try to parse error response
           const error = await res.json();
           throw new Error(error.message || "Validation failed");
        }
        throw new Error("Failed to create DNS server");
      }
      return api.dns.create.responses[201].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.dns.list.path] }),
  });
}

export function useUpdateDnsServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<InsertDnsServer>) => {
      const validated = api.dns.update.input.parse(data);
      const url = buildUrl(api.dns.update.path, { id });
      const res = await apiFetch(url, {
        method: api.dns.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update DNS server");
      return api.dns.update.responses[200].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.dns.list.path] }),
  });
}

export function useDeleteDnsServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.dns.delete.path, { id });
      const res = await apiFetch(url, { method: api.dns.delete.method });
      if (!res.ok) throw new Error("Failed to delete DNS server");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.dns.list.path] }),
  });
}

export function useActivateDnsServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.dns.activate.path, { id });
      const res = await apiFetch(url, { method: api.dns.activate.method });
      if (!res.ok) throw new Error("Failed to activate DNS server");
      return api.dns.activate.responses[200].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.dns.list.path] }),
  });
}
