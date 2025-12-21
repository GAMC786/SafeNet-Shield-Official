import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AntivirusSettings, ThreatFeed, AntivirusEvent, InsertThreatFeed, InsertAntivirusSettings } from "@shared/schema";

export function useAntivirusSettings() {
  return useQuery<AntivirusSettings>({
    queryKey: ["/api/antivirus/settings"],
  });
}

export function useUpdateAntivirusSettings() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Partial<InsertAntivirusSettings>) => {
      const res = await apiRequest("PUT", "/api/antivirus/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/settings"] });
      toast({ title: "Success", description: "Antivirus settings updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update settings", variant: "destructive" });
    },
  });
}

export function useThreatFeeds() {
  return useQuery<ThreatFeed[]>({
    queryKey: ["/api/antivirus/feeds"],
  });
}

export function useCreateThreatFeed() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: InsertThreatFeed) => {
      const res = await apiRequest("POST", "/api/antivirus/feeds", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/feeds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/stats"] });
      toast({ title: "Success", description: "Threat feed added" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to add threat feed", variant: "destructive" });
    },
  });
}

export function useUpdateThreatFeed() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertThreatFeed> }) => {
      const res = await apiRequest("PATCH", `/api/antivirus/feeds/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/feeds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/stats"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update threat feed", variant: "destructive" });
    },
  });
}

export function useDeleteThreatFeed() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/antivirus/feeds/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/feeds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/stats"] });
      toast({ title: "Success", description: "Threat feed removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to remove threat feed", variant: "destructive" });
    },
  });
}

export function useAntivirusEvents() {
  return useQuery<AntivirusEvent[]>({
    queryKey: ["/api/antivirus/events"],
  });
}

export function useResolveAntivirusEvent() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/antivirus/events/${id}/resolve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/stats"] });
      toast({ title: "Success", description: "Event marked as resolved" });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/stats"] });
      toast({ title: "Error", description: error.message || "Failed to resolve event", variant: "destructive" });
    },
  });
}

export function useAntivirusStats() {
  return useQuery<{ totalThreats: number; blockedToday: number; activeFeeds: number }>({
    queryKey: ["/api/antivirus/stats"],
  });
}
