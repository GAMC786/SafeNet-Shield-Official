import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AntivirusSettings, ThreatFeed, AntivirusEvent, InsertThreatFeed, InsertAntivirusSettings } from "@shared/schema";

export function useAntivirusSettings() {
  return useQuery<AntivirusSettings>({
    queryKey: ["/api/antivirus/settings"],
  });
}

export function useUpdateAntivirusSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: Partial<InsertAntivirusSettings>) => {
      const res = await apiRequest("PUT", "/api/antivirus/settings", data);
      return res.json();
    },
    onMutate: async (data) => {
      const queryKey = ["/api/antivirus/settings"];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<AntivirusSettings>(queryKey);
      queryClient.setQueryData<AntivirusSettings>(queryKey, (current) => (
        current ? { ...current, ...data } : current
      ));
      return { previous };
    },
    onSuccess: (updatedSettings) => {
      queryClient.setQueryData(["/api/antivirus/settings"], updatedSettings);
      void queryClient.invalidateQueries({ queryKey: ["/api/antivirus/settings"] });
    },
    onError: (error: Error, _data, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/antivirus/settings"], context.previous);
      }
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
    },
    onError: (error: Error) => {
      toast({ title: "Threat feed could not be added", description: error.message || "Failed to add threat feed", variant: "destructive" });
    },
  });
}

export function useUpdateThreatFeed() {
  const feedQueryClient = useQueryClient();
  const { toast } = useToast();
  const latestMutationIds = useRef(new Map<number, number>());
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertThreatFeed> }) => {
      const res = await apiRequest("PATCH", `/api/antivirus/feeds/${id}`, data);
      const updatedFeed = await res.json() as ThreatFeed;
      if (!updatedFeed || typeof updatedFeed.id !== "number") {
        throw new Error("Threat feed update returned an invalid response");
      }
      return updatedFeed;
    },
    onMutate: async ({ id, data }) => {
      const mutationId = (latestMutationIds.current.get(id) ?? 0) + 1;
      latestMutationIds.current.set(id, mutationId);
      const queryKey = ["/api/antivirus/feeds"];
      await feedQueryClient.cancelQueries({ queryKey });
      const previous = feedQueryClient.getQueryData<ThreatFeed[]>(queryKey);
      const previousFeed = previous?.find((feed) => feed.id === id);
      feedQueryClient.setQueryData<ThreatFeed[]>(queryKey, (current) =>
        current?.map((feed) => feed.id === id ? { ...feed, ...data } : feed),
      );
      return { previous, previousFeed, feedId: id, mutationId };
    },
    onSuccess: (updatedFeed, _variables, context) => {
      if (!context || context.mutationId !== latestMutationIds.current.get(context.feedId)) {
        return;
      }
      feedQueryClient.setQueryData<ThreatFeed[]>(
        ["/api/antivirus/feeds"],
        (current) => current?.map((feed) => feed.id === updatedFeed.id ? { ...feed, ...updatedFeed } : feed),
      );
      void feedQueryClient.invalidateQueries({ queryKey: ["/api/antivirus/feeds"] });
      void feedQueryClient.invalidateQueries({ queryKey: ["/api/antivirus/stats"] });
    },
    onError: (error: Error, _data, context) => {
      const feedId = context?.feedId;
      const previousFeed = context?.previousFeed;
      if (context && feedId !== undefined && previousFeed &&
        context.mutationId === latestMutationIds.current.get(feedId)
      ) {
        feedQueryClient.setQueryData<ThreatFeed[]>(
          ["/api/antivirus/feeds"],
          (current) => current?.map((feed) =>
            feed.id === feedId ? previousFeed : feed
          ),
        );
      }
      toast({ title: "Threat feed could not be updated", description: error.message || "Failed to update threat feed", variant: "destructive" });
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
      toast({ title: "Threat feed removed", description: "The feed was removed from SafeNet protection." });
    },
    onError: (error: Error) => {
      toast({ title: "Threat feed could not be removed", description: error.message || "Failed to remove threat feed", variant: "destructive" });
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
      toast({ title: "Threat event resolved", description: "The event was marked as resolved." });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/antivirus/stats"] });
      toast({ title: "Threat event could not be resolved", description: error.message || "Failed to resolve event", variant: "destructive" });
    },
  });
}

export function useAntivirusStats() {
  return useQuery<{ totalThreats: number; blockedToday: number; activeFeeds: number }>({
    queryKey: ["/api/antivirus/stats"],
  });
}
