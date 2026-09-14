import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type OneSignalStatus = {
  connected: boolean;
  configured: boolean;
  message: string;
};

export function useOneSignalStatus() {
  return useQuery({
    queryKey: ["/api/integrations/onesignal/status"],
    queryFn: async () => {
      const response = await apiFetch("/api/integrations/onesignal/status");
      const status = await response.json() as OneSignalStatus;
      if (!response.ok) {
        throw new Error(status.message || "OneSignal connection is unavailable.");
      }
      return status;
    },
    retry: false,
    staleTime: 60000,
  });
}