import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, LockKeyhole, PhoneCall, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useCallScreening } from "@/hooks/use-vpn";
import { apiFetch } from "@/lib/api";
import { Capacitor } from "@capacitor/core";
import { useToast } from "@/hooks/use-toast";

function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

export default function SpamCallBlocker() {
  const native = useCallScreening();
  const { toast } = useToast();
  const [blockedNumbers, setBlockedNumbers] = usePersistentState<string[]>(
    "safenet-spam-call-blocked-numbers",
    [],
  );
  const [number, setNumber] = useState("");
  const [reportNumber, setReportNumber] = useState("");
  const [isReporting, setIsReporting] = useState(false);

  const syncConfig = native.syncConfig;
  useEffect(() => {
    void syncConfig(blockedNumbers).catch(() => undefined);
  }, [blockedNumbers, syncConfig]);

  const addBlockedNumber = useCallback(() => {
    const normalized = normalizePhoneNumber(number);
    if (!normalized) {
      toast({ title: "Enter a valid phone number", description: "Use at least 7 digits.", variant: "destructive" });
      return;
    }
    setBlockedNumbers((current) => current.includes(normalized) ? current : [...current, normalized]);
    setNumber("");
  }, [number, setBlockedNumbers, toast]);

  const removeBlockedNumber = useCallback((value: string) => {
    setBlockedNumbers((current) => current.filter((entry) => entry !== value));
  }, [setBlockedNumbers]);

  const reportSpam = useCallback(async () => {
    const normalized = normalizePhoneNumber(reportNumber);
    if (!normalized) {
      toast({ title: "Enter a valid phone number", description: "Use at least 7 digits.", variant: "destructive" });
      return;
    }
    setIsReporting(true);
    try {
      const response = await apiFetch("/api/spam-call-blocker/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: normalized, reason: "user_report" }),
      });
      const result = await response.json() as { accepted: boolean; reason: string };
      if (!response.ok) {
        throw new Error(result.reason || "The reputation source is unavailable.");
      }
      toast({
        title: result.accepted ? "Spam report submitted" : "Spam report not submitted",
        description: result.reason,
        variant: result.accepted ? "default" : "destructive",
      });
      if (result.accepted) setReportNumber("");
    } catch (error) {
      toast({
        title: "Spam report not submitted",
        description: error instanceof Error ? error.message : "The reputation source is unavailable.",
        variant: "destructive",
      });
    } finally {
      setIsReporting(false);
    }
  }, [reportNumber, toast]);

  const isAndroid = Capacitor.getPlatform() === "android";
  const enabled = native.status?.enabled === true;
  const status = !isAndroid ? "inactive" : enabled ? "active" : native.status?.roleAvailable ? "not-sharing" : "inactive";
  const statusLabel = !isAndroid
    ? "Android only"
    : enabled
      ? "Screening active"
      : native.status?.roleAvailable
        ? "Enable required"
        : "Unavailable";
  const blockedCount = useMemo(() => blockedNumbers.length, [blockedNumbers.length]);

  return (
    <div className="space-y-6">
      <Header
        title="Spam Call Blocker"
        subtitle="Caller protection and screening controls"
        status={status}
      />

      <CyberCard className="overflow-hidden">
        <div className="flex items-start gap-4">
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-primary">
            <PhoneCall className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold normal-case tracking-normal text-white">
              {enabled ? "Native call screening is active" : "Native call screening needs access"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {isAndroid
                ? native.status?.message ?? "Checking Android call-screening status..."
                : "Call screening is available in the SafeNet Android app. Browser controls can still prepare your blocked-number list."}
            </p>
            {isAndroid && !enabled && native.status?.roleAvailable && (
              <Button className="mt-4" onClick={() => void native.requestRole()} disabled={native.isBusy}>
                <PhoneCall className="h-4 w-4" />
                {native.isBusy ? "Opening Android settings..." : "Enable call screening"}
              </Button>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant={enabled ? "default" : "outline"}>{statusLabel}</Badge>
              <Badge variant="outline">{blockedCount} blocked locally</Badge>
              {native.status?.apiConfigured && <Badge variant="outline">SafeNet API connected</Badge>}
            </div>
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
            SafeNet only acts on an explicit local block or an approved reputation response. If Android
            or the reputation source is unavailable, incoming calls are allowed.
          </p>
        </CyberCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CyberCard>
          <div className="flex items-center gap-3">
            <LockKeyhole className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold normal-case tracking-normal text-white">Blocked numbers</h2>
              <p className="text-xs text-muted-foreground">Stored on this device and used before any network lookup.</p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Input
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") addBlockedNumber(); }}
              placeholder="+1 555 123 4567"
              inputMode="tel"
              aria-label="Phone number to block"
            />
            <Button onClick={addBlockedNumber} size="icon" aria-label="Add blocked number">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-4 space-y-2">
            {blockedNumbers.length === 0 && (
              <p className="text-sm text-muted-foreground">No local blocked numbers yet.</p>
            )}
            {blockedNumbers.map((value) => (
              <div key={value} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <span className="font-mono text-sm text-white">{value}</span>
                <Button variant="ghost" size="icon" onClick={() => removeBlockedNumber(value)} aria-label={`Remove ${value}`}>
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        </CyberCard>

        <CyberCard>
          <div className="flex items-center gap-3">
            <PhoneCall className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold normal-case tracking-normal text-white">Report a spam caller</h2>
              <p className="text-xs text-muted-foreground">Send a caller number to the approved reputation source.</p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Input
              value={reportNumber}
              onChange={(event) => setReportNumber(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void reportSpam(); }}
              placeholder="+1 555 123 4567"
              inputMode="tel"
              aria-label="Phone number to report"
            />
            <Button onClick={() => void reportSpam()} disabled={isReporting}>
              <Check className="h-4 w-4" />
              {isReporting ? "Sending..." : "Report"}
            </Button>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            A report does not automatically block a number. Add it to Blocked numbers when you want
            an immediate device-local block.
          </p>
        </CyberCard>
      </div>
    </div>
  );
}