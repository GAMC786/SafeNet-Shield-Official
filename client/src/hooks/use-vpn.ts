import { useCallback, useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";

export const SAFE_NET_VPN_EULA_VERSION = "1.0";

export interface VpnStatus {
  supported: boolean;
  running: boolean;
  permissionGranted: boolean;
  eulaVersion: string;
  eulaAccepted: boolean;
  error?: string;
}

interface SafeNetVpnPlugin {
  getStatus(): Promise<VpnStatus>;
  acceptEula(options: { version: string }): Promise<VpnStatus>;
  start(options: {
    type: string;
    primaryAddress: string;
    secondaryAddress?: string | null;
  }): Promise<VpnStatus>;
  stop(): Promise<VpnStatus>;
}

const SafeNetVpn = registerPlugin<SafeNetVpnPlugin>("SafeNetVpn");

export function useSafeNetVpn() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported) {
      return null;
    }
    const nextStatus = await SafeNetVpn.getStatus();
    setStatus(nextStatus);
    return nextStatus;
  }, [supported]);

  useEffect(() => {
    if (!supported) {
      return;
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(interval);
  }, [refresh, supported]);

  const acceptEula = useCallback(async () => {
    setIsBusy(true);
    try {
      const nextStatus = await SafeNetVpn.acceptEula({ version: SAFE_NET_VPN_EULA_VERSION });
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, []);

  const start = useCallback(async (options: {
    type: string;
    primaryAddress: string;
    secondaryAddress?: string | null;
  }) => {
    setIsBusy(true);
    try {
      const nextStatus = await SafeNetVpn.start(options);
      setStatus(nextStatus);
      await refresh();
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, [refresh]);

  const stop = useCallback(async () => {
    setIsBusy(true);
    try {
      const nextStatus = await SafeNetVpn.stop();
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, []);

  return { supported, status, isBusy, refresh, acceptEula, start, stop };
}