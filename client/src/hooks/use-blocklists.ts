import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertBlocklist } from "@shared/schema";
import { apiFetch } from "@/lib/api";

export function useBlocklists() {
  return useQuery({
    queryKey: [api.blocklists.list.path],
    queryFn: async () => {
      const res = await apiFetch(api.blocklists.list.path);
      if (!res.ok) throw new Error("Failed to fetch blocklists");
      return api.blocklists.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateBlocklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertBlocklist) => {
      const validated = api.blocklists.create.input.parse(data);
      const res = await apiFetch(api.blocklists.create.path, {
        method: api.blocklists.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create blocklist entry");
      return api.blocklists.create.responses[201].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.blocklists.list.path] }),
  });
}

export function useUpdateBlocklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertBlocklist> }) => {
      const validated = api.blocklists.update.input.parse(data);
      const url = buildUrl(api.blocklists.update.path, { id });
      const res = await apiFetch(url, {
        method: api.blocklists.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update blocklist entry");
      return api.blocklists.update.responses[200].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.blocklists.list.path] }),
  });
}

export function useDeleteBlocklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.blocklists.delete.path, { id });
      const res = await apiFetch(url, { method: api.blocklists.delete.method });
      if (!res.ok) throw new Error("Failed to delete blocklist entry");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.blocklists.list.path] }),
  });
}
