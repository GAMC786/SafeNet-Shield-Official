import { useCallback, useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { enqueueNativeCommand } from "@/lib/native-command-queue";

type LocalVpnStatus = { connected: boolean; mode: "local"; error?: string };
export type LocalVpnResolver = {
  type: "plain" | "doh" | "dot" | "sdns";
  primaryAddress: string;
  secondaryAddress?: string | null;
};
type LocalVpnPlugin = {
  getStatus(): Promise<LocalVpnStatus>;
  start(resolver: LocalVpnResolver): Promise<LocalVpnStatus>;
  stop(): Promise<LocalVpnStatus>;
};

const LocalVpn = registerPlugin<LocalVpnPlugin>("SafeNetLocalVpn");

export function useLocalVpn() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<LocalVpnStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) return null;
    try {
      const next = await enqueueNativeCommand(() => LocalVpn.getStatus());
      setStatus(next);
      setError(next.error ?? null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Local VPN status is unavailable.");
      return null;
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
    if (!supported) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [refresh, supported]);

  const run = useCallback(async (action: "start" | "stop", resolver?: LocalVpnResolver) => {
    setBusy(true);
    setError(null);
    try {
      let next: LocalVpnStatus;
      if (action === "start") {
        if (!resolver) throw new Error("Select an active DNS server first.");
        next = await enqueueNativeCommand(() => LocalVpn.start(resolver));
      } else {
        next = await enqueueNativeCommand(() => LocalVpn.stop());
      }
      setStatus(next);
      window.setTimeout(() => void refresh(), 500);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change local VPN state.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return {
    supported,
    connected: status?.connected === true,
    busy,
    error,
    refresh,
    start: (resolver: LocalVpnResolver) => run("start", resolver),
    stop: () => run("stop"),
  };
}
