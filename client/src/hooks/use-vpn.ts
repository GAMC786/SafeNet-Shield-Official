import { useCallback, useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import type { FirewallConfig } from "@shared/schema";

export const SAFE_NET_VPN_EULA_VERSION = "1.0";

export type ApkScanVerdict = "safe" | "malicious" | "unsupported" | "scanner_unavailable";

export interface ApkScanResult {
  verdict: ApkScanVerdict;
  displayName?: string | null;
  source?: "selected" | "installed" | null;
  packageName?: string | null;
  versionName?: string | null;
  sha256?: string | null;
  signatureVersion?: string | null;
  threatType?: string | null;
  severity?: string | null;
  threatName?: string | null;
  details?: string | null;
  scannedAt?: number;
}

export interface ApkQuarantineFile {
  sha256: string;
  fileName: string;
  sizeBytes: number;
  quarantinedAt?: number;
  verdict?: ApkScanVerdict;
  displayName?: string | null;
  packageName?: string | null;
  versionName?: string | null;
  signatureVersion?: string | null;
  threatType?: string | null;
  severity?: string | null;
  threatName?: string | null;
  details?: string | null;
  scannedAt?: number;
}

export interface ApkScanStatus {
  supported: boolean;
  scannerAvailable: boolean;
  signatureVersion?: string | null;
  signatureSource?: string | null;
  signatureGeneratedAt?: string | null;
  signatureExpiresAt?: string | null;
  signatureUpdateStatus?: "bundled" | "current" | "expired" | "rejected" | "unavailable" | "test" | string | null;
  signatureUpdateMessage?: string | null;
  signatureLastUpdateAt?: number;
  scannerMessage?: string | null;
  lastScan?: ApkScanResult | null;
  scanHistory?: ApkScanResult[];
  quarantine?: ApkQuarantineFile[];
  quarantineBytes?: number;
}

export interface VpnStatus {
  supported: boolean;
  running: boolean;
  permissionGranted: boolean;
  eulaVersion: string;
  eulaAccepted: boolean;
  error?: string;
  protection?: ProtectionStatus;
}

export type ProtectionState =
  | "protected"
  | "vpn_replaced"
  | "proxy_uninspectable"
  | "dns_bypass_possible"
  | "capture_unavailable"
  | "protection_unavailable";

export interface ProtectionStatus {
  state: ProtectionState;
  timestamp: number;
  safeNetVpnRunning: boolean;
  safeNetOwnsActiveVpn: boolean;
  otherVpnActive: boolean;
  activeNetwork: boolean;
  scope: string;
  message: string;
  proxyState: "proxy_uninspectable" | string;
  proxyMessage: string;
  limitations: string[];
}

export type AiShieldState =
  | "safe"
  | "nudity_detected"
  | "uncertain"
  | "permission_denied"
  | "capture_unavailable"
  | "model_unavailable";

export interface AiShieldResult {
  state: AiShieldState;
  source: "camera" | "screen" | "none" | string;
  confidence?: number | null;
  modelVersion: string;
  timestamp: number;
  message: string;
  monitoring?: boolean;
  privacy?: string;
  limitations?: string;
}

interface SafeNetVpnPlugin {
  getStatus(): Promise<VpnStatus>;
  syncFirewallConfig(options: { config: FirewallConfig }): Promise<{
    synced: boolean;
    firewallEnabled: boolean;
  }>;
  getApkScanStatus(): Promise<ApkScanStatus>;
  updateApkSignatures(options: { signedUpdate: string }): Promise<ApkScanStatus>;
  scanApk(): Promise<ApkScanResult>;
  scanInstalledApks(): Promise<{ results: ApkScanResult[] }>;
  deleteQuarantinedApk(options: { sha256: string }): Promise<ApkScanStatus>;
  clearApkScanHistory(): Promise<ApkScanStatus>;
  acceptEula(options: { version: string }): Promise<VpnStatus>;
  start(options: {
    type: string;
    primaryAddress: string;
    secondaryAddress?: string | null;
  }): Promise<VpnStatus>;
  stop(): Promise<VpnStatus>;
  getProtectionStatus(): Promise<ProtectionStatus>;
  getAiShieldStatus(): Promise<AiShieldResult>;
  startAiShieldCamera(): Promise<AiShieldResult>;
  startAiShieldScreen(): Promise<AiShieldResult>;
  stopAiShield(): Promise<AiShieldResult>;
  addListener(
    eventName: "aiShieldResult",
    listenerFunc: (result: AiShieldResult) => void,
  ): Promise<PluginListenerHandle>;
}

export const SafeNetVpn = registerPlugin<SafeNetVpnPlugin>("SafeNetVpn");

export function useSafeNetVpn() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported) {
      return null;
    }
    try {
      const nextStatus = await SafeNetVpn.getStatus();
      setStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Android could not read VPN status.";
      setStatus((previous) => ({
        supported: true,
        running: false,
        permissionGranted: previous?.permissionGranted ?? false,
        eulaVersion: previous?.eulaVersion ?? SAFE_NET_VPN_EULA_VERSION,
        eulaAccepted: previous?.eulaAccepted ?? false,
        error: `DNS protection status is unavailable. ${message}`,
      }));
      throw error;
    }
  }, [supported]);

  useEffect(() => {
    if (!supported) {
      return;
    }
    void refresh().catch(() => undefined);
    const interval = window.setInterval(() => void refresh().catch(() => undefined), 2000);
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