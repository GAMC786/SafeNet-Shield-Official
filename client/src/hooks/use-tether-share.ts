import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { SafeNetVpn } from "@/hooks/use-vpn";

export interface TetherShareDevice {
  name: string;
  address: string;
}

export interface TetherShareStatus {
  supported: boolean;
  running: boolean;
  starting: boolean;
  networkName?: string | null;
  passphrase?: string | null;
  proxyHost?: string | null;
  proxyPort?: number | null;
  connectedDevices: TetherShareDevice[];
  groupOwner: boolean;
  lastError?: string | null;
  requiresManualProxy: boolean;
}

const unsupportedStatus: TetherShareStatus = {
  supported: false,
  running: false,
  starting: false,
  connectedDevices: [],
  groupOwner: false,
  requiresManualProxy: true,
};

export function useTetherShare() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<TetherShareStatus | null>(
    supported ? null : unsupportedStatus,
  );
  const [isBusy, setIsBusy] = useState(false);
  const nativeQueueRef = useRef<Promise<void>>(Promise.resolve());

  const enqueueNative = useCallback(<T,>(operation: () => Promise<T>) => {
    const queued = nativeQueueRef.current
      .catch(() => undefined)
      .then(operation);
    nativeQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, []);

  const refresh = useCallback(async () => {
    if (!supported) return unsupportedStatus;
    try {
      const nextStatus = await enqueueNative(() => SafeNetVpn.getTetherStatus());
      setStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      setStatus((previous) => ({
        ...(previous ?? unsupportedStatus),
        supported: true,
        lastError: error instanceof Error ? error.message : "Android could not read Internet Share status.",
      }));
      return null;
    }
  }, [enqueueNative, supported]);

  useEffect(() => {
    if (!supported) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(interval);
  }, [refresh, supported]);

  const start = useCallback(async () => {
    if (!supported) return unsupportedStatus;
    setIsBusy(true);
    try {
      const nextStatus = await enqueueNative(() => SafeNetVpn.startTetherShare());
      setStatus(nextStatus);
      await refresh().catch(() => null);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, [enqueueNative, refresh, supported]);

  const stop = useCallback(async () => {
    if (!supported) return unsupportedStatus;
    setIsBusy(true);
    try {
      const nextStatus = await enqueueNative(() => SafeNetVpn.stopTetherShare());
      setStatus(nextStatus);
      await refresh().catch(() => null);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, [enqueueNative, refresh, supported]);

  const openWifiSettings = useCallback(async () => {
    if (supported) await SafeNetVpn.openTetherWifiSettings();
  }, [supported]);

  return { supported, status, isBusy, refresh, start, stop, openWifiSettings };
}