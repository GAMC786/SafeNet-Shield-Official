import { Capacitor, registerPlugin } from "@capacitor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueNativeCommand } from "@/lib/native-command-queue";

export interface WindscribeVpnStatus {
  supported: boolean;
  profileImported: boolean;
  connected: boolean;
  error?: string;
}

interface SafeNetWindscribePlugin {
  getStatus(): Promise<WindscribeVpnStatus>;
  importProfile(): Promise<WindscribeVpnStatus>;
  connect(): Promise<WindscribeVpnStatus>;
  disconnect(): Promise<WindscribeVpnStatus>;
  removeProfile(): Promise<WindscribeVpnStatus>;
}

const SafeNetWindscribe = registerPlugin<SafeNetWindscribePlugin>("SafeNetWindscribe");
const STATUS_KEY = ["windscribe", "native-status"] as const;

export function useWindscribeVpn() {
  const isAndroid = Capacitor.getPlatform() === "android";
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => enqueueNativeCommand(() => SafeNetWindscribe.getStatus()),
    enabled: isAndroid,
    refetchInterval: isAndroid ? 5000 : false,
    retry: 1,
  });

  const runNativeAction = async (
    action: keyof Pick<
      SafeNetWindscribePlugin,
      "importProfile" | "connect" | "disconnect" | "removeProfile"
    >,
  ) => {
    if (!isAndroid) {
      throw new Error("Windscribe VPN controls are available in SafeNet for Android.");
    }
    const nextStatus = await enqueueNativeCommand(() => SafeNetWindscribe[action]());
    queryClient.setQueryData(STATUS_KEY, nextStatus);
    return nextStatus;
  };

  return {
    isAndroid,
    status: query.data,
    isLoading: isAndroid && query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refresh: query.refetch,
    importProfile: () => runNativeAction("importProfile"),
    connect: () => runNativeAction("connect"),
    disconnect: () => runNativeAction("disconnect"),
    removeProfile: () => runNativeAction("removeProfile"),
  };
}