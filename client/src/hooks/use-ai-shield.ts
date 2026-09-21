import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { AiShieldResult, ProtectionStatus, SafeNetVpn } from "@/hooks/use-vpn";
import { apiFetch } from "@/lib/api";

export interface DeepCleerStatus {
  provider: "deepcleer";
  available: boolean;
  configured: boolean;
  capabilities: Array<"image" | "video" | "livestream" | "text" | "audio">;
  message: string;
}

export type AiShieldMediaType = "images" | "videos" | "livestreams" | "texts" | "audios";

export type AiShieldMediaPreferences = Record<AiShieldMediaType, boolean>;

const AI_SHIELD_MEDIA_PREFERENCES_KEY = "safenet-ai-shield-media-preferences";

const defaultMediaPreferences: AiShieldMediaPreferences = {
  images: true,
  videos: true,
  livestreams: true,
  texts: true,
  audios: true,
};

function readMediaPreferences(): AiShieldMediaPreferences {
  if (typeof window === "undefined") {
    return defaultMediaPreferences;
  }

  try {
    const stored = JSON.parse(window.localStorage.getItem(AI_SHIELD_MEDIA_PREFERENCES_KEY) || "null") as Partial<AiShieldMediaPreferences> | null;
    return (Object.keys(defaultMediaPreferences) as AiShieldMediaType[]).reduce(
      (preferences, mediaType) => {
        preferences[mediaType] = typeof stored?.[mediaType] === "boolean"
          ? stored[mediaType] as boolean
          : defaultMediaPreferences[mediaType];
        return preferences;
      },
      {} as AiShieldMediaPreferences,
    );
  } catch {
    return defaultMediaPreferences;
  }
}

const idleResult: AiShieldResult = {
  state: "capture_unavailable",
  source: "none",
  confidence: null,
  modelVersion: "safenet-nudity-tflite-1.0.0",
  timestamp: 0,
  message: "AI Shield monitoring is idle.",
  monitoring: false,
};

