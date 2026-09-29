import { Capacitor, registerPlugin } from "@capacitor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueNativeCommand } from "@/lib/native-command-queue";

export interface WindscribeVpnStatus {
  supported: boolean;
  credentialsConfigured?: boolean;
  connecting?: boolean;
  /** Kept as a compatibility alias while other dashboard status views migrate. */
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

export interface WindscribeCredentialInput {
  serverHost: string;
  username: string;
  password: string;
}

interface SafeNetWindscribePlugin {
  getStatus(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
  saveCredentials(options: WindscribeCredentialInput): Promise<WindscribeVpnStatus>;
  connect(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
  disconnect(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
  removeProfile(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
}

interface SafeNetWindscribeWireGuardPlugin {
  getStatus(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
  importProfile(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
  connect(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
  disconnect(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
  removeProfile(options?: WindscribeResolverOptions): Promise<WindscribeVpnStatus>;
}

const SafeNetWindscribe = registerPlugin<SafeNetWindscribePlugin>("SafeNetWindscribeIke");
const SafeNetWindscribeWireGuard =
  registerPlugin<SafeNetWindscribeWireGuardPlugin>("SafeNetWindscribe");
const STATUS_KEY = ["windscribe", "native-status"] as const;
const WIREGUARD_STATUS_KEY = ["windscribe", "wireguard-legacy-status"] as const;

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
      "connect" | "disconnect" | "removeProfile"
    >,
  ) => {
    if (!isAndroid) {
      throw new Error("Windscribe VPN controls are available in SafeNet for Android.");
    }
    const nextStatus = await enqueueNativeCommand(() => SafeNetWindscribe[action](resolverOptions));
    queryClient.setQueryData([...STATUS_KEY, resolverStamp], nextStatus);
    return nextStatus;
  };

  const saveCredentials = async (credentials: WindscribeCredentialInput) => {
    if (!isAndroid) {
      throw new Error("Windscribe IKEv2 setup is available in SafeNet for Android.");
    }
    const nextStatus = await enqueueNativeCommand(() =>
      SafeNetWindscribe.saveCredentials(credentials),
    );
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
    saveCredentials,
    connect: () => runNativeAction("connect"),
    disconnect: () => runNativeAction("disconnect"),
    removeProfile: () => runNativeAction("removeProfile"),
  };
}

/** Retains the previous WireGuard profile route as a migration fallback. */
export function useWindscribeWireGuardFallback(resolverStamp: string | null = null) {
  const isAndroid = Capacitor.getPlatform() === "android";
  const queryClient = useQueryClient();
  const resolverOptions: WindscribeResolverOptions = { resolverStamp };
  const query = useQuery({
    queryKey: [...WIREGUARD_STATUS_KEY, resolverStamp] as const,
    queryFn: () =>
      enqueueNativeCommand(() => SafeNetWindscribeWireGuard.getStatus(resolverOptions)),
    enabled: isAndroid,
    refetchInterval: isAndroid ? 5000 : false,
    retry: 1,
  });

  const runNativeAction = async (
    action: keyof Pick<
      SafeNetWindscribeWireGuardPlugin,
      "importProfile" | "connect" | "disconnect" | "removeProfile"
    >,
  ) => {
    if (!isAndroid) {
      throw new Error("Windscribe WireGuard fallback is available in SafeNet for Android.");
    }
    const nextStatus = await enqueueNativeCommand(() =>
      SafeNetWindscribeWireGuard[action](resolverOptions),
    );
    queryClient.setQueryData([...WIREGUARD_STATUS_KEY, resolverStamp], nextStatus);
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