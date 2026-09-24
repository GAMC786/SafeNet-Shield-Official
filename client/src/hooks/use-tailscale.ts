import { useCallback } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { enqueueNativeCommand } from "@/lib/native-command-queue";
import { tailscaleStatusSchema } from "@shared/tailscale";

const queryKey = ["/api/tailscale/status"];
const nativeQueryKey = ["tailscale-native-status"];

export interface TailscaleExitNode {
  id: string;
  name: string;
  online: boolean;
}

export interface TailscaleNativeStatus {
  supported: boolean;
  backendState: string;
  connected: boolean;
  loginRequired: boolean;
  authUrl?: string | null;
  selfName?: string | null;
  tailnetName?: string | null;
  addresses?: string[];
  exitNodes?: TailscaleExitNode[];
  selectedExitNodeId?: string | null;
  acceptRoutes: boolean;
  useTailscaleDNS: boolean;
  allowLanAccess: boolean;
  error?: string | null;
}

export interface TailscaleOptions {
  exitNodeId?: string | null;
  acceptRoutes?: boolean;
  useTailscaleDNS?: boolean;
  allowLanAccess?: boolean;
}

interface SafeNetTailscalePlugin {
  getStatus(): Promise<TailscaleNativeStatus>;
  connect(): Promise<TailscaleNativeStatus>;
  disconnect(): Promise<TailscaleNativeStatus>;
  setOptions(options: TailscaleOptions): Promise<TailscaleNativeStatus>;
  openLoginUrl(options: { url: string }): Promise<void>;
}

const SafeNetTailscale = registerPlugin<SafeNetTailscalePlugin>("SafeNetTailscale");

export function useTailscaleStatus() {
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(queryKey[0], { signal, timeoutMs: 8000 });
      if (!response.ok) throw new Error("Failed to check Tailscale status");
      return tailscaleStatusSchema.parse(await response.json());
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });
}

export function useTailscaleNative() {
  const queryClient = useQueryClient();
  const isAndroid = Capacitor.getPlatform() === "android";
  const status = useQuery({
    queryKey: nativeQueryKey,
    enabled: isAndroid,
    queryFn: () => enqueueNativeCommand(() => SafeNetTailscale.getStatus()),
    refetchInterval: isAndroid ? 5000 : false,
    refetchOnWindowFocus: true,
  });

  const refresh = useCallback(
    async (nextStatus: TailscaleNativeStatus) => {
      queryClient.setQueryData(nativeQueryKey, nextStatus);
      await queryClient.invalidateQueries({ queryKey: nativeQueryKey });
      return nextStatus;
    },
    [queryClient],
  );

  const connect = useCallback(async () => {
    const nextStatus = await enqueueNativeCommand(() => SafeNetTailscale.connect());
    await refresh(nextStatus);
    if (nextStatus.authUrl) {
      await enqueueNativeCommand(() =>
        SafeNetTailscale.openLoginUrl({ url: nextStatus.authUrl! }),
      );
    }
    return nextStatus;
  }, [refresh]);

  const disconnect = useCallback(async () => {
    const nextStatus = await enqueueNativeCommand(() => SafeNetTailscale.disconnect());
    return refresh(nextStatus);
  }, [refresh]);

  const setOptions = useCallback(
    async (options: TailscaleOptions) => {
      const nextStatus = await enqueueNativeCommand(() =>
        SafeNetTailscale.setOptions(options),
      );
      return refresh(nextStatus);
    },
    [refresh],
  );

  const openLoginUrl = useCallback(async (url: string) => {
    await enqueueNativeCommand(() => SafeNetTailscale.openLoginUrl({ url }));
  }, []);

  return {
    isAndroid,
    status: status.data,
    isLoading: isAndroid && status.isLoading,
    isFetching: status.isFetching,
    error: status.error,
    refetch: status.refetch,
    connect,
    disconnect,
    setOptions,
    openLoginUrl,
  };
}