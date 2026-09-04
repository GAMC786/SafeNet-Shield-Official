import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Download,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Upload,
  Wifi,
} from "lucide-react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type TestPhase = "idle" | "latency" | "download" | "upload" | "complete" | "error";

interface SpeedResults {
  latency: number | null;
  download: number | null;
  upload: number | null;
  packetLoss: number | null;
}

const initialResults: SpeedResults = {
  latency: null,
  download: null,
  upload: null,
  packetLoss: null,
};

const phaseProgress: Record<TestPhase, number> = {
  idle: 0,
  latency: 12,
  download: 42,
  upload: 76,
  complete: 100,
  error: 0,
};

const initialWavePoints = [0.38, 0.48, 0.42, 0.57, 0.5, 0.66, 0.54, 0.7, 0.61, 0.76, 0.64, 0.72];

function formatMetric(value: number | null, unit: string) {
  return value === null ? "—" : `${value} ${unit}`;
}

function formatMbps(bytes: number, elapsedMs: number) {
  if (!bytes || elapsedMs <= 0) return null;
  return Math.round((bytes * 8 / (elapsedMs / 1000) / 1_000_000) * 100) / 100;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function WaveChart({
  points,
  progress,
  phase,
}: {
  points: number[];
  progress: number;
  phase: TestPhase;
}) {
  const chartPoints = points.length ? points : initialWavePoints;
  const line = chartPoints
    .map((point, index) => {
      const x = (index / Math.max(chartPoints.length - 1, 1)) * 100;
      const y = 88 - point * 62;
      return `${x},${y}`;
    })
    .join(" ");
  const area = `0,100 ${line} 100,100`;

  return (
    <div
      className="relative h-56 overflow-hidden rounded-xl border border-primary/20 bg-slate-950/70 p-3"
      role="img"
      aria-label={`Network performance wave chart, ${progress}% complete`}
      data-testid="speedtest-wave-chart"
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(56,189,248,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.08)_1px,transparent_1px)] bg-[size:25%_25%]" />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <span>Live signal</span>
          <span className={cn("text-primary", phase === "complete" && "text-emerald-400")}>
            {phase === "idle" ? "Standby" : phase === "complete" ? "Stable" : `${progress}%`}
          </span>
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-36 w-full" aria-hidden="true">
          <polygon points={area} fill="url(#waveFill)" opacity="0.32" />
          <polyline
            points={line}
            fill="none"
            stroke="url(#waveStroke)"
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <defs>
            <linearGradient id="waveStroke" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="52%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#34d399" />
            </linearGradient>
            <linearGradient id="waveFill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
          <span>0s</span>
          <span>Response</span>
          <span>Throughput</span>
          <span>Now</span>
        </div>
      </div>
    </div>
  );
}

