import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  Download,
  Gauge,
  Globe2,
  Loader2,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Upload,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { LibreSpeedClient, type LibreSpeedStatus } from "@/lib/librespeed-client";

const GOOGLE_SPEED_TEST_URL = "https://fiber.google.com/speedtest/";

type TestPhase = "idle" | "latency" | "download" | "upload" | "complete" | "error";

interface SpeedResults {
  latency: number | null;
  download: number | null;
  upload: number | null;
  packetLoss: number | null;
}

interface NetworkProfile {
  isp: string | null;
  publicIp: string | null;
  location: string | null;
  asn: string | null;
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

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseNetworkProfile(data: Record<string, unknown>): NetworkProfile {
  const connection =
    typeof data.connection === "object" && data.connection !== null
      ? (data.connection as Record<string, unknown>)
      : {};
  const isp = stringValue(data.org) ?? stringValue(data.isp) ?? stringValue(connection.org);
  const publicIp = stringValue(data.ip);
  const location = [
    stringValue(data.city),
    stringValue(data.region),
    stringValue(data.region_name),
    stringValue(data.country_name) ?? stringValue(data.country),
  ]
    .filter((value): value is string => value !== null)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(", ") || null;
  const asn = stringValue(data.asn) ?? stringValue(connection.asn);
  if (!isp && !publicIp) {
    throw new Error("The ISP profile did not return usable network information.");
  }
  return { isp, publicIp, location, asn };
}

function formatMetric(value: number | null, unit: string) {
  return value === null ? "—" : `${value} ${unit}`;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function numericStatus(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function WaveChart({ points, progress, phase }: { points: number[]; progress: number; phase: TestPhase }) {
  const chartPoints = points.length ? points : initialWavePoints;
  const line = chartPoints
    .map((point, index) => `${(index / Math.max(chartPoints.length - 1, 1)) * 100},${88 - point * 62}`)
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
          <polyline points={line} fill="none" stroke="url(#waveStroke)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
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
          <span>0s</span><span>Response</span><span>Throughput</span><span>Now</span>
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
  const [results, setResults] = useState(initialResults);
  const [wavePoints, setWavePoints] = useState(initialWavePoints);
  const [error, setError] = useState<string | null>(null);
  const [networkProfile, setNetworkProfile] = useState<NetworkProfile | null>(null);
  const [networkProfileError, setNetworkProfileError] = useState<string | null>(null);
  const [isLoadingNetworkProfile, setIsLoadingNetworkProfile] = useState(true);
  const [networkProfileReloadKey, setNetworkProfileReloadKey] = useState(0);
  const pausedRef = useRef(false);
  const runIdRef = useRef(0);
  const libreSpeedRef = useRef<LibreSpeedClient | null>(null);
  const lastWaveUpdateRef = useRef(0);

  const appendWavePoint = useCallback((value: number) => {
    setWavePoints((current) => [...current.slice(-35), Math.max(0.08, Math.min(value, 0.98))]);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 7000);
    const loadNetworkProfile = async () => {
      setIsLoadingNetworkProfile(true);
      setNetworkProfileError(null);
      try {
        const providers = ["https://ipapi.co/json/", "https://ipinfo.io/json", "https://ipwho.is/"];
        let lastError: Error | null = null;
        for (const provider of providers) {
          try {
            const response = await fetch(provider, { cache: "no-store", signal: controller.signal });
            if (!response.ok) throw new Error(`ISP profile provider returned HTTP ${response.status}.`);
            setNetworkProfile(parseNetworkProfile((await response.json()) as Record<string, unknown>));
            return;
          } catch (caughtError) {
            if (isAbortError(caughtError)) throw caughtError;
            lastError = caughtError instanceof Error ? caughtError : new Error("ISP profile request failed.");
          }
        }
        throw lastError ?? new Error("No ISP profile provider returned usable network information.");
      } catch (caughtError) {
        if (!isAbortError(caughtError)) {
          setNetworkProfileError(caughtError instanceof Error ? caughtError.message : "The ISP profile could not be loaded.");
          setNetworkProfile(null);
        }
      } finally {
        window.clearTimeout(timeoutId);
        setIsLoadingNetworkProfile(false);
      }
    };
    void loadNetworkProfile();
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [networkProfileReloadKey]);

  const runSpeedTest = useCallback(async () => {
    const runId = ++runIdRef.current;
    setError(null);
    setResults(initialResults);
    setWavePoints(initialWavePoints);
    setHasStarted(true);
    setIsRunning(true);
    setPhase("latency");
    setProgress(phaseProgress.latency);

    try {
      const client = new LibreSpeedClient({
        baseUrl: window.location.origin,
        downloadPath: "/api/speedtest/librespeed/garbage.php",
        uploadPath: "/api/speedtest/librespeed/empty.php",
        pingPath: "/api/speedtest/librespeed/empty.php",
        getIpPath: "/api/speedtest/librespeed/getIP.php",
        downloadSeconds: 8,
        uploadSeconds: 8,
        pingCount: 10,
        onUpdate: (status: LibreSpeedStatus) => {
          if (runId !== runIdRef.current) return;
          const latency = numericStatus(status.pingStatus);
          const download = numericStatus(status.dlStatus);
          const upload = numericStatus(status.ulStatus);
          setResults((current) => ({
            ...current,
            latency: latency ?? current.latency,
            download: download ?? current.download,
            upload: upload ?? current.upload,
          }));
          if (status.testState === 2) {
            setPhase("latency");
            setProgress(Math.min(32, phaseProgress.latency + status.pingProgress * 20));
          } else if (status.testState === 1) {
            setPhase("download");
            setProgress(Math.min(68, 32 + status.dlProgress * 36));
          } else if (status.testState === 3) {
            setPhase("upload");
            setProgress(Math.min(94, 76 + status.ulProgress * 18));
          }
          const now = performance.now();
          if (now - lastWaveUpdateRef.current >= 180) {
            lastWaveUpdateRef.current = now;
            const signal = status.testState === 2
              ? 0.35 + Math.min((latency ?? 0) / 180, 0.45)
              : status.testState === 1
                ? 0.42 + Math.min((download ?? 0) / 500, 0.5)
                : 0.52 + Math.min((upload ?? 0) / 500, 0.4);
            appendWavePoint(signal);
          }
        },
        onEnd: (aborted) => {
          if (runId !== runIdRef.current) return;
          if (aborted) {
            if (pausedRef.current) return;
            setError("The LibreSpeed measurement was interrupted.");
            setPhase("error");
            setIsRunning(false);
            toast({ title: "Speed test could not be completed", description: "The measurement was interrupted.", variant: "destructive" });
            return;
          }
          setResults((current) => ({ ...current, packetLoss: 0 }));
          setProgress(100);
          setPhase("complete");
          setIsRunning(false);
          toast({ title: "Speed test complete", description: "Latency and throughput results are ready below." });
        },
        onError: (measurementError) => {
          if (runId !== runIdRef.current) return;
          setError(measurementError.message);
          setPhase("error");
          setIsRunning(false);
          toast({ title: "Speed test could not be completed", description: measurementError.message, variant: "destructive" });
        },
      });
      libreSpeedRef.current = client;
      client.start();
    } catch (caughtError) {
      if (runId !== runIdRef.current) return;
      const message = caughtError instanceof Error ? caughtError.message : "The speed test was interrupted.";
      setError(message);
      setPhase("error");
      setIsRunning(false);
      toast({ title: "Speed test could not be completed", description: message, variant: "destructive" });
    }
  }, [appendWavePoint, toast]);

  useEffect(() => () => {
    runIdRef.current += 1;
    libreSpeedRef.current?.abort();
  }, []);

  const startSpeedTest = () => {
    if (hasStarted && !isRunning && phase !== "complete" && phase !== "error") {
      pausedRef.current = false;
      void runSpeedTest();
      toast({ title: "Speed test resumed", description: "Continuing the network measurement." });
      return;
    }
    pausedRef.current = false;
    void runSpeedTest();
  };
  const pauseSpeedTest = () => {
    pausedRef.current = true;
    libreSpeedRef.current?.abort();
    setIsRunning(false);
    toast({ title: "Speed test paused", description: "Resume when you are ready to continue." });
  };
  const resetTest = () => {
    runIdRef.current += 1;
    pausedRef.current = false;
    libreSpeedRef.current?.abort();
    libreSpeedRef.current = null;
    setIsRunning(false);
    setHasStarted(false);
    setPhase("idle");
    setProgress(0);
    setResults(initialResults);
    setWavePoints(initialWavePoints);
    setError(null);
  };
  const isPaused = hasStarted && !isRunning && phase !== "complete" && phase !== "error";
  const phaseLabel = { idle: "Ready to test", latency: "Measuring latency", download: "Measuring download", upload: "Measuring upload", complete: "Test complete", error: "Test interrupted" }[phase];
  const colorForSpeed = (value: number | null) => value === null ? "text-muted-foreground" : value >= 100 ? "text-emerald-400" : value >= 50 ? "text-primary" : value >= 20 ? "text-amber-400" : "text-rose-400";
  const colorForLatency = (value: number | null) => value === null ? "text-muted-foreground" : value <= 20 ? "text-emerald-400" : value <= 50 ? "text-primary" : value <= 100 ? "text-amber-400" : "text-rose-400";

  return (
    <div className="space-y-6">
      <Header title="Speed Test" subtitle="ISP-Based Network Diagnostics" />
      <CyberCard className="overflow-hidden border-primary/20">
        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/15 p-3"><BarChart3 className="h-6 w-6 text-primary" /></div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">ISP-based connection telemetry</p>
                <h2 className="font-display text-xl font-bold text-white">Measure your network</h2>
              </div>
            </div>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">Measure the connection from this device to SafeNet and identify the ISP associated with your public IP. The chart updates as each measurement completes.</p>
            <div className="flex flex-wrap gap-3">
              {!isRunning ? (
                <Button size="lg" onClick={startSpeedTest} className="bg-primary px-8 font-bold text-primary-foreground hover:bg-primary/90" data-testid="button-start-speedtest">
                  <Play className="mr-2 h-5 w-5" />{isPaused ? "Resume Test" : phase === "complete" ? "Run Again" : phase === "error" ? "Retry Test" : "Start Test"}
                </Button>
              ) : (
                <Button size="lg" onClick={pauseSpeedTest} variant="outline" className="px-8" data-testid="button-pause-speedtest"><Pause className="mr-2 h-5 w-5" />Pause Test</Button>
              )}
              {(phase === "complete" || phase === "error") && <Button size="lg" variant="outline" onClick={resetTest} data-testid="button-reset-speedtest"><RotateCcw className="mr-2 h-4 w-4" />Reset</Button>}
              <Button type="button" size="lg" variant="outline" asChild data-testid="button-google-speedtest">
                <a href={GOOGLE_SPEED_TEST_URL} target="_blank" rel="noreferrer">Google Speed Test</a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Google&apos;s official Fiber speed test opens in a separate tab because Google does not permit this page to be embedded.</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {phase === "complete" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : phase === "error" ? <AlertTriangle className="h-4 w-4 text-rose-400" /> : <Activity className={cn("h-4 w-4 text-primary", isRunning && "animate-pulse")} />}
              <span>{phaseLabel}</span><span className="ml-auto font-mono text-primary">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted/20"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 via-indigo-400 to-emerald-400 transition-all duration-300" style={{ width: `${progress}%` }} /></div>
            {error && <p className="text-xs text-rose-400" role="alert">{error}</p>}
          </div>
          <WaveChart points={wavePoints} progress={progress} phase={phase} />
        </div>
      </CyberCard>

      <CyberCard className="border-sky-400/20 bg-gradient-to-r from-sky-400/5 to-transparent">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-sky-400/15 p-3"><Globe2 className="h-5 w-5 text-sky-300" /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">Network identity</p>
              <h2 className="font-display text-lg font-bold text-white">ISP-based connection profile</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">ISP details are inferred from this device&apos;s public IP. They are used for display only and are not stored.</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setNetworkProfileReloadKey((current) => current + 1)} disabled={isLoadingNetworkProfile} data-testid="button-refresh-network-profile">
            <RotateCcw className={cn("mr-2 h-4 w-4", isLoadingNetworkProfile && "animate-spin")} />Refresh
          </Button>
        </div>
        {isLoadingNetworkProfile ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-sky-300" />Detecting your ISP and public network…</div>
        ) : networkProfileError ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-rose-300" role="alert"><AlertTriangle className="h-4 w-4" /><span>{networkProfileError}</span><Button type="button" variant="ghost" size="sm" className="text-sky-300 hover:text-sky-200" onClick={() => setNetworkProfileReloadKey((current) => current + 1)}>Try again</Button></div>
        ) : networkProfile ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              [Building2, "ISP", networkProfile.isp ?? "Not provided"],
              [Globe2, "Public IP", networkProfile.publicIp ?? "Not provided"],
              [MapPin, "Location", networkProfile.location ?? "Not provided"],
              [Wifi, "Network ID", networkProfile.asn ?? "Not provided"],
            ] as [LucideIcon, string, string][]).map(([Icon, label, value]) => (
              <div className="rounded-lg border border-sky-400/20 bg-background/30 p-3" key={label as string}>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground"><Icon className="h-3.5 w-3.5 text-sky-300" />{label}</div>
                <p className="mt-2 truncate font-mono text-sm font-bold text-white" title={value}>{value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </CyberCard>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {([
          [Clock3, "Response", formatMetric(results.latency, "ms"), "Latency", colorForLatency(results.latency), "text-ping-result"],
          [Download, "Inbound", formatMetric(results.download, "Mbps"), "Download", colorForSpeed(results.download), "text-download-result"],
          [Upload, "Outbound", formatMetric(results.upload, "Mbps"), "Upload", colorForSpeed(results.upload), "text-upload-result"],
          [Gauge, "Health", results.packetLoss === null ? "—" : `${100 - results.packetLoss}%`, "Packet delivery", "text-primary", undefined],
        ] as [LucideIcon, string, string, string, string, string | undefined][]).map(([Icon, label, value, caption, color, testId]) => (
          <CyberCard className="min-w-0 p-4" key={label as string}>
            <div className="mb-3 flex items-center justify-between"><Icon className={cn("h-5 w-5", color)} /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span></div>
            <p className={cn("font-mono text-2xl font-bold", color)} data-testid={testId}>{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
          </CyberCard>
        ))}
      </div>

      <CyberCard>
        <div className="mb-4 flex items-center gap-2"><Wifi className="h-5 w-5 text-primary" /><div><h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">Diagnostic summary</h2><p className="text-xs text-muted-foreground">Standard network performance indicators</p></div></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/50 bg-background/30 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Test stage</p><p className="mt-1 font-mono text-sm font-bold capitalize text-primary">{phase}</p></div>
          <div className="rounded-lg border border-border/50 bg-background/30 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ping packet loss</p><p className="mt-1 font-mono text-sm font-bold text-primary">{results.packetLoss === null ? "Pending" : `${results.packetLoss}%`}</p></div>
          <div className="rounded-lg border border-border/50 bg-background/30 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</p><p className="mt-1 font-mono text-sm font-bold text-emerald-400">{phase === "complete" ? "Complete" : isPaused ? "Paused" : isRunning ? "Running" : "Ready"}</p></div>
        </div>
      </CyberCard>
    </div>
  );
}