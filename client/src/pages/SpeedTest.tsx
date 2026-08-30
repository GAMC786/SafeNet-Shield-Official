import { useState, useCallback } from "react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { Gauge, Download, Upload, Activity, Play, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface SpeedResults {
  ping: number | null;
  download: number | null;
  upload: number | null;
}

type TestPhase = "idle" | "ping" | "download" | "upload" | "complete";

export default function SpeedTest() {
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState<TestPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<SpeedResults>({
    ping: null,
    download: null,
    upload: null,
  });

  const measurePing = async (): Promise<number> => {
    const pings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await apiFetch("/api/speedtest/ping", { cache: "no-store" });
      const end = performance.now();
      pings.push(end - start);
    }
    return Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
  };

  const measureDownload = async (): Promise<number> => {
    const testSize = 5000000; // 5MB
    const start = performance.now();
    
    const response = await apiFetch(`/api/speedtest/download?size=${testSize}`, {
      cache: "no-store",
      timeoutMs: 60000,
    });
    
    const reader = response.body?.getReader();
    let bytesReceived = 0;
    
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesReceived += value.length;
        setProgress((bytesReceived / testSize) * 100);
      }
    }
    
    const end = performance.now();
    const duration = (end - start) / 1000;
    const speedMbps = (bytesReceived * 8) / (duration * 1000000);
    return Math.round(speedMbps * 100) / 100;
  };

  const measureUpload = async (): Promise<number> => {
    const testSize = 1000000; // 1MB for faster test
    const data = new Uint8Array(testSize);
    for (let i = 0; i < testSize; i++) {
      data[i] = Math.floor(Math.random() * 256);
    }
    
    const start = performance.now();
    
    const response = await apiFetch("/api/speedtest/upload", {
      method: "POST",
      body: data,
      headers: {
        "Content-Type": "application/octet-stream",
      },
      timeoutMs: 60000,
    });
    
    await response.json();
    
    const end = performance.now();
    const duration = (end - start) / 1000;
    const speedMbps = (testSize * 8) / (duration * 1000000);
    return Math.round(speedMbps * 100) / 100;
  };

  const runSpeedTest = useCallback(async () => {
    setIsRunning(true);
    setResults({ ping: null, download: null, upload: null });
    
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
      for (let i = 0; i <= 100; i += 10) {
        setProgress(i);
        await new Promise((r) => setTimeout(r, 50));
      }
      const upload = await measureUpload();
      setResults((prev) => ({ ...prev, upload }));
      
      setPhase("complete");
    } catch (error) {
      console.error("Speed test failed:", error);
    } finally {
      setIsRunning(false);
    }
  }, []);

  const resetTest = () => {
    setPhase("idle");
    setProgress(0);
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

  return (
    <div className="space-y-6">
      <Header
        title="Speed Test"
        subtitle="Network Performance"
      />

      <CyberCard className="relative overflow-visible">
        <div className="flex flex-col items-center py-8">
          {/* Speed Gauge */}
          <div className="relative w-64 h-32 mb-8">
            <svg viewBox="0 0 200 100" className="w-full h-full">
              {/* Background arc */}
              <path
                d="M 20 90 A 80 80 0 0 1 180 90"
                fill="none"
                stroke="currentColor"
                strokeWidth="12"
                className="text-muted/20"
                strokeLinecap="round"
              />
              {/* Progress arc */}
              <motion.path
                d="M 20 90 A 80 80 0 0 1 180 90"
                fill="none"
                stroke="url(#speedGradient)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray="251"
                initial={{ strokeDashoffset: 251 }}
                animate={{ 
                  strokeDashoffset: isRunning 
                    ? 251 - (progress / 100) * 251 
                    : phase === "complete" 
                      ? 0 
                      : 251 
                }}
                transition={{ duration: 0.3 }}
              />
              <defs>
                <linearGradient id="speedGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="50%" stopColor="#eab308" />
                  <stop offset="100%" stopColor="#22c55e" />
                </linearGradient>
              </defs>
            </svg>
            
            {/* Center display */}
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
              <motion.div
                key={phase}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center"
              >
                {phase === "idle" && (
                  <Gauge className="w-12 h-12 text-muted-foreground mx-auto" />
                )}
                {phase === "ping" && (
                  <>
                    <Activity className="w-8 h-8 text-primary mx-auto animate-pulse" />
                    <p className="text-xs text-muted-foreground mt-1">Testing Ping...</p>
                  </>
                )}
                {phase === "download" && (
                  <>
                    <Download className="w-8 h-8 text-primary mx-auto animate-bounce" />
                    <p className="text-xs text-muted-foreground mt-1">Download Test</p>
                  </>
                )}
                {phase === "upload" && (
                  <>
                    <Upload className="w-8 h-8 text-primary mx-auto animate-bounce" />
                    <p className="text-xs text-muted-foreground mt-1">Upload Test</p>
                  </>
                )}
                {phase === "complete" && (
                  <p className="text-lg font-bold text-green-400">Complete</p>
                )}
              </motion.div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4">
            {phase === "idle" || phase === "complete" ? (
              <>
                <Button
                  size="lg"
                  onClick={runSpeedTest}
                  disabled={isRunning}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-8"
                  data-testid="button-start-speedtest"
                >
                  <Play className="w-5 h-5 mr-2" />
                  {phase === "complete" ? "Run Again" : "Start Test"}
                </Button>
                {phase === "complete" && (
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={resetTest}
                    data-testid="button-reset-speedtest"
                  >
                    <RotateCcw className="w-5 h-5" />
                  </Button>
                )}
              </>
            ) : (
              <Button size="lg" disabled className="px-8">
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                Testing...
              </Button>
            )}
          </div>
        </div>
      </CyberCard>

      {/* Results Grid */}
      <div className="grid grid-cols-3 gap-4">
        <CyberCard className="text-center py-6">
          <Activity className={cn("w-8 h-8 mx-auto mb-2", getPingColor(results.ping))} />
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Ping</p>
          <p className={cn("text-2xl font-mono font-bold", getPingColor(results.ping))} data-testid="text-ping-result">
            {results.ping !== null ? `${results.ping} ms` : "—"}
          </p>
        </CyberCard>

        <CyberCard className="text-center py-6">
          <Download className={cn("w-8 h-8 mx-auto mb-2", getSpeedColor(results.download))} />
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Download</p>
          <p className={cn("text-2xl font-mono font-bold", getSpeedColor(results.download))} data-testid="text-download-result">
            {results.download !== null ? `${results.download} Mbps` : "—"}
          </p>
        </CyberCard>

        <CyberCard className="text-center py-6">
          <Upload className={cn("w-8 h-8 mx-auto mb-2", getSpeedColor(results.upload))} />
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Upload</p>
          <p className={cn("text-2xl font-mono font-bold", getSpeedColor(results.upload))} data-testid="text-upload-result">
            {results.upload !== null ? `${results.upload} Mbps` : "—"}
          </p>
        </CyberCard>
      </div>

      {/* Info */}
      <CyberCard className="text-center py-4">
        <p className="text-xs text-muted-foreground">
          Speed test measures your connection to this server. Results may vary based on network conditions.
        </p>
      </CyberCard>
    </div>
  );
}
