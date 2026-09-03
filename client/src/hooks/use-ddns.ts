import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { PublicDdnsUpdater, InsertDdnsUpdater } from "@shared/schema";
import { apiFetch } from "@/lib/api";

export interface PublicIpInfo {
  ip: string;
  isp?: string;
  organization?: string;
  asn?: string;
  countryCode?: string;
}

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
      // Keep lookup same-origin so browser CORS/rate limits cannot break the
      // DDNS card. The server uses the trusted proxy address when available.
      const response = await apiFetch("/api/public-ip", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not detect the public IP address");
      return await response.json() as PublicIpInfo;
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

export function useRapidDdnsSync(enabled: boolean) {
  const lastIp = useRef<string | null>(null);
  const pollInFlight = useRef(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      lastIp.current = null;
      setError(null);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;

      try {
        const response = await apiFetch("/api/public-ip?enrich=false", {
          cache: "no-store",
          timeoutMs: 3000,
        });
        if (!response.ok) {
          throw new Error("Public IP check failed");
        }
        const data = await response.json() as PublicIpInfo;
        if (!data.ip) throw new Error("Public IP response was incomplete");

        if (lastIp.current !== data.ip) {
          await apiRequest("POST", "/api/ddns/sync", { clientIp: data.ip });
          lastIp.current = data.ip;
          if (!cancelled) {
            setLastSyncedAt(Date.now());
            queryClient.invalidateQueries({ queryKey: ["/api/ddns"] });
          }
        }

        if (!cancelled) {
          setLastCheckedAt(Date.now());
          setError(null);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : "DDNS monitor unavailable");
        }
      } finally {
        pollInFlight.current = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled]);

  return { lastCheckedAt, lastSyncedAt, error };
}
