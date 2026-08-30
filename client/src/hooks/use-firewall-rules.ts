import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { FirewallRule, InsertFirewallRule } from "@shared/schema";
import { apiFetch } from "@/lib/api";

export function useFirewallRules() {
  return useQuery({
    queryKey: ["/api/firewall/rules"],
    queryFn: async () => {
      const response = await apiFetch("/api/firewall/rules");
      if (!response.ok) throw new Error("Failed to fetch firewall rules");
      return response.json() as Promise<FirewallRule[]>;
    },
  });
}

export function useCreateFirewallRule() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: InsertFirewallRule) => {
      const response = await apiFetch("/api/firewall/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create firewall rule");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/rules"] });
      toast({ title: "Success", description: "Firewall rule created" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to create firewall rule",
        variant: "destructive"
      });
    },
  });
}

export function useUpdateFirewallRule() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertFirewallRule> }) => {
      return apiFetch(`/api/firewall/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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
      return apiFetch(`/api/firewall/rules/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firewall/rules"] });
    },
  });
}
