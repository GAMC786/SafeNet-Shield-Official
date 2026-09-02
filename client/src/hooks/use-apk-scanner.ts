import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  ApkScanResult,
  ApkScanStatus,
  SafeNetVpn,
} from "@/hooks/use-vpn";

export function useApkScanner() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<ApkScanStatus | null>(null);
  const [lastResult, setLastResult] = useState<ApkScanResult | null>(null);
  const [installedResults, setInstalledResults] = useState<ApkScanResult[] | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isManaging, setIsManaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supported) {
      return null;
    }
    try {
      const nextStatus = await SafeNetVpn.getApkScanStatus();
      setStatus(nextStatus);
      setLastResult(nextStatus.lastScan ?? null);
      setError(null);
      return nextStatus;
    } catch (scanError) {
      const message = scanError instanceof Error
        ? scanError.message
        : "Android could not read APK scanner status.";
      setError(message);
      return null;
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const scanApk = useCallback(async () => {
    if (!supported) {
      throw new Error("APK scanning is available in the Android APK.");
    }
    setIsScanning(true);
    setError(null);
    try {
      const result = await SafeNetVpn.scanApk();
      setLastResult(result);
      await refresh();
      return result;
    } catch (scanError) {
      const message = scanError instanceof Error
        ? scanError.message
        : "The APK scan could not be completed.";
      setError(message);
      throw scanError;
    } finally {
      setIsScanning(false);
    }
  }, [refresh, supported]);

  const scanInstalledApks = useCallback(async () => {
    if (!supported) {
      throw new Error("Installed APK scanning is available in the Android APK.");
    }
    setIsScanning(true);
    setError(null);
    try {
      const results = await SafeNetVpn.scanInstalledApks();
      setInstalledResults(results);
      const finding = results.find((result) => result.verdict !== "safe");
      if (finding) {
        setLastResult(finding);
      }
      await refresh();
      return results;
    } catch (scanError) {
      const message = scanError instanceof Error
        ? scanError.message
        : "Installed APK scanning could not be completed.";
      setError(message);
      throw scanError;
    } finally {
      setIsScanning(false);
    }
  }, [refresh, supported]);

  const updateSignatures = useCallback(async (signedUpdate: string) => {
    if (!supported) {
      throw new Error("APK signature updates are available in the Android APK.");
    }
    setIsManaging(true);
    setError(null);
    try {
      const nextStatus = await SafeNetVpn.updateApkSignatures({ signedUpdate });
      setStatus(nextStatus);
      setLastResult(nextStatus.lastScan ?? null);
      return nextStatus;
    } catch (updateError) {
      const message = updateError instanceof Error
        ? updateError.message
        : "The APK signature update could not be installed.";
      setError(message);
      throw updateError;
    } finally {
      setIsManaging(false);
    }
  }, [supported]);

  const deleteQuarantinedApk = useCallback(async (sha256: string) => {
    if (!supported) {
      throw new Error("Quarantine management is available in the Android APK.");
    }
    setIsManaging(true);
    setError(null);
    try {
      const nextStatus = await SafeNetVpn.deleteQuarantinedApk({ sha256 });
      setStatus(nextStatus);
      setLastResult(nextStatus.lastScan ?? null);
      return nextStatus;
    } catch (managementError) {
      const message = managementError instanceof Error
        ? managementError.message
        : "The quarantined APK could not be deleted.";
      setError(message);
      throw managementError;
    } finally {
      setIsManaging(false);
    }
  }, [supported]);

  const clearScanHistory = useCallback(async () => {
    if (!supported) {
      throw new Error("APK scan history is available in the Android APK.");
    }
    setIsManaging(true);
    setError(null);
    try {
      const nextStatus = await SafeNetVpn.clearApkScanHistory();
      setStatus(nextStatus);
      setLastResult(nextStatus.lastScan ?? null);
      return nextStatus;
    } catch (managementError) {
      const message = managementError instanceof Error
        ? managementError.message
        : "The APK scan history could not be cleared.";
      setError(message);
      throw managementError;
    } finally {
      setIsManaging(false);
    }
  }, [supported]);

  return {
    supported,
    status,
    scannerAvailable: status?.scannerAvailable ?? false,
    signatureVersion: status?.signatureVersion ?? null,
    scannerMessage: status?.scannerMessage ?? null,
    lastResult,
    installedResults,
    isScanning,
    isManaging,
    error,
    refresh,
    scanApk,
    scanInstalledApks,
    updateSignatures,
    deleteQuarantinedApk,
    clearScanHistory,
  };
}