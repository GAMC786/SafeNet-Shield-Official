import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { AiShieldResult, ProtectionStatus, SafeNetVpn } from "@/hooks/use-vpn";

const idleResult: AiShieldResult = {
  state: "capture_unavailable",
  source: "none",
  confidence: null,
  modelVersion: "safenet-nudity-engine-1.0.0",
  timestamp: 0,
  message: "AI Shield monitoring is idle.",
  monitoring: false,
};

export function useAiShield() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<AiShieldResult | null>(supported ? null : idleResult);
  const [protection, setProtection] = useState<ProtectionStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) {
      return idleResult;
    }
    try {
      const nextStatus = await SafeNetVpn.getAiShieldStatus();
      setStatus(nextStatus);
      setError(null);
      return nextStatus;
    } catch (statusError) {
      const message = statusError instanceof Error
        ? statusError.message
        : "Android could not read AI Shield status.";
      setError(message);
      return null;
    }
  }, [supported]);

  const refreshProtection = useCallback(async () => {
    if (!supported) {
      return null;
    }
    try {
      const nextProtection = await SafeNetVpn.getProtectionStatus();
      setProtection(nextProtection);
      return nextProtection;
    } catch (statusError) {
      const message = statusError instanceof Error
        ? statusError.message
        : "Android could not read network protection status.";
      setProtection({
        state: "protection_unavailable",
        timestamp: Date.now(),
        safeNetVpnRunning: false,
        safeNetOwnsActiveVpn: false,
        otherVpnActive: false,
        activeNetwork: false,
        scope: "SafeNet protection status is unavailable.",
        message,
        proxyState: "proxy_uninspectable",
        proxyMessage: "Private browser proxies cannot be inspected by SafeNet.",
        limitations: ["Reconnect SafeNet protection before treating DNS filtering as active."],
      });
      return null;
    }
  }, [supported]);

  useEffect(() => {
    if (!supported) {
      return;
    }
    void refresh();
    void refreshProtection();
    const interval = window.setInterval(() => {
      void refreshProtection();
    }, 2000);
    let listener: { remove: () => Promise<void> } | null = null;
    let disposed = false;
    void SafeNetVpn.addListener("aiShieldResult", (result) => {
      setStatus(result);
      setError(null);
    }).then((nextListener) => {
      if (disposed) {
        void nextListener.remove();
      } else {
        listener = nextListener;
      }
    }).catch(() => undefined);
    return () => {
      window.clearInterval(interval);
      disposed = true;
      if (listener) {
        void listener.remove();
      }
    };
  }, [refresh, refreshProtection, supported]);

  const run = useCallback(async (
    action: () => Promise<AiShieldResult>,
  ) => {
    if (!supported) {
      throw new Error("AI Shield camera and screen monitoring are available in the Android APK.");
    }
    setIsBusy(true);
    setError(null);
    try {
      const nextStatus = await action();
      setStatus(nextStatus);
      return nextStatus;
    } catch (actionError) {
      const message = actionError instanceof Error
        ? actionError.message
        : "AI Shield could not update its monitoring state.";
      setError(message);
      throw actionError;
    } finally {
      setIsBusy(false);
    }
  }, [supported]);

  const startCamera = useCallback(
    () => run(() => SafeNetVpn.startAiShieldCamera()),
    [run],
  );
  const startScreen = useCallback(
    () => run(() => SafeNetVpn.startAiShieldScreen()),
    [run],
  );
  const stop = useCallback(
    () => run(() => SafeNetVpn.stopAiShield()),
    [run],
  );

  return {
    supported,
    status,
    protection,
    isBusy,
    error,
    refresh,
    startCamera,
    startScreen,
    stop,
  };
}