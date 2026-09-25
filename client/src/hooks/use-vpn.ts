import { useCallback, useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import type { FirewallConfig } from "@shared/schema";
import { enqueueNativeCommand } from "@/lib/native-command-queue";

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
  safeNetPrivateDnsActive: boolean;
  privateDnsMode: string;
  privateDnsHostname: string | null;
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

export interface CallScreeningStatus {
  supported: boolean;
  roleAvailable: boolean;
  roleHeld: boolean;
  enabled: boolean;
  serviceRegistered: boolean;
  apiConfigured: boolean;
  blockUnknownCallers?: boolean;
  offlineReputationAvailable?: boolean;
  blockedNumberCount: number;
  message: string;
}

interface SafeNetVpnPlugin {
  getPrivateDnsStatus(options: { expectedHostname: string }): Promise<{
    supported: boolean;
    running: boolean;
    mode: "off" | "automatic" | "hostname" | "unknown";
    hostname: string | null;
    expectedHostname: string | null;
    oneTapAvailable: boolean;
    oneTapSetupRequired: boolean;
    message: string;
    error?: string | null;
  }>;
  setPrivateDnsHostname(options: { expectedHostname: string }): Promise<{
    supported: boolean;
    running: boolean;
    mode: "off" | "automatic" | "hostname" | "unknown";
    hostname: string | null;
    expectedHostname: string | null;
    oneTapAvailable: boolean;
    oneTapSetupRequired: boolean;
    message: string;
    error?: string | null;
  }>;
  openPrivateDnsSettings(options: { expectedHostname: string }): Promise<{
    supported: boolean;
    running: boolean;
    mode: "off" | "automatic" | "hostname" | "unknown";
    hostname: string | null;
    expectedHostname: string | null;
    oneTapAvailable: boolean;
    oneTapSetupRequired: boolean;
    message: string;
    error?: string | null;
  }>;
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
  getProtectionStatus(options?: { expectedHostname?: string }): Promise<ProtectionStatus>;
  getAiShieldStatus(): Promise<AiShieldResult>;
  startAiShieldCamera(): Promise<AiShieldResult>;
  startAiShieldScreen(): Promise<AiShieldResult>;
  stopAiShield(): Promise<AiShieldResult>;
  setAiShieldCloudUploadEnabled(options: { enabled: boolean }): Promise<void>;
  getCallScreeningStatus(): Promise<CallScreeningStatus>;
  requestCallScreeningRole(): Promise<CallScreeningStatus>;
  openCallScreeningSettings(): Promise<CallScreeningStatus>;
  setCallScreeningEnabled(options: { enabled: boolean }): Promise<CallScreeningStatus>;
  syncCallScreeningConfig(options: {
    blockedNumbers: string[];
    blockUnknownCallers: boolean;
  }): Promise<CallScreeningStatus>;
  getAppLockStatus(): Promise<import("./use-app-lock").AppLockStatus>;
  setAppLockEnabled(options: { enabled: boolean }): Promise<import("./use-app-lock").AppLockStatus>;
  unlockAppLock(): Promise<import("./use-app-lock").AppLockStatus>;
  lockAppNow(): Promise<import("./use-app-lock").AppLockStatus>;
  getTetherStatus(): Promise<import("./use-tether-share").TetherShareStatus>;
  startTetherShare(options?: { mode?: import("./use-tether-share").TetherShareMode }): Promise<import("./use-tether-share").TetherShareStatus>;
  stopTetherShare(): Promise<import("./use-tether-share").TetherShareStatus>;
  openTetherWifiSettings(): Promise<void>;
  openTetherAppSettings(): Promise<void>;
  addListener(
    eventName: "aiShieldResult",
    listenerFunc: (result: AiShieldResult) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "aiShieldFrame",
    listenerFunc: (frame: { source: "camera" | "screen"; imageBase64: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const SafeNetVpn = registerPlugin<SafeNetVpnPlugin>("SafeNetVpn");

export function useCallScreening() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<CallScreeningStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supported) return null;
    try {
      const nextStatus = await enqueueNativeCommand(() => SafeNetVpn.getCallScreeningStatus());
      setStatus(nextStatus);
      return nextStatus;
    } catch {
      const unavailable: CallScreeningStatus = {
        supported: true,
        roleAvailable: false,
        roleHeld: false,
        enabled: false,
        serviceRegistered: false,
        apiConfigured: false,
        blockedNumberCount: 0,
        message: "Android call-screening status is unavailable.",
      };
      setStatus(unavailable);
      return unavailable;
    }
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(interval);
  }, [refresh, supported]);

  const requestRole = useCallback(async () => {
    setIsBusy(true);
    try {
      const nextStatus = await enqueueNativeCommand(() => SafeNetVpn.requestCallScreeningRole());
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, []);

  const openSettings = useCallback(async () => {
    setIsBusy(true);
    try {
      const nextStatus = await enqueueNativeCommand(() => SafeNetVpn.openCallScreeningSettings());
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!supported) return null;
    setIsBusy(true);
    try {
      const nextStatus = await enqueueNativeCommand(() =>
        SafeNetVpn.setCallScreeningEnabled({ enabled }),
      );
      setStatus(nextStatus);
      return nextStatus;
    } finally {
      setIsBusy(false);
    }
  }, [supported]);

  const syncConfig = useCallback(async (options: {
    blockedNumbers: string[];
    blockUnknownCallers: boolean;
  }) => {
    if (!supported) return null;
    const nextStatus = await enqueueNativeCommand(() =>
      SafeNetVpn.syncCallScreeningConfig(options),
    );
    setStatus(nextStatus);
    return nextStatus;
  }, [supported]);

  return { supported, status, isBusy, refresh, requestRole, openSettings, setEnabled, syncConfig };
}
