import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { enqueueNativeCommand } from "@/lib/native-command-queue";
import { SafeNetVpn, type VpnProxyBrowserBlockerStatus } from "@/hooks/use-vpn";

const browserStatus: VpnProxyBrowserBlockerStatus = {
  supported: false,
  enabled: false,
  accessibilityEnabled: false,
  blockedPackageCount: 0,
  ready: false,
  message: "VPN and proxy browser blocking is available in the SafeNet Android app.",
};

export function useVpnProxyBrowserBlocker() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<VpnProxyBrowserBlockerStatus>(
    supported
      ? {
          supported: true,
          enabled: false,
          accessibilityEnabled: false,
          blockedPackageCount: 0,
          ready: false,
          message: "Checking VPN and proxy browser blocker support…",
        }
      : browserStatus,
  );
  const [isBusy, setIsBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported) {
      setStatus(browserStatus);
      return browserStatus;
    }
    try {
      const nextStatus = await enqueueNativeCommand(() =>
        SafeNetVpn.getVpnProxyBrowserBlockerStatus(),
      );
      setStatus(nextStatus);
      return nextStatus;
    } catch {
      const unavailable: VpnProxyBrowserBlockerStatus = {
        supported: true,
        enabled: false,
        accessibilityEnabled: false,
        blockedPackageCount: 0,
        ready: false,
        message: "VPN and proxy browser blocker status is unavailable.",
      };
      setStatus(unavailable);
      return unavailable;
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [refresh]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!supported) return null;
    setIsBusy(true);
    try {
      const nextStatus = await enqueueNativeCommand(() =>
        SafeNetVpn.setVpnProxyBrowserBlockerEnabled({ enabled }),
      );
      setStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      await refresh();
      throw error;
    } finally {
      setIsBusy(false);
    }
  }, [refresh, supported]);

  const openSettings = useCallback(async () => {
    if (!supported) return null;
    setIsBusy(true);
    try {
      const nextStatus = await enqueueNativeCommand(() =>
        SafeNetVpn.openVpnProxyBrowserBlockerSettings(),
      );
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, [supported]);

  return { supported, status, isBusy, refresh, setEnabled, openSettings };
}