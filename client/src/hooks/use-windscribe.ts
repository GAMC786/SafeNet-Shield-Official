import { Capacitor, registerPlugin } from "@capacitor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueNativeCommand } from "@/lib/native-command-queue";

export interface WindscribeVpnStatus {
  supported: boolean;
  profileImported: boolean;
  connected: boolean;
  resolverStampConfigured?: boolean;
  sdnsApplied?: boolean;
  sdnsError?: string;
  dnsError?: string;
  error?: string;
}

export interface WindscribeResolverOptions {
  resolverStamp?: string | null;
}

interface SafeNetWindscribePlugin {
  getStatus(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
  importProfile(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
  connect(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
  disconnect(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
  removeProfile(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
}

const SafeNetWindscribe = registerPlugin<SafeNetWindscribePlugin>("SafeNetWindscribe");
const STATUS_KEY = ["windscribe", "native-status"] as const;

export function useWindscribeVpn(resolverStamp: string | null = null) {
  const isAndroid = Capacitor.getPlatform() === "android";
  const queryClient = useQueryClient();
  const resolverOptions: WindscribeResolverOptions = { resolverStamp };
  const query = useQuery({
    queryKey: [...STATUS_KEY, resolverStamp] as const,
    queryFn: () => enqueueNativeCommand(() => SafeNetWindscribe.getStatus(resolverOptions)),
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
    const nextStatus = await enqueueNativeCommand(() => SafeNetWindscribe[action](resolverOptions));
    queryClient.setQueryData([...STATUS_KEY, resolverStamp], nextStatus);
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