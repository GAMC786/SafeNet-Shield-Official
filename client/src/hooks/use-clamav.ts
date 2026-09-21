import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type ClamAvStatus = {
  configured: boolean;
  reachable: boolean;
  verified: boolean;
  message: string;
  checkedAt: string;
  lastVerifiedAt: string | null;
  lastVerificationMessage: string | null;
  lastVerifiedEngineVersion: string | null;
  engineVersion?: string;
};

export type ClamAvScanResult = {
  verdict: "clean" | "threat" | "unknown";
  detected: boolean | null;
  threatName: string | null;
  message: string;
};

export type ClamAvVerification = {
  verified: boolean;
  verifiedAt: string;
  message: string;
  cleanScan: ClamAvScanResult | null;
  threatScan: ClamAvScanResult | null;
  engineVersion: string | null;
};

export function useClamAvStatus() {
  return useQuery<ClamAvStatus>({
    queryKey: ["/api/antivirus/clamav/status"],
    queryFn: async () => {
      const response = await apiFetch("/api/antivirus/clamav/status", { timeoutMs: 10000 });
      if (!response.ok) throw new Error("ClamAV status could not be read");
      return response.json() as Promise<ClamAvStatus>;
    },
    staleTime: 30_000,
    retry: false,
  });
}

export function useVerifyClamAv() {
  const queryClient = useQueryClient();
  return useMutation<ClamAvVerification, Error>({
    mutationFn: async () => {
      const response = await apiFetch("/api/antivirus/clamav/verify", {
        method: "POST",
        headers: { Accept: "application/json" },
        timeoutMs: 30000,
      });
      const body = await response.json() as ClamAvVerification & { message?: string };
      if (!response.ok) {
        throw new Error(body.message || "ClamAV verification could not be completed.");
      }
      return body;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["/api/antivirus/clamav/verification"], result);
      void queryClient.invalidateQueries({ queryKey: ["/api/antivirus/clamav/status"] });
    },
  });
}