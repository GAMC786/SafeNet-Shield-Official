import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { enqueueNativeCommand } from "@/lib/native-command-queue";
import { SafeNetVpn } from "@/hooks/use-vpn";

export interface AppLockStatus {
  supported: boolean;
  enabled: boolean;
  available: boolean;
  locked: boolean;
  message: string;
}

const browserStatus: AppLockStatus = {
  supported: false,
  enabled: false,
  available: false,
  locked: false,
  message: "AndroidX Secure App Lock is available in the SafeNet Android app.",
};

export function useAppLock() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<AppLockStatus>(
    supported
      ? {
          supported: true,
          enabled: false,
          available: false,
          locked: false,
          message: "Checking Android authentication support…",
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
      const nextStatus = await enqueueNativeCommand(() => SafeNetVpn.getAppLockStatus());
      setStatus(nextStatus);
      return nextStatus;
    } catch {
      const unavailable: AppLockStatus = {
        supported: true,
        enabled: false,
        available: false,
        locked: false,
        message: "AndroidX Secure App Lock status is unavailable.",
      };
      setStatus(unavailable);
      return unavailable;
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!supported) return null;
      setIsBusy(true);
      try {
        const nextStatus = await enqueueNativeCommand(() =>
          SafeNetVpn.setAppLockEnabled({ enabled }),
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
    [refresh, supported],
  );

  const lockNow = useCallback(async () => {
    if (!supported) return null;
    setIsBusy(true);
    try {
      const nextStatus = await enqueueNativeCommand(() => SafeNetVpn.lockAppNow());
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, [supported]);

  return { supported, status, isBusy, refresh, setEnabled, lockNow };
}