import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { enqueueNativeCommand } from "@/lib/native-command-queue";
import { SafeNetVpn } from "@/hooks/use-vpn";

export interface VpnProxyBrowserBlockerStatus {
  supported: boolean;
  enabled: boolean;
  active: boolean;
  accessibilityServiceEnabled: boolean;
  blockedPackages: string[];
  message: string;
}

export interface VpnProxyBrowserApp {
  packageName: string;
  displayName: string;
}

const browserStatus: VpnProxyBrowserBlockerStatus = {
  supported: false,
  enabled: false,
  active: false,
  accessibilityServiceEnabled: false,
  blockedPackages: [],
  message: "The launch blocker is available in the SafeNet Android app.",
};

export function useVpnProxyBrowserBlocker() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<VpnProxyBrowserBlockerStatus>(
    supported
      ? {
          ...browserStatus,
          supported: true,
          message: "Checking VPN and proxy browser blocker status…",
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
        active: false,
        accessibilityServiceEnabled: false,
        blockedPackages: [],
        message: "VPN and proxy browser blocker status is unavailable.",
      };
      setStatus(unavailable);
      return unavailable;
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!supported) return status;
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
    },
    [refresh, status, supported],
  );

  const setBlockedPackages = useCallback(
    async (packageNames: string[]) => {
      if (!supported) return status;
      setIsBusy(true);
      try {
        const nextStatus = await enqueueNativeCommand(() =>
          SafeNetVpn.setVpnProxyBrowserBlockedPackages({ packageNames }),
        );
        setStatus(nextStatus);
        return nextStatus;
      } catch (error) {
        await refresh();
        throw error;
      } finally {
        setIsBusy(false);
      }
    },
    [refresh, status, supported],
  );

  const getLaunchableApps = useCallback(async () => {
    if (!supported) return [];
    const result = await enqueueNativeCommand(() =>
      SafeNetVpn.getVpnProxyBrowserBlockerApps(),
    );
    return result.apps;
  }, [supported]);

  const openAccessibilitySettings = useCallback(async () => {
    if (!supported) return;
    await enqueueNativeCommand(() =>
      SafeNetVpn.openVpnProxyBrowserBlockerAccessibilitySettings(),
    );
  }, [supported]);

  return {
    supported,
    status,
    isBusy,
    refresh,
    setEnabled,
    setBlockedPackages,
    getLaunchableApps,
    openAccessibilitySettings,
  };
}