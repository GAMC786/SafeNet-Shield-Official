import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type errorSchemas } from "@shared/routes";
import { type InsertDnsServer, type DnsServer } from "@shared/schema";
import { z } from "zod";
import { apiFetch } from "@/lib/api";

export function useDnsServers() {
  return useQuery({
    queryKey: [api.dns.list.path],
    queryFn: async () => {
      const res = await apiFetch(api.dns.list.path, { cache: "no-store" });
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
      const requestBody = JSON.stringify(validated);
      const createRequest = () =>
        apiFetch(api.dns.create.path, {
          method: api.dns.create.method,
          headers: { "Content-Type": "application/json" },
          body: requestBody,
          credentials: "include",
        });
      let res = await createRequest();

      // A long-lived Web tab can retain React state after the server session
      // has expired or been replaced. Refresh the auth session once before
      // reporting the create failure to the user.
      if (res.status === 401) {
        const authRes = await apiFetch(api.auth.status.path, { cache: "no-store" });
        if (authRes.ok) {
          const authStatus = api.auth.status.responses[200].parse(await authRes.json());
          if (authStatus.authenticated) {
            res = await createRequest();
          }
        }
      }

      if (!res.ok) {
        const error = await res.json().catch(() => null);
        const message =
          res.status === 401
            ? "Your session expired. Refresh the page and try again."
            : typeof error?.message === "string"
              ? error.message
              : res.status === 400
                ? "Check the DNS server name and primary address."
                : `Failed to create DNS server (${res.status}).`;
        throw new Error(message);
      }
      return api.dns.create.responses[201].parse(await res.json());
    },
    onSuccess: (createdServer) => {
      queryClient.setQueryData<DnsServer[]>(
        [api.dns.list.path],
        (servers = []) => (
          servers.some((server) => server.id === createdServer.id)
            ? servers
            : [...servers, createdServer]
        ),
      );
      void queryClient.invalidateQueries({ queryKey: [api.dns.list.path] });
    },
    onError: (error) => {
      if (error instanceof Error && error.message.includes("session expired")) {
        void queryClient.invalidateQueries({ queryKey: [api.auth.status.path] });
      }
    },
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
    onSuccess: (activatedServer) => {
      queryClient.setQueryData<DnsServer[]>(
        [api.dns.list.path],
        (servers = []) => servers.map((server) => ({
          ...server,
          isActive: server.id === activatedServer.id,
        })),
      );
      void queryClient.invalidateQueries({ queryKey: [api.dns.list.path] });
    },
  });
}
