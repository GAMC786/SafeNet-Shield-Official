export type AiShieldResult = {
  state:
    | "safe"
    | "nudity_detected"
    | "uncertain"
    | "permission_denied"
    | "capture_unavailable"
    | "model_unavailable";
  source?: "camera" | "screen";
  monitoring?: boolean;
  confidence?: number | null;
  message?: string;
  modelVersion?: string;
};

const unavailableResult: AiShieldResult = {
  state: "capture_unavailable",
  source: "screen",
  monitoring: false,
  message: "Camera and screen monitoring are available in the SafeNet Android APK.",
};

export function useAiShield() {
  return {
    status: unavailableResult,
    supported: false,
    isBusy: false,
    isCloudBusy: false,
    protection: {
      state: "protected",
      message: "SafeNet is selected for the preview protection path.",
      scope: "Preview-only status; no device protection is active.",
    },
    deepCleer: {
      available: false,
      capabilities: ["image", "video", "livestream", "text", "audio"],
      message: "DeepCleer access is not configured in this preview.",
    },
    cloudEnabled: false,
    setCloudEnabled: (_enabled: boolean) => undefined,
    mediaPreferences: {
      images: true,
      videos: true,
      livestreams: true,
      texts: true,
      audios: true,
    },
    setMediaPreference: (_key: string, _enabled: boolean) => undefined,
    startCamera: async () => unavailableResult,
    startScreen: async () => unavailableResult,
    stop: async () => unavailableResult,
    error: null,
  };
}