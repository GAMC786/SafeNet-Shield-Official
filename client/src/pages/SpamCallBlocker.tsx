import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, LockKeyhole, MessageSquareText, PhoneCall, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Header } from "@/components/Header";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useCallScreening } from "@/hooks/use-vpn";
import { useSmsFilter } from "@/hooks/use-sms-filter";
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

function isSafeSmsRegex(value: string) {
  if (
    !value.trim() ||
    value.length > 100 ||
    /[()|]/.test(value) ||
    /\\[1-9]/.test(value)
  ) {
    return false;
  }
  if ((value.match(/[+*?{]/g) ?? []).length > 1) return false;
  try {
    new RegExp(value, "i");
    return true;
  } catch {
    return false;
  }
}

export default function SpamCallBlocker() {
  const native = useCallScreening();
  const sms = useSmsFilter();
  const { toast } = useToast();
  const isAndroid = Capacitor.getPlatform() === "android";
  const [blockedNumbers, setBlockedNumbers] = usePersistentState<string[]>(
    "safenet-spam-call-blocked-numbers",
    [],
  );
  const [number, setNumber, clearNumber] = usePersistentState(
    "safenet-spam-call-number-draft",
    "",
  );
  const [reportNumber, setReportNumber, clearReportNumber] = usePersistentState(
    "safenet-spam-call-report-number-draft",
    "",
  );
  const [isReporting, setIsReporting] = useState(false);
  const [browserEnabled, setBrowserEnabled] = usePersistentState(
    "safenet-spam-call-enabled",
    false,
  );
  const [reputationAvailability, setReputationAvailability] = useState<ReputationAvailability | null>(null);
  const [smsKeywords, setSmsKeywords] = usePersistentState<string[]>(
    "safenet-sms-filter-keywords",
    [],
  );
  const [smsKeywordDraft, setSmsKeywordDraft, clearSmsKeywordDraft] = usePersistentState(
    "safenet-sms-filter-keyword-draft",
    "",
  );
  const [smsRegexes, setSmsRegexes] = usePersistentState<string[]>(
    "safenet-sms-filter-regexes",
    [],
  );
  const [smsRegexDraft, setSmsRegexDraft, clearSmsRegexDraft] = usePersistentState(
    "safenet-sms-filter-regex-draft",
    "",
  );
  const [smsAllowedSenders, setSmsAllowedSenders] = usePersistentState<string[]>(
    "safenet-sms-filter-allowed-senders",
    [],
  );
  const [smsAllowedSenderDraft, setSmsAllowedSenderDraft, clearSmsAllowedSenderDraft] = usePersistentState(
    "safenet-sms-filter-allowed-sender-draft",
    "",
  );
  const [smsRecipient, setSmsRecipient] = useState("");
  const [smsBody, setSmsBody] = useState("");

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

  useEffect(() => {
    if (!isAndroid) return;
    void sms.syncRules({
      keywords: smsKeywords,
      regexes: smsRegexes,
      allowedSenders: smsAllowedSenders,
    }).catch((error) => {
      toast({
        title: "SMS rules could not be synced",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    });
  }, [isAndroid, smsAllowedSenders, sms.syncRules, smsKeywords, smsRegexes, toast]);

  useEffect(() => {
    type SmsComposeWindow = Window & {
      __safenetPendingSmsCompose?: { recipient: string; body: string };
    };
    const targetWindow = window as SmsComposeWindow;
    const applyCompose = (recipient: string, body: string) => {
      setSmsRecipient(recipient);
      setSmsBody(body);
    };
    const pending = targetWindow.__safenetPendingSmsCompose;
    if (pending) {
      applyCompose(pending.recipient, pending.body);
      delete targetWindow.__safenetPendingSmsCompose;
    }
    const handleComposeEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ recipient: string; body: string }>).detail;
      if (detail) {
        applyCompose(detail.recipient, detail.body);
        delete targetWindow.__safenetPendingSmsCompose;
      }
    };
    window.addEventListener("safenet:sms-compose", handleComposeEvent);
    return () => window.removeEventListener("safenet:sms-compose", handleComposeEvent);
  }, []);

  const addBlockedNumber = useCallback(() => {
    const normalized = normalizePhoneNumber(number);
    if (!normalized) {
      toast({ title: "Enter a valid phone number", description: "Use at least 7 digits.", variant: "destructive" });
      return;
    }
    setBlockedNumbers((current) => current.includes(normalized) ? current : [...current, normalized]);
    clearNumber();
  }, [clearNumber, number, setBlockedNumbers, toast]);

  const removeBlockedNumber = useCallback((value: string) => {
    setBlockedNumbers((current) => current.filter((entry) => entry !== value));
  }, [setBlockedNumbers]);

  const addSmsKeyword = useCallback(() => {
    const value = smsKeywordDraft.trim();
    if (!value || value.length > 80) {
      toast({ title: "Enter a keyword", description: "Keywords can contain up to 80 characters.", variant: "destructive" });
      return;
    }
    if (smsKeywords.some((item) => item.toLowerCase() === value.toLowerCase())) {
      clearSmsKeywordDraft();
      return;
    }
    if (smsKeywords.length >= 50) {
      toast({ title: "Keyword limit reached", description: "You can add up to 50 SMS keywords.", variant: "destructive" });
      return;
    }
    setSmsKeywords((current) => current.some((item) => item.toLowerCase() === value.toLowerCase())
      ? current
      : [...current, value]);
    clearSmsKeywordDraft();
  }, [clearSmsKeywordDraft, setSmsKeywords, smsKeywordDraft, smsKeywords, toast]);

  const addSmsRegex = useCallback(() => {
    const value = smsRegexDraft.trim();
    if (!isSafeSmsRegex(value)) {
      toast({
        title: "Pattern is invalid or too complex",
        description: "Use a pattern under 100 characters with no groups or alternation and at most one repetition.",
        variant: "destructive",
      });
      return;
    }
    if (smsRegexes.includes(value)) {
      clearSmsRegexDraft();
      return;
    }
    if (smsRegexes.length >= 20) {
      toast({ title: "Pattern limit reached", description: "You can add up to 20 SMS patterns.", variant: "destructive" });
      return;
    }
    setSmsRegexes((current) => current.includes(value) ? current : [...current, value]);
    clearSmsRegexDraft();
  }, [clearSmsRegexDraft, setSmsRegexes, smsRegexDraft, smsRegexes, toast]);

  const addSmsAllowedSender = useCallback(() => {
    const value = smsAllowedSenderDraft.trim();
    if (!value || value.length > 80) {
      toast({ title: "Enter a sender", description: "Allowed senders can contain up to 80 characters.", variant: "destructive" });
      return;
    }
    if (smsAllowedSenders.some((item) => item.toLowerCase() === value.toLowerCase())) {
      clearSmsAllowedSenderDraft();
      return;
    }
    if (smsAllowedSenders.length >= 50) {
      toast({ title: "Allowed sender limit reached", description: "You can add up to 50 allowed SMS senders.", variant: "destructive" });
      return;
    }
    setSmsAllowedSenders((current) => current.some((item) => item.toLowerCase() === value.toLowerCase())
      ? current
      : [...current, value]);
    clearSmsAllowedSenderDraft();
  }, [clearSmsAllowedSenderDraft, setSmsAllowedSenders, smsAllowedSenderDraft, smsAllowedSenders, toast]);

  const enableSmsFiltering = useCallback(async () => {
    try {
      let status = sms.status ?? await sms.refresh();
      if (!status?.roleHeld) {
        status = await sms.requestDefaultSmsApp();
        if (!status?.roleHeld) {
          toast({
            title: "SafeNet is not the default SMS app",
            description: "Choose SafeNet in Android's system dialog, then return here.",
            variant: "destructive",
          });
          return;
        }
      }
      if (!status.permissionsGranted) {
        status = await sms.requestSmsPermissions();
      }
      if (!status.permissionsGranted) {
        toast({
          title: "SMS access is required",
          description: "Grant the requested Android SMS permissions to enable local filtering.",
          variant: "destructive",
        });
        return;
      }
      await sms.setEnabled(true);
      toast({
        title: "SMS filtering enabled",
        description: "Incoming texts are checked on this device and filtered messages stay in local quarantine.",
      });
    } catch (error) {
      toast({
        title: "SMS filtering could not be enabled",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  }, [sms.refresh, sms.requestDefaultSmsApp, sms.requestSmsPermissions, sms.setEnabled, sms.status, toast]);

  const handleSmsFilterToggle = useCallback((nextEnabled: boolean) => {
    if (nextEnabled) {
      void enableSmsFiltering();
      return;
    }
    void sms.setEnabled(false)
      .then(() => toast({ title: "SMS filtering turned off" }))
      .catch((error) => toast({
        title: "SMS filtering could not be turned off",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      }));
  }, [enableSmsFiltering, sms.setEnabled, toast]);

  const sendSms = useCallback(async () => {
    if (!normalizePhoneNumber(smsRecipient)) {
      toast({ title: "Enter a valid phone number", description: "Use at least 7 digits.", variant: "destructive" });
      return;
    }
    if (!smsBody.trim()) {
      toast({ title: "Enter a message", description: "SMS text cannot be empty.", variant: "destructive" });
      return;
    }
    try {
      await sms.sendMessage(smsRecipient, smsBody);
      setSmsBody("");
      toast({
        title: "SMS submitted",
        description: "Android accepted the message for sending. Carrier delivery may take a moment.",
      });
    } catch (error) {
      toast({
        title: "SMS could not be sent",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  }, [sms.sendMessage, smsBody, smsRecipient, toast]);

  const restoreSms = useCallback(async (id: string) => {
    try {
      await sms.restoreMessage(id);
      toast({ title: "Message restored", description: "The SMS was returned to the Android inbox." });
    } catch (error) {
      toast({
        title: "Message could not be restored",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  }, [sms.restoreMessage, toast]);

  const deleteSms = useCallback(async (id: string) => {
    try {
      await sms.deleteMessage(id);
      toast({ title: "Quarantined message deleted" });
    } catch (error) {
      toast({
        title: "Message could not be deleted",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  }, [sms.deleteMessage, toast]);

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
        description: result.accepted
          ? `${result.reason} This number was also added to your device-local blocklist.`
          : result.reason,
        variant: result.accepted ? "default" : "destructive",
      });
      if (result.accepted) {
        setBlockedNumbers((current) => current.includes(normalized)
          ? current
          : [...current, normalized]);
        clearReportNumber();
      }
    } catch (error) {
      toast({
        title: "Spam report not submitted",
        description: error instanceof Error ? error.message : "The reputation source is unavailable.",
        variant: "destructive",
      });
    } finally {
      setIsReporting(false);
    }
  }, [clearReportNumber, reportNumber, setBlockedNumbers, toast]);

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

  const requestNativeRole = useCallback(async () => {
    const roleStatus = await native.requestRole();
    if (!roleStatus?.roleHeld) {
      return native.openSettings();
    }
    return roleStatus;
  }, [native.openSettings, native.requestRole]);

  const explainRoleSetup = useCallback(() => {
    toast({
      title: "Choose SafeNet for call screening",
      description: "Android settings are open. Select SafeNet as the call-screening app, then return here.",
    });
  }, [toast]);

  return (
    <div className="space-y-6">
      <Header
        title="Spam Call Blocker"
        subtitle="Caller protection and screening controls"
        action={(
          <div className="flex items-center gap-2">
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
                      const roleStatus = await requestNativeRole();
                      if (!roleStatus?.roleHeld) {
                        explainRoleSetup();
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
              <Button
                className="mt-4"
                onClick={() => {
                  void requestNativeRole()
                    .then((roleStatus) => {
                      if (!roleStatus?.roleHeld) explainRoleSetup();
                    })
                    .catch((error) => {
                      toast({
                        title: "Could not open call-screening settings",
                        description: error instanceof Error
                          ? error.message
                          : "Try opening Android default-app settings manually.",
                        variant: "destructive",
                      });
                    });
                }}
                disabled={native.isBusy}
              >
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
              <span>Apply the configured allow, silence, or block decision before the call reaches you.</span>
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

      <CyberCard className="border-cyan-400/20 bg-cyan-400/[0.04]">
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <MessageSquareText className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" />
              <div>
                <h2 className="font-display font-bold text-white">Junkboy SMS Filter</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Local keyword and pattern filtering for incoming Android texts. Messages are evaluated on
                  this device; filtered texts are kept in a reviewable quarantine, not sent to SafeNet servers.
                </p>
              </div>
            </div>
            <Switch
              checked={sms.status?.enabled === true}
              disabled={!isAndroid || sms.isBusy || sms.status === null}
              onCheckedChange={handleSmsFilterToggle}
              aria-label={`Turn SMS filtering ${sms.status?.enabled ? "off" : "on"}`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
            <Badge variant={sms.status?.enabled ? "default" : "outline"}>
              {!isAndroid
                ? "Android only"
                : sms.status?.enabled
                  ? "SMS filtering active"
                  : sms.status?.roleHeld
                    ? "SafeNet is default; filtering off"
                    : sms.status?.roleAvailable
                      ? "Default SMS setup needed"
                      : "SMS role unavailable"}
            </Badge>
            {sms.status?.roleHeld && (
              <Badge variant="outline">
                {sms.status.permissionsGranted ? "SMS access granted" : "SMS permissions needed"}
              </Badge>
            )}
            <Badge variant="outline">{sms.quarantinedMessages.length} quarantined</Badge>
          </div>

          {!isAndroid && (
            <p className="text-xs text-muted-foreground">
              These rules are saved in this browser for preview. Message filtering and sending are available only in SafeNet for Android.
            </p>
          )}
          {isAndroid && sms.status && !sms.status.roleHeld && (
            <Button
              variant="outline"
              className="w-fit border-cyan-300/40 text-cyan-100 hover:bg-cyan-300/10"
              disabled={sms.isBusy || !sms.status.roleAvailable}
              onClick={() => {
                void sms.requestDefaultSmsApp()
                  .then((status) => {
                    if (status.roleHeld) {
                      toast({
                        title: "SafeNet selected as the default SMS app",
                        description: "Grant SMS access, then turn on local filtering.",
                      });
                    }
                  })
                  .catch((error) => toast({
                    title: "Default SMS app was not changed",
                    description: error instanceof Error ? error.message : "Try again.",
                    variant: "destructive",
                  }));
              }}
            >
              <MessageSquareText className="mr-2 h-4 w-4" />
              {sms.isBusy ? "Opening Android settings..." : "Set SafeNet as default SMS app"}
            </Button>
          )}
          {isAndroid && sms.status?.roleHeld && !sms.status.permissionsGranted && (
            <Button
              variant="outline"
              className="w-fit"
              disabled={sms.isBusy}
              onClick={() => {
                void sms.requestSmsPermissions()
                  .then((status) => {
                    if (status.permissionsGranted) {
                      toast({ title: "SMS access granted", description: "You can now enable filtering." });
                    }
                  })
                  .catch((error) => toast({
                    title: "SMS access was not granted",
                    description: error instanceof Error ? error.message : "Try again.",
                    variant: "destructive",
                  }));
              }}
            >
              Grant SMS access
            </Button>
          )}

          <div className="rounded-lg border border-yellow-300/20 bg-yellow-300/[0.04] p-3">
            <p className="text-xs leading-5 text-yellow-100/90">
              SafeNet’s default-handler integration currently supports SMS only. MMS photos and group messages
              are not downloaded or filtered; keep your existing messaging app as default if you rely on MMS.
              The TFLite file in Junkboy is a documented placeholder, so filtering here uses clear local rules,
              not AI classification.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <h3 className="text-sm font-semibold text-white">Block keywords</h3>
              <div className="mt-3 flex gap-2">
                <Input
                  value={smsKeywordDraft}
                  onChange={(event) => setSmsKeywordDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") addSmsKeyword(); }}
                  maxLength={80}
                  placeholder="e.g. claim your prize"
                  aria-label="SMS keyword to block"
                />
                <Button size="icon" onClick={addSmsKeyword} aria-label="Add SMS keyword">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {smsKeywords.map((keyword) => (
                  <Badge key={keyword} variant="outline" className="gap-1 border-white/15 py-1">
                    {keyword}
                    <button
                      type="button"
                      onClick={() => setSmsKeywords((current) => current.filter((item) => item !== keyword))}
                      aria-label={`Remove SMS keyword ${keyword}`}
                      className="ml-1 text-muted-foreground hover:text-white"
                    >
                      ×
                    </button>
                  </Badge>
                ))}
                {smsKeywords.length === 0 && <p className="text-xs text-muted-foreground">No custom keywords.</p>}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <h3 className="text-sm font-semibold text-white">Block patterns</h3>
              <div className="mt-3 flex gap-2">
                <Input
                  value={smsRegexDraft}
                  onChange={(event) => setSmsRegexDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") addSmsRegex(); }}
                  maxLength={100}
                  placeholder="e.g. claim\\s+your\\s+prize"
                  aria-label="SMS pattern to block"
                  className="font-mono"
                />
                <Button size="icon" onClick={addSmsRegex} aria-label="Add SMS pattern">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-3 space-y-1">
                {smsRegexes.map((pattern) => (
                  <div key={pattern} className="flex items-center justify-between gap-2 text-xs">
                    <code className="break-all text-cyan-100">{pattern}</code>
                    <button
                      type="button"
                      onClick={() => setSmsRegexes((current) => current.filter((item) => item !== pattern))}
                      aria-label={`Remove SMS pattern ${pattern}`}
                      className="shrink-0 text-muted-foreground hover:text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {smsRegexes.length === 0 && <p className="text-xs text-muted-foreground">No custom patterns.</p>}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <h3 className="text-sm font-semibold text-white">Always allow senders</h3>
              <div className="mt-3 flex gap-2">
                <Input
                  value={smsAllowedSenderDraft}
                  onChange={(event) => setSmsAllowedSenderDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") addSmsAllowedSender(); }}
                  maxLength={80}
                  placeholder="Phone number or sender name"
                  aria-label="SMS sender to always allow"
                />
                <Button size="icon" onClick={addSmsAllowedSender} aria-label="Add allowed SMS sender">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {smsAllowedSenders.map((sender) => (
                  <Badge key={sender} variant="outline" className="gap-1 border-green-300/20 py-1">
                    {sender}
                    <button
                      type="button"
                      onClick={() => setSmsAllowedSenders((current) => current.filter((item) => item !== sender))}
                      aria-label={`Remove allowed SMS sender ${sender}`}
                      className="ml-1 text-muted-foreground hover:text-white"
                    >
                      ×
                    </button>
                  </Badge>
                ))}
                {smsAllowedSenders.length === 0 && <p className="text-xs text-muted-foreground">No allowed senders.</p>}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-white">Quarantined messages</h3>
                <Badge variant="outline">{sms.quarantinedMessages.length}</Badge>
              </div>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {sms.quarantinedMessages.map((message) => (
                  <div key={String(message.id)} className="rounded-md border border-white/10 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-xs font-semibold text-white">{message.sender}</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{message.body}</p>
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          {message.reason ?? "Filtered locally"} · {new Date(message.receivedAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Restore message from ${message.sender}`}
                          title="Restore to Android inbox"
                          disabled={!sms.status?.roleHeld || !sms.status.permissionsGranted || sms.isBusy}
                          onClick={() => void restoreSms(String(message.id))}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete quarantined message from ${message.sender}`}
                          disabled={sms.isBusy}
                          onClick={() => void deleteSms(String(message.id))}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {sms.quarantinedMessages.length === 0 && (
                  <p className="text-xs text-muted-foreground">No filtered messages yet.</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <h3 className="text-sm font-semibold text-white">Send an SMS</h3>
              <div className="mt-3 space-y-2">
                <Input
                  value={smsRecipient}
                  onChange={(event) => setSmsRecipient(event.target.value)}
                  placeholder="+1 555 123 4567"
                  inputMode="tel"
                  aria-label="SMS recipient"
                />
                <textarea
                  value={smsBody}
                  onChange={(event) => setSmsBody(event.target.value)}
                  maxLength={2000}
                  placeholder="Write a text message"
                  aria-label="SMS message"
                  className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">Sent texts are saved in the Android sent folder.</p>
                  <Button
                    onClick={() => void sendSms()}
                    disabled={!isAndroid || !sms.status?.roleHeld || !sms.status.permissionsGranted || sms.isBusy}
                  >
                    {sms.isBusy ? "Sending..." : "Send SMS"}
                  </Button>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-white">Recent inbox ({sms.recentMessages.length})</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!sms.status?.roleHeld || !sms.status.permissionsGranted}
                    onClick={() => {
                      void sms.refreshRecentMessages().catch((error) => toast({
                        title: "Recent messages could not be loaded",
                        description: error instanceof Error ? error.message : "Try again.",
                        variant: "destructive",
                      }));
                    }}
                  >
                    Refresh inbox
                  </Button>
                </div>
                <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
                  {sms.recentMessages.map((message) => (
                    <div key={String(message.id)} className="rounded-md border border-white/10 p-2">
                      <p className="text-xs font-semibold text-white">{message.sender}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{message.body}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{new Date(message.receivedAt).toLocaleString()}</p>
                    </div>
                  ))}
                  {sms.recentMessages.length === 0 && (
                    <p className="text-xs text-muted-foreground">Recent messages appear here after SMS access is granted.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </CyberCard>
    </div>
  );
}