export function useAiShield() {
  const supported = Capacitor.getPlatform() === "android";
  const [status, setStatus] = useState<AiShieldResult | null>(supported ? null : idleResult);
  const [protection, setProtection] = useState<ProtectionStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deepCleer, setDeepCleer] = useState<DeepCleerStatus | null>(null);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [isCloudBusy, setIsCloudBusy] = useState(false);
  const [mediaPreferences, setMediaPreferences] = useState<AiShieldMediaPreferences>(readMediaPreferences);
  const cloudEnabledRef = useRef(false);
  const cloudOperationRef = useRef(0);
  const cloudQueueRef = useRef<Promise<void>>(Promise.resolve());
  const deepCleerRef = useRef<DeepCleerStatus | null>(null);
  const latestStatusTimestamp = useRef(0);

  const applyStatus = useCallback((nextStatus: AiShieldResult) => {
    if (nextStatus.timestamp < latestStatusTimestamp.current) {
      return;
    }
    latestStatusTimestamp.current = nextStatus.timestamp;
    setStatus(nextStatus);
  }, []);

  const refresh = useCallback(async () => {
    if (!supported) {
      return idleResult;
    }
    try {
      const nextStatus = await SafeNetVpn.getAiShieldStatus();
      applyStatus(nextStatus);
      setError(null);
      return nextStatus;
    } catch (statusError) {
      const message = statusError instanceof Error
        ? statusError.message
        : "Android could not read AI Shield status.";
      setError(message);
      return null;
    }
  }, [applyStatus, supported]);

  const refreshProtection = useCallback(async () => {
    if (!supported) {
      return null;
    }
    try {
      const nextProtection = await SafeNetVpn.getProtectionStatus();
      setProtection(nextProtection);
      return nextProtection;
    } catch (statusError) {
      const message = statusError instanceof Error
        ? statusError.message
        : "Android could not read network protection status.";
      setProtection({
        state: "protection_unavailable",
        timestamp: Date.now(),
        safeNetVpnRunning: false,
        safeNetOwnsActiveVpn: false,
        otherVpnActive: false,
        activeNetwork: false,
        scope: "SafeNet protection status is unavailable.",
        message,
        proxyState: "proxy_uninspectable",
        proxyMessage: "Private browser proxies cannot be inspected by SafeNet.",
        limitations: ["Reconnect SafeNet protection before treating DNS filtering as active."],
      });
      return null;
    }
  }, [supported]);

  const updateCloudEnabled = useCallback((enabled: boolean) => {
    const nextEnabled = enabled && Boolean(deepCleerRef.current?.available);
    const operation = ++cloudOperationRef.current;
    cloudEnabledRef.current = nextEnabled;
    setCloudEnabled(nextEnabled);

    if (!supported) {
      return;
    }

    setIsCloudBusy(true);
    const queued = cloudQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (operation !== cloudOperationRef.current) {
          return;
        }
        try {
          await SafeNetVpn.setAiShieldCloudUploadEnabled({ enabled: nextEnabled });
          if (operation === cloudOperationRef.current) {
            cloudEnabledRef.current = nextEnabled;
            setCloudEnabled(nextEnabled);
          }
        } catch (cloudError) {
          if (operation === cloudOperationRef.current) {
            cloudEnabledRef.current = false;
            setCloudEnabled(false);
            setError(cloudError instanceof Error
              ? cloudError.message
              : "DeepCleer cloud sharing could not be updated.");
          }
        } finally {
          if (operation === cloudOperationRef.current) {
            setIsCloudBusy(false);
          }
        }
      });
    cloudQueueRef.current = queued.catch(() => undefined);
    void queued;
  }, [supported]);

  useEffect(() => {
    let disposed = false;
    const refreshDeepCleer = async () => {
      try {
        const response = await apiFetch("/api/integrations/deepcleer/status");
        if (!response.ok) {
          throw new Error("DeepCleer provider status is unavailable.");
        }
        const nextStatus = await response.json() as DeepCleerStatus;
        if (!disposed) {
          setDeepCleer(nextStatus);
          deepCleerRef.current = nextStatus;
          if (!nextStatus.available) {
            updateCloudEnabled(false);
          }
        }
      } catch {
        if (!disposed) {
          const unavailable: DeepCleerStatus = {
            provider: "deepcleer",
            available: false,
            configured: false,
            capabilities: [],
            message: "DeepCleer provider status is unavailable. No data is sent.",
          };
          setDeepCleer(unavailable);
          deepCleerRef.current = unavailable;
          updateCloudEnabled(false);
        }
      }
    };
    void refreshDeepCleer();
    const deepCleerInterval = window.setInterval(() => void refreshDeepCleer(), 5000);
    return () => {
      disposed = true;
      window.clearInterval(deepCleerInterval);
    };
  }, [supported, updateCloudEnabled]);

  const setMediaPreference = useCallback((mediaType: AiShieldMediaType, enabled: boolean) => {
    setMediaPreferences((previous) => {
      const next = { ...previous, [mediaType]: enabled };
      try {
        window.localStorage.setItem(AI_SHIELD_MEDIA_PREFERENCES_KEY, JSON.stringify(next));
      } catch {
        // Preferences still apply for this session when browser storage is unavailable.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!supported) {
      return;
    }
    void refresh();
    void refreshProtection();
    const interval = window.setInterval(() => {
      void refreshProtection();
    }, 2000);
    let listener: { remove: () => Promise<void> } | null = null;
    let disposed = false;
    void SafeNetVpn.addListener("aiShieldResult", (result) => {
       applyStatus(result);
      setError(null);
    }).then((nextListener) => {
      if (disposed) {
        void nextListener.remove();
      } else {
        listener = nextListener;
      }
    }).catch(() => undefined);
    let frameListener: { remove: () => Promise<void> } | null = null;
    void SafeNetVpn.addListener("aiShieldFrame", (frame) => {
      if (!cloudEnabledRef.current || !deepCleerRef.current?.available) {
        return;
      }
      const cloudOperation = cloudOperationRef.current;
      void apiFetch("/api/integrations/deepcleer/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consent: true,
          source: frame.source,
          imageBase64: frame.imageBase64,
        }),
        timeoutMs: 15000,
      }).then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(payload?.message || "DeepCleer image moderation failed.");
        }
      }).catch((frameError) => {
        if (cloudOperation === cloudOperationRef.current) {
          setError(frameError instanceof Error ? frameError.message : "DeepCleer image moderation failed.");
          updateCloudEnabled(false);
        }
      });
    }).then((nextListener) => {
      if (disposed) {
        void nextListener.remove();
      } else {
        frameListener = nextListener;
      }
    }).catch(() => undefined);
    return () => {
      window.clearInterval(interval);
      disposed = true;
      updateCloudEnabled(false);
      if (listener) {
        void listener.remove();
      }
      if (frameListener) {
        void frameListener.remove();
      }
    };
  }, [applyStatus, refresh, refreshProtection, supported, updateCloudEnabled]);

  const run = useCallback(async (
    action: () => Promise<AiShieldResult>,
  ) => {
    if (!supported) {
      throw new Error("AI Shield camera and screen monitoring are available in the Android APK.");
    }
    setIsBusy(true);
    setError(null);
    try {
      const nextStatus = await action();
      applyStatus(nextStatus);
      return nextStatus;
    } catch (actionError) {
      const message = actionError instanceof Error
        ? actionError.message
        : "AI Shield could not update its monitoring state.";
      setError(message);
      throw actionError;
    } finally {
      setIsBusy(false);
    }
  }, [applyStatus, supported]);

  const startCamera = useCallback(
    () => run(() => SafeNetVpn.startAiShieldCamera()),
    [run],
  );
  const startScreen = useCallback(
    () => run(() => SafeNetVpn.startAiShieldScreen()),
    [run],
  );
  const stop = useCallback(
    () => run(() => SafeNetVpn.stopAiShield()),
    [run],
  );

  return {
    supported,
    status,
    protection,
    isBusy,
    isCloudBusy,
    error,
    deepCleer,
    cloudEnabled,
    setCloudEnabled: updateCloudEnabled,
    mediaPreferences,
    setMediaPreference,
    refresh,
    startCamera,
    startScreen,
    stop,
  };
}