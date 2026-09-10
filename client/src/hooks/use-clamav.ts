import { useQuery } from "@tanstack/react-query";

export type ClamAvStatus = {
  configured: boolean;
  reachable: boolean;
  message: string;
};

export function useClamAvStatus() {
  return useQuery<ClamAvStatus>({
    queryKey: ["/api/antivirus/clamav/status"],
    queryFn: async () => {
      const response = await fetch("/api/antivirus/clamav/status");
      if (!response.ok) throw new Error("ClamAV status could not be read");
      return response.json() as Promise<ClamAvStatus>;
    },
    staleTime: 30_000,
    retry: false,
  });
}