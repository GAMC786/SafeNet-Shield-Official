import { AlertTriangle, PhoneCall, ShieldCheck } from "lucide-react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";

export default function SpamCallBlocker() {
  return (
    <div className="space-y-6">
      <Header
        title="Spam Call Blocker"
        subtitle="Caller protection and screening controls"
        status="inactive"
      />

      <CyberCard className="overflow-hidden">
        <div className="flex items-start gap-4">
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-primary">
            <PhoneCall className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold normal-case tracking-normal text-white">
              Native call screening is not connected
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              SafeNet needs the Android CallScreeningService and a caller-reputation source before it can
              automatically silence or block calls. This page will become the control center when that
              native service is connected.
            </p>
          </div>
        </div>
      </CyberCard>

      <div className="grid gap-4 md:grid-cols-2">
        <CyberCard>
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold normal-case tracking-normal text-white">
              Protection flow
            </h2>
          </div>
          <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <span className="font-mono text-primary">01</span>
              <span>Check the incoming number against SafeNet blocklists.</span>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-primary">02</span>
              <span>Combine local reports with caller-reputation signals.</span>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-primary">03</span>
              <span>Let Android decide whether to allow, silence, or block the call.</span>
            </li>
          </ol>
        </CyberCard>

        <CyberCard>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-300" />
            <h2 className="text-base font-semibold normal-case tracking-normal text-white">
              Current status
            </h2>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            No calls are being blocked by this screen yet. Connecting a native screening service will
            add the enable switch, blocked-number list, and caller report controls here.
          </p>
        </CyberCard>
      </div>
    </div>
  );
}