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

  return {
    supported,
    scannerAvailable: status?.scannerAvailable ?? false,
    signatureVersion: status?.signatureVersion ?? null,
    scannerMessage: status?.scannerMessage ?? null,
    lastResult,
    installedResults,
    isScanning,
    error,
    refresh,
    scanApk,
    scanInstalledApks,
  };
}