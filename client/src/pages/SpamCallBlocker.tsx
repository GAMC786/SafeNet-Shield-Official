import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, LockKeyhole, PhoneCall, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useCallScreening } from "@/hooks/use-vpn";
import { apiFetch } from "@/lib/api";
import { Capacitor } from "@capacitor/core";
import { useToast } from "@/hooks/use-toast";

type ReputationAvailability = {
  status: "configured" | "unavailable";
  failOpen: true;
  source: string;
  provider: "approved-source" | "callshield";
  reportingAvailable: boolean;
  reason: string;
};

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
  const [browserEnabled, setBrowserEnabled] = usePersistentState(
    "safenet-spam-call-enabled",
    false,
  );
  const [reputationAvailability, setReputationAvailability] = useState<ReputationAvailability | null>(null);

  const syncConfig = native.syncConfig;
  useEffect(() => {
    void syncConfig(blockedNumbers).catch(() => undefined);
  }, [blockedNumbers, syncConfig]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/spam-call-blocker/reputation/status", {
      cache: "no-store",
      timeoutMs: 5000,
    })
      .then(async (response) => {
        const result = await response.json() as Partial<ReputationAvailability>;
        if (!response.ok || (result.status !== "configured" && result.status !== "unavailable")) {
          throw new Error("The reputation source availability could not be checked.");
        }
        if (!cancelled) {
          setReputationAvailability({
            status: result.status,
            failOpen: true,
            source: typeof result.source === "string" ? result.source : "SafeNet approved source",
            provider: result.provider === "callshield"
              ? result.provider
              : "approved-source",
            reportingAvailable: result.reportingAvailable !== false,
            reason: typeof result.reason === "string"
              ? result.reason
              : "The reputation source availability could not be confirmed.",
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setReputationAvailability({
            status: "unavailable",
            failOpen: true,
            source: "SafeNet approved source",
            provider: "approved-source",
            reportingAvailable: false,
            reason: error instanceof Error
              ? error.message
              : "The reputation source availability could not be checked.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
  const protectionEnabled = isAndroid ? enabled : browserEnabled;
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
        action={(
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {protectionEnabled ? "On" : "Off"}
            </span>
            <Switch
              checked={protectionEnabled}
              onCheckedChange={(nextEnabled) => {
                const update = async () => {
                  if (!isAndroid) {
                    setBrowserEnabled(nextEnabled);
                    toast({
                      title: `Spam call blocker ${nextEnabled ? "on" : "off"}`,
                      description: "This Preview toggle is saved on this browser. Android uses its native call-screening setting.",
                    });
                    return;
                  }

                  try {
                    if (nextEnabled && !native.status?.roleHeld) {
                      if (!native.status?.roleAvailable) {
                        toast({
                          title: "Call screening is unavailable",
                          description: "This Android version does not expose the call-screening role.",
                          variant: "destructive",
                        });
                        return;
                      }
                      const roleStatus = await native.requestRole();
                      if (!roleStatus?.roleHeld) {
                        toast({
                          title: "Call screening remains off",
                          description: "Grant SafeNet call-screening access in Android settings to turn it on.",
                          variant: "destructive",
                        });
                        return;
                      }
                    }

                    await native.setEnabled(nextEnabled);
                  } catch (error) {
                    toast({
                      title: `Could not turn ${nextEnabled ? "on" : "off"} call screening`,
                      description: error instanceof Error ? error.message : "Try again.",
                      variant: "destructive",
                    });
                  }
                };
                void update();
              }}
              disabled={native.isBusy || (isAndroid && native.status === null)}
              aria-label={`Turn spam call blocker ${protectionEnabled ? "off" : "on"}`}
            />
          </div>
        )}
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
              <span>Check the privacy-first CallShield community feed and local reports.</span>
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
          <div className="mt-4 flex flex-wrap gap-2" role="status" aria-live="polite">
            <Badge
              variant="outline"
              className={reputationAvailability?.status === "configured"
                ? "border-green-400/40 text-green-300"
                : reputationAvailability?.status === "unavailable"
                  ? "border-yellow-300/40 text-yellow-200"
                  : "text-muted-foreground"}
            >
              {reputationAvailability
                ? reputationAvailability.status === "configured"
                  ? `${reputationAvailability.source} configured`
                  : "Reputation unavailable"
                : "Checking reputation source"}
            </Badge>
            <Badge variant="outline" className="border-primary/40 text-primary">
              Fail-open protection
            </Badge>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {reputationAvailability?.reason ?? "Checking whether the CallShield community feed is available."}
            {" "}
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
              <p className="text-xs text-muted-foreground">Send a caller number to the CallShield community database.</p>
            </div>
          </div>
          {reputationAvailability?.provider === "callshield" &&
          reputationAvailability.reportingAvailable ? (
            <>
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
                Reports are sent only when you submit this form. Add the number to Blocked numbers when
                you want an immediate device-local block.
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Add the number to Blocked numbers for immediate device-local protection.
            </p>
          )}
        </CyberCard>
      </div>
    </div>
  );
}