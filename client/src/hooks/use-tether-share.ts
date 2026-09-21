import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { SafeNetVpn } from "@/hooks/use-vpn";
import { enqueueNativeCommand } from "@/lib/native-command-queue";

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
  httpProxyPort?: number | null;
  socksProxyPort?: number | null;
  httpProxySupported?: boolean;
  socksProxySupported?: boolean;
  connectedDevices: TetherShareDevice[];
  groupOwner: boolean;
  permissionGranted?: boolean;
  lastError?: string | null;
  requiresManualProxy: boolean;
}

const unsupportedStatus: TetherShareStatus = {
  supported: false,
  running: false,
  starting: false,
  connectedDevices: [],
  groupOwner: false,
  permissionGranted: false,
  requiresManualProxy: true,
};

export function useTetherShare() {
  const supported = Capacitor.getPlatform() === "android";
  const pendingStartRef = useRef(false);
  const [status, setStatus] = useState<TetherShareStatus | null>(
    supported ? null : unsupportedStatus,
  );
  const [isBusy, setIsBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported) return unsupportedStatus;
    try {
      const nextStatus = await enqueueNativeCommand(() => SafeNetVpn.getTetherStatus());
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
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(interval);
  }, [refresh, supported]);

  const start = useCallback(async () => {
    if (!supported) return unsupportedStatus;
    pendingStartRef.current = true;
    setIsBusy(true);
    try {
      const nextStatus = await enqueueNativeCommand(() => SafeNetVpn.startTetherShare());
      pendingStartRef.current = false;
      setStatus(nextStatus);
      await refresh().catch(() => null);
      return nextStatus;
    } catch (error) {
      // Keep the intent pending when Android sent the user to permission
      // settings. Returning to the app will retry once Nearby devices is
      // granted instead of requiring a second toggle tap.
      await refresh().catch(() => null);
      throw error;
    } finally {
      setIsBusy(false);
    }
  }, [refresh, supported]);

  const stop = useCallback(async () => {
    if (!supported) return unsupportedStatus;
    pendingStartRef.current = false;
    setIsBusy(true);
    try {
      const nextStatus = await enqueueNativeCommand(() => SafeNetVpn.stopTetherShare());
      setStatus(nextStatus);
      await refresh().catch(() => null);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, [refresh, supported]);

  useEffect(() => {
    if (!supported) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        const nextStatus = await refresh();
        if (
          pendingStartRef.current &&
          nextStatus?.permissionGranted === true &&
          !nextStatus.running
        ) {
          await start().catch(() => null);
        }
      })();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [refresh, start, supported]);

  const openWifiSettings = useCallback(async () => {
    if (supported) await enqueueNativeCommand(() => SafeNetVpn.openTetherWifiSettings());
  }, [supported]);

  const openAppSettings = useCallback(async () => {
    if (supported) await enqueueNativeCommand(() => SafeNetVpn.openTetherAppSettings());
  }, [supported]);

  return { supported, status, isBusy, refresh, start, stop, openWifiSettings, openAppSettings };
}