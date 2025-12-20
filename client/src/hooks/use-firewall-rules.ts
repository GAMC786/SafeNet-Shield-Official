import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { FirewallRule, InsertFirewallRule } from "@shared/schema";

export function useFirewallRules() {
  return useQuery({
    queryKey: ["/api/firewall/rules"],
    queryFn: async () => {
      const response = await fetch("/api/firewall/rules");
      return response.json() as Promise<FirewallRule[]>;
    },
  });
}

export function useCreateFirewallRule() {
  return useMutation({
    mutationFn: async (data: InsertFirewallRule) => {
      return apiRequest("/api/firewall/rules", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/rules"] });
    },
  });
}

export function useUpdateFirewallRule() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertFirewallRule> }) => {
      return apiRequest(`/api/firewall/rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/rules"] });
    },
  });
}

export function useDeleteFirewallRule() {
  return useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/firewall/rules/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/rules"] });
    },
  });
}
