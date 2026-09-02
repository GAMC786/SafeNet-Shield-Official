import { useAiShield } from "@/hooks/use-ai-shield";
import type { AiShieldResult } from "@/hooks/use-vpn";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CyberCard } from "@/components/CyberCard";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Eye,
  Loader2,
  Monitor,
  ShieldAlert,
  Square,
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

  const run = async (action: () => Promise<AiShieldResult>) => {
    try {
      const result = await action();
      if (result.state === "permission_denied" || result.state === "capture_unavailable" || result.state === "model_unavailable") {
        toast({
          title: presentation.label,
          description: result.message,
          variant: result.state === "model_unavailable" ? "destructive" : "default",
        });
      }
    } catch (actionError) {
      toast({
        title: "AI Shield could not start",
        description: actionError instanceof Error ? actionError.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <CyberCard className="space-y-4" data-testid="ai-shield-controls">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/15 p-3">
            <Eye className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-lg tracking-wider">AI Shield · Android only</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Analyze consented camera frames or visible screen pixels locally. Raw frames are released immediately and never uploaded or saved.
            </p>
          </div>
        </div>
        <Badge variant="outline" className={presentation.className}>
          <span className="mr-1.5">{presentation.icon}</span>
          {presentation.label}
        </Badge>
      </div>

      {!shield.supported ? (
        <p className="rounded-md border border-white/10 bg-background/40 p-3 text-sm text-muted-foreground">
          Camera and screen monitoring are only available in the SafeNet Android APK. The server AI Shield setting does not inspect browser or device pixels.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void run(shield.startCamera)}
              disabled={shield.isBusy || monitoring}
              data-testid="button-start-ai-camera"
            >
              {shield.isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
              Monitor camera
            </Button>
            <Button
              variant="outline"
              onClick={() => void run(shield.startScreen)}
              disabled={shield.isBusy || monitoring}
              data-testid="button-start-ai-screen"
            >
              <Monitor className="mr-2 h-4 w-4" />
              Monitor screen
            </Button>
            <Button
              variant="outline"
              onClick={() => void run(shield.stop)}
              disabled={shield.isBusy || !monitoring}
              data-testid="button-stop-ai-shield"
            >
              <Square className="mr-2 h-4 w-4" />
              Stop
            </Button>
          </div>

          <div className={`rounded-md border p-3 ${presentation.className}`} data-testid="ai-shield-result">
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
              Engine {shield.status?.modelVersion || "safenet-nudity-engine-1.0.0"}
            </p>
            {shield.status?.state === "nudity_detected" && (
              <p className="mt-2 text-sm font-medium text-destructive">
                Shield event: high-confidence content was detected in the available frame.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Screen monitoring requires Android MediaProjection consent and only covers pixels Android makes available. Secure/DRM surfaces, revoked projections, and hidden app content are unavailable; results are never a promise of perfect detection.
          </p>
          {shield.error && <p className="text-xs text-destructive">{shield.error}</p>}
        </>
      )}
    </CyberCard>
  );
}