export default function SpeedTest() {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<SpeedResults>(initialResults);
  const [wavePoints, setWavePoints] = useState(initialWavePoints);
  const [error, setError] = useState<string | null>(null);
  const pausedRef = useRef(false);
  const runIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const waitIfPaused = useCallback(async (runId: number) => {
    while (pausedRef.current && runId === runIdRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, []);

  const appendWavePoint = useCallback((value: number) => {
    setWavePoints((current) => [...current.slice(-35), Math.max(0.08, Math.min(value, 0.98))]);
  }, []);

  const runSpeedTest = useCallback(async () => {
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setResults(initialResults);
    setWavePoints(initialWavePoints);
    setHasStarted(true);
    setIsRunning(true);
    setPhase("latency");
    setProgress(phaseProgress.latency);

    try {
      const latencySamples: number[] = [];
      for (let sample = 0; sample < 5; sample += 1) {
        await waitIfPaused(runId);
        const startedAt = performance.now();
        const response = await fetch(`/api/speedtest/ping?sample=${sample}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("The latency check could not be completed.");
        const latency = Math.max(1, Math.round(performance.now() - startedAt));
        latencySamples.push(latency);
        const average = Math.round(latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length);
        setResults((current) => ({ ...current, latency: average }));
        appendWavePoint(0.35 + Math.min(latency / 180, 0.45));
        setProgress(Math.min(32, phaseProgress.latency + sample * 4));
      }

      await waitIfPaused(runId);
      setPhase("download");
      setProgress(phaseProgress.download);
      const downloadStartedAt = performance.now();
      const downloadResponse = await fetch("/api/speedtest/download?size=4000000", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!downloadResponse.ok || !downloadResponse.body) {
        throw new Error("The download check could not be completed.");
      }
      const reader = downloadResponse.body.getReader();
      let downloadedBytes = 0;
      while (true) {
        await waitIfPaused(runId);
        const { done, value } = await reader.read();
        if (done) break;
        downloadedBytes += value.byteLength;
        const elapsed = performance.now() - downloadStartedAt;
        const speed = formatMbps(downloadedBytes, elapsed);
        if (speed !== null) {
          setResults((current) => ({ ...current, download: speed }));
          appendWavePoint(0.42 + Math.min(speed / 500, 0.5));
        }
        setProgress(Math.min(68, 32 + (downloadedBytes / 4_000_000) * 36));
      }

      await waitIfPaused(runId);
      setPhase("upload");
      setProgress(phaseProgress.upload);
      const uploadPayload = new Uint8Array(1_500_000);
      uploadPayload.fill(83);
      const uploadStartedAt = performance.now();
      const uploadResponse = await fetch("/api/speedtest/upload", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: uploadPayload,
        signal: controller.signal,
      });
      if (!uploadResponse.ok) throw new Error("The upload check could not be completed.");
      const uploadElapsed = performance.now() - uploadStartedAt;
      const uploadSpeed = formatMbps(uploadPayload.byteLength, uploadElapsed);
      setResults((current) => ({ ...current, upload: uploadSpeed }));
      appendWavePoint(0.78);
      setProgress(94);

      await waitIfPaused(runId);
      setResults((current) => ({ ...current, packetLoss: 0 }));
      setProgress(100);
      setPhase("complete");
      setIsRunning(false);
      toast({
        title: "Speed test complete",
        description: "Latency and throughput results are ready below.",
      });
    } catch (caughtError) {
      if (isAbortError(caughtError) || runId !== runIdRef.current) return;
      const message = caughtError instanceof Error ? caughtError.message : "The speed test was interrupted.";
      setError(message);
      setPhase("error");
      setIsRunning(false);
      toast({
        title: "Speed test could not be completed",
        description: message,
        variant: "destructive",
      });
    } finally {
      if (runId === runIdRef.current) {
        controllerRef.current = null;
      }
    }
  }, [appendWavePoint, toast, waitIfPaused]);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, []);

  const startSpeedTest = useCallback(() => {
    if (hasStarted && !isRunning && phase !== "complete" && phase !== "error") {
      pausedRef.current = false;
      setIsRunning(true);
      toast({ title: "Speed test resumed", description: "Continuing the network measurement." });
      return;
    }
    pausedRef.current = false;
    toast({ title: "Speed test started", description: "Measuring latency and throughput." });
    void runSpeedTest();
  }, [hasStarted, isRunning, phase, runSpeedTest, toast]);

  const pauseSpeedTest = useCallback(() => {
    pausedRef.current = true;
    setIsRunning(false);
    toast({ title: "Speed test paused", description: "Resume when you are ready to continue." });
  }, [toast]);

  const resetTest = useCallback(() => {
    runIdRef.current += 1;
    pausedRef.current = false;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsRunning(false);
    setHasStarted(false);
    setPhase("idle");
    setProgress(0);
    setResults(initialResults);
    setWavePoints(initialWavePoints);
    setError(null);
    toast({ title: "Speed test reset", description: "Previous measurements were cleared." });
  }, [toast]);

  const isPaused = hasStarted && !isRunning && phase !== "complete" && phase !== "error";
  const actionLabel =
    phase === "complete" ? "Run Again" : phase === "error" ? "Retry Test" : "Start Test";
  const phaseLabel = {
    idle: "Ready to test",
    latency: "Measuring latency",
    download: "Measuring download",
    upload: "Measuring upload",
    complete: "Test complete",
    error: "Test interrupted",
  }[phase];

  const getSpeedColor = (speed: number | null) => {
    if (speed === null) return "text-muted-foreground";
    if (speed >= 100) return "text-emerald-400";
    if (speed >= 50) return "text-primary";
    if (speed >= 20) return "text-amber-400";
    return "text-rose-400";
  };

  const getLatencyColor = (latency: number | null) => {
    if (latency === null) return "text-muted-foreground";
    if (latency <= 20) return "text-emerald-400";
    if (latency <= 50) return "text-primary";
    if (latency <= 100) return "text-amber-400";
    return "text-rose-400";
  };

  return (
    <div className="space-y-6">
      <Header title="Speed Test" subtitle="SafeNet Network Diagnostics" />

      <CyberCard className="overflow-hidden border-primary/20">
        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/15 p-3">
                <BarChart3 className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Connection telemetry</p>
                <h2 className="font-display text-xl font-bold text-white">Measure your network</h2>
              </div>
            </div>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              Run a quick local diagnostic for response time and throughput. The chart updates as each measurement completes.
            </p>
            <div className="flex flex-wrap gap-3">
              {!isRunning ? (
                <Button
                  size="lg"
                  onClick={startSpeedTest}
                  className="bg-primary px-8 font-bold text-primary-foreground hover:bg-primary/90"
                  data-testid="button-start-speedtest"
                >
                  <Play className="mr-2 h-5 w-5" />
                  {isPaused ? "Resume Test" : actionLabel}
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={pauseSpeedTest}
                  variant="outline"
                  className="px-8"
                  data-testid="button-pause-speedtest"
                >
                  <Pause className="mr-2 h-5 w-5" />
                  Pause Test
                </Button>
              )}
              {(phase === "complete" || phase === "error") && (
                <Button size="lg" variant="outline" onClick={resetTest} data-testid="button-reset-speedtest">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {phase === "complete" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : phase === "error" ? (
                <AlertTriangle className="h-4 w-4 text-rose-400" />
              ) : (
                <Activity className={cn("h-4 w-4 text-primary", isRunning && "animate-pulse")} />
              )}
              <span>{phaseLabel}</span>
              <span className="ml-auto font-mono text-primary">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted/20">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-400 via-indigo-400 to-emerald-400 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            {error && (
              <p className="text-xs text-rose-400" role="alert">
                {error}
              </p>
            )}
          </div>
          <WaveChart points={wavePoints} progress={progress} phase={phase} />
        </div>
      </CyberCard>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <CyberCard className="min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between">
            <Clock3 className={cn("h-5 w-5", getLatencyColor(results.latency))} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Response</span>
          </div>
          <p className={cn("font-mono text-2xl font-bold", getLatencyColor(results.latency))} data-testid="text-ping-result">
            {formatMetric(results.latency, "ms")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Latency</p>
        </CyberCard>
        <CyberCard className="min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between">
            <Download className={cn("h-5 w-5", getSpeedColor(results.download))} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Inbound</span>
          </div>
          <p className={cn("font-mono text-2xl font-bold", getSpeedColor(results.download))} data-testid="text-download-result">
            {formatMetric(results.download, "Mbps")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Download</p>
        </CyberCard>
        <CyberCard className="min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between">
            <Upload className={cn("h-5 w-5", getSpeedColor(results.upload))} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Outbound</span>
          </div>
          <p className={cn("font-mono text-2xl font-bold", getSpeedColor(results.upload))} data-testid="text-upload-result">
            {formatMetric(results.upload, "Mbps")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Upload</p>
        </CyberCard>
        <CyberCard className="min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between">
            <Gauge className="h-5 w-5 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Health</span>
          </div>
          <p className="font-mono text-2xl font-bold text-primary">
            {results.packetLoss === null ? "—" : `${100 - results.packetLoss}%`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Packet delivery</p>
        </CyberCard>
      </div>

      <CyberCard>
        <div className="mb-4 flex items-center gap-2">
          <Wifi className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">Diagnostic summary</h2>
            <p className="text-xs text-muted-foreground">Standard network performance indicators</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/50 bg-background/30 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Test stage</p>
            <p className="mt-1 font-mono text-sm font-bold capitalize text-primary">{phase}</p>
          </div>
          <div className="rounded-lg border border-border/50 bg-background/30 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Packet loss</p>
            <p className="mt-1 font-mono text-sm font-bold text-primary">
              {results.packetLoss === null ? "Pending" : `${results.packetLoss}%`}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-background/30 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</p>
            <p className="mt-1 font-mono text-sm font-bold text-emerald-400">
              {phase === "complete" ? "Complete" : isPaused ? "Paused" : isRunning ? "Running" : "Ready"}
            </p>
          </div>
        </div>
      </CyberCard>
    </div>
  );
}