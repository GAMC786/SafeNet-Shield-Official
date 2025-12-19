import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertBlocklist } from "@shared/schema";

export function useBlocklists() {
  return useQuery({
    queryKey: [api.blocklists.list.path],
    queryFn: async () => {
      const res = await fetch(api.blocklists.list.path, { credentials: "include" });
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
      const res = await fetch(api.blocklists.create.path, {
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

export function useDeleteBlocklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.blocklists.delete.path, { id });
      const res = await fetch(url, { method: api.blocklists.delete.method, credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete blocklist entry");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.blocklists.list.path] }),
  });
}
