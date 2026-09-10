import { useState } from "react";
import { Activity, ExternalLink, Gauge, Globe2, RotateCcw, Wifi } from "lucide-react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";

const OPEN_SPEED_TEST_URL = "https://openspeedtest.com/speedtest?darkmode=1";

export default function SpeedTest() {
  const [reloadKey, setReloadKey] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);

  return (
    <div className="space-y-6">
      <Header title="Speed Test" subtitle="OpenSpeedTest Network Diagnostics" />

      <CyberCard className="border-primary/20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/15 p-3">
              <Gauge className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                OpenSpeedTest engine
              </p>
              <h2 className="font-display text-xl font-bold text-white">
                Measure your real connection
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                The official OpenSpeedTest browser engine measures sustained latency,
                download, and upload performance directly from this device.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setHasLoaded(false);
                setReloadKey((current) => current + 1);
              }}
              data-testid="button-refresh-speedtest"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reload
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={OPEN_SPEED_TEST_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open full test
              </a>
            </Button>
          </div>
        </div>
      </CyberCard>

      <CyberCard className="overflow-hidden border-sky-400/20 p-2 sm:p-4">
        <div className="mb-3 flex items-center justify-between px-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-sky-300" />
            Live connection test
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${hasLoaded ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
            {hasLoaded ? "Ready" : "Loading"}
          </div>
        </div>
        <iframe
          key={reloadKey}
          title="OpenSpeedTest"
          src={OPEN_SPEED_TEST_URL}
          onLoad={() => setHasLoaded(true)}
          className="h-[720px] min-h-[560px] w-full rounded-lg border border-white/10 bg-slate-950"
          allow="fullscreen"
          loading="eager"
          data-testid="openspeedtest-frame"
        />
        <p className="mt-3 px-2 text-xs leading-5 text-muted-foreground">
          If the embedded test is blocked by a network policy, use <a className="text-primary underline" href={OPEN_SPEED_TEST_URL} target="_blank" rel="noreferrer">Open full test</a> to run the same official engine outside the embedded view.
        </p>
      </CyberCard>

      <div className="grid gap-4 sm:grid-cols-3">
        <CyberCard className="p-4">
          <Wifi className="mb-3 h-5 w-5 text-primary" />
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Engine</p>
          <p className="mt-1 font-mono text-sm font-bold text-white">OpenSpeedTest</p>
        </CyberCard>
        <CyberCard className="p-4">
          <Globe2 className="mb-3 h-5 w-5 text-sky-300" />
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Measurement</p>
          <p className="mt-1 font-mono text-sm font-bold text-white">Browser to edge</p>
        </CyberCard>
        <CyberCard className="p-4">
          <Gauge className="mb-3 h-5 w-5 text-emerald-300" />
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Results</p>
          <p className="mt-1 font-mono text-sm font-bold text-white">Live in test panel</p>
        </CyberCard>
      </div>
    </div>
  );
}