import { useAiShield } from "@/hooks/use-ai-shield";
import type { AiShieldResult } from "@/hooks/use-vpn";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { CyberCard } from "@/components/CyberCard";
import {
  AlertCircle,
  AudioLines,
  Camera,
  CheckCircle2,
  Eye,
  Image as ImageIcon,
  Monitor,
  Radio,
  ShieldAlert,
  Type,
  Video,
} from "lucide-react";

function statePresentation(result: AiShieldResult | null) {
  switch (result?.state) {
    case "safe":
      return {
        label: "Safe signal",
        className: "border-green-500/30 bg-green-500/10 text-green-200",
        icon: <CheckCircle2 className="h-4 w-4 text-green-400" />,
      };
    case "nudity_detected":
      return {
        label: "Nudity detected",
        className: "border-destructive/40 bg-destructive/10 text-red-100",
        icon: <ShieldAlert className="h-4 w-4 text-destructive" />,
      };
    case "uncertain":
      return {
        label: "Uncertain",
        className: "border-yellow-500/40 bg-yellow-500/10 text-yellow-100",
        icon: <AlertCircle className="h-4 w-4 text-yellow-400" />,
      };
    case "permission_denied":
      return {
        label: "Permission denied",
        className: "border-yellow-500/40 bg-yellow-500/10 text-yellow-100",
        icon: <AlertCircle className="h-4 w-4 text-yellow-400" />,
      };
    case "capture_unavailable":
      return {
        label: result?.source === "screen" ? "Screen capture unavailable" : "Capture unavailable",
        className: "border-yellow-500/40 bg-yellow-500/10 text-yellow-100",
        icon: <AlertCircle className="h-4 w-4 text-yellow-400" />,
      };
    case "model_unavailable":
      return {
        label: "Engine unavailable",
        className: "border-destructive/40 bg-destructive/10 text-red-100",
        icon: <AlertCircle className="h-4 w-4 text-destructive" />,
      };
    default:
      return {
        label: result?.monitoring ? "Waiting for frame" : "Monitoring idle",
        className: "border-white/10 bg-background/40 text-muted-foreground",
        icon: <Eye className="h-4 w-4 text-primary" />,
      };
  }
}

function formatConfidence(confidence?: number | null) {
  return confidence == null ? "—" : `${Math.round(confidence * 100)}%`;
}

