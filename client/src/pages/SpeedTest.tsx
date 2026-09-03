import { useState, useCallback } from "react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { Download, Upload, Activity, Play, RotateCcw, ShieldCheck, LockKeyhole, Satellite, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface SpeedResults {
  ping: number | null;
  download: number | null;
  upload: number | null;
}

type TestPhase = "idle" | "ping" | "download" | "upload" | "complete" | "error";

const DOWNLOAD_SIZE_BYTES = 8_000_000;
const DOWNLOAD_SAMPLES = 2;
const UPLOAD_SIZE_BYTES = 2_000_000;
const UPLOAD_SAMPLES = 2;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function formatSpeed(speed: number | null) {
  return speed === null ? "—" : `${speed} Mbps`;
}

export default function SpeedTest() {
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [results, setResults] = useState<SpeedResults>({
    ping: null,
    download: null,
    upload: null,
  });

  const measurePing = async (): Promise<number> => {
    const pings: number[] = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      const response = await apiFetch("/api/speedtest/ping", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("The SafeNet latency endpoint was unavailable.");
      }
      const end = performance.now();
      pings.push(end - start);
    }
    return Math.round(median(pings));
  };

  const measureDownload = async (): Promise<number> => {
    const speeds: number[] = [];
    let bytesReceivedOverall = 0;
    const totalBytes = DOWNLOAD_SIZE_BYTES * DOWNLOAD_SAMPLES;

    for (let sample = 0; sample < DOWNLOAD_SAMPLES; sample++) {
      const start = performance.now();
      const response = await apiFetch(`/api/speedtest/download?size=${DOWNLOAD_SIZE_BYTES}`, {
        cache: "no-store",
        timeoutMs: 60000,
      });
      if (!response.ok) {
        throw new Error("The SafeNet download endpoint was unavailable.");
      }

      const reader = response.body?.getReader();
      let bytesReceived = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytesReceived += value.length;
          bytesReceivedOverall += value.length;
          setProgress((bytesReceivedOverall / totalBytes) * 100);
        }
      } else {
        const buffer = await response.arrayBuffer();
        bytesReceived = buffer.byteLength;
        bytesReceivedOverall += bytesReceived;
        setProgress((bytesReceivedOverall / totalBytes) * 100);
      }

      const duration = (performance.now() - start) / 1000;
      if (bytesReceived === 0 || duration <= 0) {
        throw new Error("The SafeNet download test returned no data.");
      }
      speeds.push((bytesReceived * 8) / (duration * 1_000_000));
    }

    return Math.round(median(speeds) * 100) / 100;
  };

  const measureUpload = async (): Promise<number> => {
    const speeds: number[] = [];
    const totalBytes = UPLOAD_SIZE_BYTES * UPLOAD_SAMPLES;
    let bytesUploadedOverall = 0;

    for (let sample = 0; sample < UPLOAD_SAMPLES; sample++) {
      const data = new Uint8Array(UPLOAD_SIZE_BYTES);
      for (let offset = 0; offset < data.length; offset += 65_536) {
        crypto.getRandomValues(data.subarray(offset, Math.min(offset + 65_536, data.length)));
      }
      setProgress((bytesUploadedOverall / totalBytes) * 100);
      const start = performance.now();
      const response = await apiFetch("/api/speedtest/upload", {
        method: "POST",
        body: data,
        headers: {
          "Content-Type": "application/octet-stream",
        },
        timeoutMs: 60000,
      });
      if (!response.ok) {
        throw new Error("The SafeNet upload endpoint was unavailable.");
      }
      await response.json();
      bytesUploadedOverall += data.byteLength;
      setProgress((bytesUploadedOverall / totalBytes) * 100);

      const duration = (performance.now() - start) / 1000;
      if (duration <= 0) {
        throw new Error("The SafeNet upload test returned an invalid duration.");
      }
      speeds.push((data.byteLength * 8) / (duration * 1_000_000));
    }

    return Math.round(median(speeds) * 100) / 100;
  };

  const runSpeedTest = useCallback(async () => {
    setIsRunning(true);
    setResults({ ping: null, download: null, upload: null });
    setErrorMessage(null);
    
    try {
      // Ping test
      setPhase("ping");
      setProgress(0);
      const ping = await measurePing();
      setResults((prev) => ({ ...prev, ping }));
      
      // Download test
      setPhase("download");
      setProgress(0);
      const download = await measureDownload();
      setResults((prev) => ({ ...prev, download }));
      
      // Upload test
      setPhase("upload");
      setProgress(0);
      const upload = await measureUpload();
      setResults((prev) => ({ ...prev, upload }));
      
      setPhase("complete");
    } catch (error) {
      console.error("Speed test failed:", error);
      setErrorMessage(error instanceof Error ? error.message : "The secure speed test could not complete.");
      setPhase("error");
    } finally {
      setIsRunning(false);
    }
  }, []);

  const resetTest = () => {
    setPhase("idle");
    setProgress(0);
    setErrorMessage(null);
    setResults({ ping: null, download: null, upload: null });
  };

  const getSpeedColor = (speed: number | null) => {
    if (speed === null) return "text-muted-foreground";
    if (speed >= 100) return "text-green-400";
    if (speed >= 50) return "text-primary";
    if (speed >= 20) return "text-yellow-400";
    return "text-red-400";
  };

  const getPingColor = (ping: number | null) => {
    if (ping === null) return "text-muted-foreground";
    if (ping <= 20) return "text-green-400";
    if (ping <= 50) return "text-primary";
    if (ping <= 100) return "text-yellow-400";
    return "text-red-400";
  };

  const phaseLabel = {
    idle: "Ready for launch",
    ping: "Measuring route latency",
    download: "Receiving secure test data",
    upload: "Sending secure test data",
    complete: "Mission complete",
    error: "Mission interrupted",
  }[phase];

  return (
    <div className="space-y-6">
      <Header
        title="SafeNet Speed Test"
        subtitle="Privacy-first network performance"
      />

      <CyberCard className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-transparent">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full border border-primary/10" />
        <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full border border-primary/10" />
        <div className="grid items-center gap-8 py-4 lg:grid-cols-[1fr_0.8fr] lg:py-8">
          <div className="relative flex min-h-[260px] items-center justify-center overflow-hidden rounded-2xl border border-primary/15 bg-black/20">
            <div className="absolute inset-0 opacity-50">
              <span className="absolute left-[14%] top-[22%] h-1 w-1 rounded-full bg-white" />
              <span className="absolute left-[25%] top-[68%] h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="absolute right-[18%] top-[25%] h-1 w-1 rounded-full bg-white" />
              <span className="absolute right-[28%] bottom-[18%] h-1.5 w-1.5 rounded-full bg-cyan-300" />
              <span className="absolute left-[48%] top-[12%] h-1 w-1 rounded-full bg-white" />
            </div>
            <motion.div
              className="absolute h-52 w-52 rounded-full border border-primary/20"
              animate={{ rotate: 360 }}
              transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
            >
              <Satellite className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 text-primary/70" />
            </motion.div>
            <motion.div
              className="relative z-10"
              animate={{ y: [0, -10, 0], rotate: [-2, 2, -2] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="relative mx-auto h-20 w-20 rounded-[2rem] border-2 border-primary/60 bg-slate-200/10 shadow-[0_0_30px_rgba(59,130,246,0.35)]">
                <div className="absolute inset-2 rounded-[1.4rem] border border-cyan-300/50 bg-slate-950/80">
                  <div className="absolute left-1/2 top-1/2 h-2 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300/70" />
                </div>
                <div className="absolute -bottom-2 left-1/2 h-4 w-12 -translate-x-1/2 rounded-b-xl border-x-2 border-b-2 border-primary/60 bg-slate-200/10" />
              </div>
              <div className="relative mx-auto mt-1 h-20 w-28 rounded-3xl border-2 border-white/20 bg-white/10">
                <div className="absolute -left-5 top-3 h-12 w-6 -rotate-12 rounded-full border border-primary/50 bg-primary/20" />
                <div className="absolute -right-5 top-3 h-12 w-6 rotate-12 rounded-full border border-primary/50 bg-primary/20" />
                <div className="absolute bottom-[-1.6rem] left-3 h-7 w-7 rounded-b-xl border-x-2 border-b-2 border-primary/60 bg-primary/10" />
                <div className="absolute bottom-[-1.6rem] right-3 h-7 w-7 rounded-b-xl border-x-2 border-b-2 border-primary/60 bg-primary/10" />
                <div className="absolute left-1/2 top-5 h-2 w-10 -translate-x-1/2 rounded-full bg-primary/60" />
              </div>
              <motion.div
                className="mx-auto mt-7 h-8 w-14 rounded-[50%] bg-primary/30 blur-md"
                animate={{ scaleX: [0.75, 1.1, 0.75], opacity: [0.35, 0.7, 0.35] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
              />
            </motion.div>
            <div className="absolute bottom-4 left-4 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-primary/80">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
              SafeNet secure link
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-green-400/30 bg-green-400/10 px-2.5 py-1 text-[11px] font-semibold text-green-300">
                  <LockKeyhole className="h-3 w-3" /> HTTPS encrypted
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                  <ShieldCheck className="h-3 w-3" /> No third-party telemetry
                </span>
              </div>
              <h2 className="text-2xl font-display font-bold text-white">A cleaner alternative to Ookla</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Test your device-to-SafeNet connection with two samples per direction.
                Results use median measurements to reduce one-off network spikes.
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-white">{phaseLabel}</span>
                </div>
                <span className="font-mono text-xs text-primary">{Math.round(progress)}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className={cn("h-full rounded-full", phase === "error" ? "bg-destructive" : "bg-primary")}
                  animate={{ width: `${phase === "complete" ? 100 : progress}%` }}
                  transition={{ duration: 0.25 }}
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                The Android APK can additionally route this connection through SafeNet DNS VPN.
                Browser tests use the secure HTTPS endpoint only.
              </p>
            </div>

            {errorMessage && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              {phase === "idle" || phase === "complete" || phase === "error" ? (
                <>
                  <Button
                    size="lg"
                    onClick={runSpeedTest}
                    disabled={isRunning}
                    className="bg-primary px-8 font-bold text-primary-foreground hover:bg-primary/90"
                    data-testid="button-start-speedtest"
                  >
                    <Play className="mr-2 h-5 w-5" />
                    {phase === "idle" ? "Start Test" : "Run Again"}
                  </Button>
                  {phase !== "idle" && (
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={resetTest}
                      data-testid="button-reset-speedtest"
                      aria-label="Reset speed test"
                    >
                      <RotateCcw className="h-5 w-5" />
                    </Button>
                  )}
                </>
              ) : (
                <Button size="lg" disabled className="px-8">
                  <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Testing...
                </Button>
              )}
            </div>
          </div>
        </div>
      </CyberCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CyberCard className="text-center py-6">
          <Activity className={cn("mx-auto mb-2 h-8 w-8", getPingColor(results.ping))} />
          <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Ping</p>
          <p className={cn("font-mono text-2xl font-bold", getPingColor(results.ping))} data-testid="text-ping-result">
            {results.ping !== null ? `${results.ping} ms` : "—"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">HTTP median</p>
        </CyberCard>

        <CyberCard className="text-center py-6">
          <Download className={cn("mx-auto mb-2 h-8 w-8", getSpeedColor(results.download))} />
          <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Download</p>
          <p className={cn("font-mono text-2xl font-bold", getSpeedColor(results.download))} data-testid="text-download-result">
            {formatSpeed(results.download)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Median of 2 × 8 MB</p>
        </CyberCard>

        <CyberCard className="text-center py-6">
          <Upload className={cn("mx-auto mb-2 h-8 w-8", getSpeedColor(results.upload))} />
          <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Upload</p>
          <p className={cn("font-mono text-2xl font-bold", getSpeedColor(results.upload))} data-testid="text-upload-result">
            {formatSpeed(results.upload)}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">Median of 2 × 2 MB</p>
        </CyberCard>
      </div>

      <CyberCard className="text-center py-4">
        <p className="text-xs text-muted-foreground">
          SafeNet measures your connection to this server over HTTPS. It does not replace
          Android DNS VPN protection or an ISP&apos;s local network diagnostics.
        </p>
      </CyberCard>
    </div>
  );
}
