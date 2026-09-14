import { useCallback, useEffect, useState } from "react";
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

  const refresh = useCallback(async () => {
    if (!supported) return unsupportedStatus;
    try {
      const nextStatus = await SafeNetVpn.getTetherStatus();
      setStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      const nextStatus: TetherShareStatus = {
        ...(status ?? unsupportedStatus),
        supported: true,
        lastError: error instanceof Error ? error.message : "Android could not read Internet Share status.",
      };
      setStatus(nextStatus);
      return nextStatus;
    }
  }, [status, supported]);

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
      const nextStatus = await SafeNetVpn.startTetherShare();
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, [supported]);

  const stop = useCallback(async () => {
    if (!supported) return unsupportedStatus;
    setIsBusy(true);
    try {
      const nextStatus = await SafeNetVpn.stopTetherShare();
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, [supported]);

  const openWifiSettings = useCallback(async () => {
    if (supported) await SafeNetVpn.openTetherWifiSettings();
  }, [supported]);

  return { supported, status, isBusy, refresh, start, stop, openWifiSettings };
}