export function AiShieldControls() {
  const shield = useAiShield();
  const { toast } = useToast();
  const presentation = statePresentation(shield.status);
  const monitoring = shield.status?.monitoring ?? false;
  const activeSource = shield.status?.source;
  const cameraEnabled = monitoring && activeSource === "camera";
  const screenEnabled = monitoring && activeSource === "screen";
  const protection = shield.protection;
  const protectionIsVerified = protection?.state === "protected";
  const mediaControls = [
    { key: "images", label: "Images", description: "Analyze image frames", icon: ImageIcon },
    { key: "videos", label: "Videos", description: "Analyze video frames", icon: Video },
    { key: "livestreams", label: "Livestreams", description: "Analyze live frames", icon: Radio },
    { key: "texts", label: "Texts", description: "Enable text detection", icon: Type },
    { key: "audios", label: "Audios", description: "Enable audio detection", icon: AudioLines },
  ] as const;

  const run = async (action: () => Promise<AiShieldResult>) => {
    try {
      const result = await action();
      if (result.state === "permission_denied" || result.state === "capture_unavailable" || result.state === "model_unavailable") {
        const resultPresentation = statePresentation(result);
        toast({
          title: resultPresentation.label,
          description: result.message,
          variant: result.state === "model_unavailable" ? "destructive" : "default",
        });
      }
    } catch (actionError) {
      toast({
        title: "AI Shield action could not complete",
        description: actionError instanceof Error ? actionError.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const toggleSource = (source: "camera" | "screen", enabled: boolean) =>
    run(
      enabled
        ? source === "camera"
          ? shield.startCamera
          : shield.startScreen
        : shield.stop,
    );

  return (
    <CyberCard className="space-y-4" data-testid="ai-shield-controls">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/15 p-3">
            <Eye className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-lg tracking-wider">DeepCleer Ai Detector</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Choose the media types DeepCleer Ai should detect while monitoring.
            </p>
          </div>
        </div>
        <Badge variant="outline" className={presentation.className}>
          <span className="mr-1.5">{presentation.icon}</span>
          {presentation.label}
        </Badge>
        {shield.status?.state === "capture_unavailable" && (
          <Badge
            variant="outline"
            className="border-yellow-500/40 bg-yellow-500/10 text-yellow-200"
            data-testid="ai-shield-coming-soon"
          >
            Coming Soon
          </Badge>
        )}
      </div>

      {!shield.supported ? (
        <p className="rounded-md border border-white/10 bg-background/40 p-3 text-sm text-muted-foreground">
          Camera and screen monitoring are available in the SafeNet Android APK. Start a consented capture session to analyze selected media locally; captured frames are released immediately.
        </p>
      ) : null}

      <div className="space-y-3" data-testid="ai-shield-detector-controls">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-white">Detector controls</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose one capture source at a time. Starting one source automatically stops the other.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-background/30 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <Camera className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Monitor camera</p>
                <p className="text-xs text-muted-foreground">Analyze consented camera frames</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {cameraEnabled ? "On" : "Off"}
              </span>
              <Switch
                checked={cameraEnabled}
                onCheckedChange={(checked) => void toggleSource("camera", checked)}
                disabled={!shield.supported || shield.isBusy}
                data-testid="switch-ai-camera"
                aria-label={`Camera monitoring ${cameraEnabled ? "On" : "Off"}`}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-background/30 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <Monitor className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Monitor screen</p>
                <p className="text-xs text-muted-foreground">Analyze consented screen pixels</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {screenEnabled ? "On" : "Off"}
              </span>
              <Switch
                checked={screenEnabled}
                onCheckedChange={(checked) => void toggleSource("screen", checked)}
                disabled={!shield.supported || shield.isBusy}
                data-testid="switch-ai-screen"
                aria-label={`Screen monitoring ${screenEnabled ? "On" : "Off"}`}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mediaControls.map(({ key, label, description, icon: Icon }) => {
            const enabled = shield.mediaPreferences[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-background/30 p-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {enabled ? "On" : "Off"}
                  </span>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => shield.setMediaPreference(key, checked)}
                    data-testid={`switch-ai-${key}`}
                    aria-label={`${label} detection ${enabled ? "On" : "Off"}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {shield.supported && (
        <>
          <div
            className={`rounded-md border p-3 ${
              protectionIsVerified
                ? "border-green-500/30 bg-green-500/10 text-green-100"
                : "border-yellow-500/40 bg-yellow-500/10 text-yellow-100"
            }`}
            data-testid="android-protection-status"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {protectionIsVerified
                ? <CheckCircle2 className="h-4 w-4 text-green-400" />
                : <AlertCircle className="h-4 w-4 text-yellow-400" />}
              <span>
                {protectionIsVerified
                  ? "SafeNet owns the active VPN path"
                  : protection?.state === "vpn_replaced"
                    ? "Another VPN owns the active path"
                    : protection?.state === "dns_bypass_possible"
                      ? "DNS bypass is possible"
                      : "Network protection unavailable"}
              </span>
              <Badge variant="outline" className="text-[10px] uppercase">
                {protection?.state || "checking"}
              </Badge>
            </div>
            <p className="mt-2 text-sm">
              {protection?.message || "Checking whether Android has assigned the device VPN path to SafeNet."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {protection?.scope || "DNS-only coverage is being verified."}
            </p>
            <p className="mt-2 text-xs text-yellow-100/80">
              Private proxy browsers, encrypted DNS, HTTPS content, and another app&apos;s VPN tunnel remain outside SafeNet inspection. Reconnect SafeNet and use system DNS for the coverage above.
            </p>
            <p className="mt-1 text-xs text-yellow-100/80">
              A high-confidence screen finding can raise the existing shield event, but it cannot block content inside another app&apos;s private network tunnel.
            </p>
          </div>

          <div
            className={`rounded-md border p-3 text-sm ${
              shield.deepCleer?.available
                ? "border-primary/30 bg-primary/10 text-primary-foreground"
                : "border-white/10 bg-background/30 text-muted-foreground"
            }`}
            data-testid="deepcleer-provider-status"
          >
            <div className="flex flex-wrap items-center gap-2 font-medium">
              <span>DeepCleer cloud provider</span>
              <Badge variant="outline" className="text-[10px] uppercase">
                {shield.deepCleer?.available ? "available" : "on-device only"}
              </Badge>
            </div>
            <p className="mt-1">
              {shield.deepCleer?.message ||
                "Checking DeepCleer access. Camera and screen frames remain on-device until cloud access is explicitly enabled."}
            </p>
            {shield.deepCleer?.available && (
              <p className="mt-1 text-xs text-muted-foreground">
                Supported vendor modalities: {shield.deepCleer.capabilities.join(", ")}.
                The camera and screen switches below still control the consented local capture session.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Send frames to DeepCleer</p>
              <p className="text-xs text-muted-foreground">
                Off by default. Enabling this sends consented camera or screen frames to the configured vendor.
              </p>
            </div>
            <Switch
              checked={shield.cloudEnabled}
              onCheckedChange={shield.setCloudEnabled}
              disabled={!shield.deepCleer?.available || shield.isBusy || shield.isCloudBusy}
              data-testid="switch-deepcleer-cloud"
              aria-label={`DeepCleer cloud sharing ${shield.cloudEnabled ? "On" : "Off"}`}
            />
          </div>

          <div
            className={`rounded-md border p-3 ${presentation.className}`}
            data-testid="ai-shield-result"
            data-state={shield.status?.state || "idle"}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {presentation.icon}
              <span>{presentation.label}</span>
              <Badge variant="outline" className="text-[10px] uppercase">
                {shield.status?.source || "none"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Confidence {formatConfidence(shield.status?.confidence)}
              </span>
            </div>
            <p className="mt-2 text-sm">{shield.status?.message || "Loading Android AI Shield status."}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Engine {shield.status?.modelVersion || "safenet-nudity-tflite-1.0.0"}
            </p>
            {shield.status?.state === "model_unavailable" && (
              <p className="mt-2 text-sm font-medium text-destructive">
                AI Shield is unavailable until the bundled on-device model loads successfully. No frame was treated as safe.
              </p>
            )}
            {shield.status?.state === "nudity_detected" && (
              <p className="mt-2 text-sm font-medium text-destructive">
                Shield event: high-confidence content was detected in the available frame.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Screen monitoring requires Android MediaProjection consent and only covers pixels Android makes available. Secure/DRM surfaces, revoked projections, and hidden app content are unavailable; results are never a promise of perfect detection.
          </p>
           <p className="text-xs text-muted-foreground">
             Camera and screen detection share one Android capture session. Turning on one source automatically turns off the other.
           </p>
          {shield.error && <p className="text-xs text-destructive">{shield.error}</p>}
        </>
      )}
    </CyberCard>
  );
}
