import { useCallback, useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";

type LocalVpnStatus = { connected: boolean; mode: "local"; error?: string };
type LocalVpnPlugin = {
  getStatus(): Promise<LocalVpnStatus>;
  start(): Promise<LocalVpnStatus>;
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
      const next = await LocalVpn.getStatus();
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

  const run = useCallback(async (action: "start" | "stop") => {
    setBusy(true);
    setError(null);
    try {
      const next = await LocalVpn[action]();
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
    start: () => run("start"),
    stop: () => run("stop"),
  };
}
