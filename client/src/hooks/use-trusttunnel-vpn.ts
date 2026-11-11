import { Capacitor, registerPlugin } from "@capacitor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueNativeCommand } from "@/lib/native-command-queue";

export interface TrustTunnelStatus {
  supported: boolean;
  configured: boolean;
  state: string;
  connected: boolean;
  connecting: boolean;
}

interface TrustTunnelPlugin {
  getStatus(): Promise<TrustTunnelStatus>;
  importConfig(options: { deepLink: string }): Promise<TrustTunnelStatus>;
  connect(): Promise<TrustTunnelStatus>;
  disconnect(): Promise<TrustTunnelStatus>;
  removeConfig(): Promise<TrustTunnelStatus>;
}

const nativePlugin = registerPlugin<TrustTunnelPlugin>("SafeNetTrustTunnel");
const STATUS_KEY = ["trusttunnel", "native-status"] as const;

export function useTrustTunnelVpn() {
  const isAndroid = Capacitor.getPlatform() === "android";
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => enqueueNativeCommand(() => nativePlugin.getStatus()),
    enabled: isAndroid,
    refetchInterval: isAndroid ? 3000 : false,
    retry: 1,
  });

  const run = async (
    action: () => Promise<TrustTunnelStatus>,
  ): Promise<TrustTunnelStatus> => {
    if (!isAndroid) {
      throw new Error("The TrustTunnel VPN is available in SafeNet for Android.");
    }
    const status = await enqueueNativeCommand(action);
    queryClient.setQueryData(STATUS_KEY, status);
    return status;
  };

  return {
    isAndroid,
    status: query.data,
    isLoading: isAndroid && query.isLoading,
    error: query.error,
    importConfig: (deepLink: string) => run(() => nativePlugin.importConfig({ deepLink })),
    connect: () => run(() => nativePlugin.connect()),
    disconnect: () => run(() => nativePlugin.disconnect()),
    removeConfig: () => run(() => nativePlugin.removeConfig()),
  };
}
