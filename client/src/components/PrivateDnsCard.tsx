import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { Globe2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CyberCard } from "@/components/CyberCard";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PrivateDnsEulaDialog } from "@/components/PrivateDnsEulaDialog";
import { usePrivateDns, SAFE_NET_PRIVATE_DNS_EULA_VERSION } from "@/hooks/use-private-dns";
import { useDnsServers } from "@/hooks/use-dns";
import { usePersistentState } from "@/hooks/use-persistent-state";
import type { DnsServer } from "@shared/schema";

export function PrivateDnsCard() {
  const { isLoaded: authLoaded, isSignedIn } = useUser();
  const { data: dnsServers } = useDnsServers();
  const activeDns = dnsServers?.find((server) => server.isActive);
  const [nextDnsProfileId, setNextDnsProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!authLoaded || !isSignedIn) {
      setNextDnsProfileId(null);
      return;
    }
    void fetch("/api/nextdns/connection")
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => setNextDnsProfileId(result?.connected ? result.profileId : null))
      .catch(() => setNextDnsProfileId(null));
  }, [authLoaded, isSignedIn]);
  const selectedResolver = nextDnsProfileId
    ? ({
        id: -1,
        name: `NextDNS profile ${nextDnsProfileId}`,
        type: "dot",
        primaryAddress: `${nextDnsProfileId}.dns.nextdns.io`,
      } as DnsServer)
    : activeDns;
  const privateDns = usePrivateDns(selectedResolver);
  const [message, setMessage] = useState<string | null>(null);
  const [eulaOpen, setEulaOpen] = useState(false);
  const [acceptedEulaVersion, setAcceptedEulaVersion] = usePersistentState<string | null>(
    "safenet-private-dns-eula-version",
    null,
  );

  const enablePrivateDns = async () => {
    setMessage(null);
    if (!privateDns.expectedHostname) {
      setMessage("Choose a DNS server with a hostname supported by Android Private DNS.");
      return;
    }
    try {
      const result = privateDns.status?.oneTapAvailable
        ? await privateDns.applyOneTap()
        : await privateDns.openSettings();
      setMessage(result?.message ?? `Select ${privateDns.expectedHostname} in Android Private DNS settings.`);
    } catch {
      setMessage(`Open Android Private DNS settings and select ${privateDns.expectedHostname}.`);
    }
  };

  const handleToggle = (enabled: boolean) => {
    setMessage(null);
    if (enabled) {
      if (!privateDns.expectedHostname) {
        setMessage("Choose a DNS server with a hostname supported by Android Private DNS.");
        return;
      }
      if (acceptedEulaVersion !== SAFE_NET_PRIVATE_DNS_EULA_VERSION) {
        setEulaOpen(true);
        return;
      }
      void enablePrivateDns();
      return;
    }

    // Ordinary Android apps cannot change the protected system Private DNS
    // setting. Hand control to Android settings and let the switch mirror the
    // actual system state when the user returns.
    void privateDns.openSettings().then((result) => {
      setMessage(result?.message ?? "Use Android Private DNS settings to turn off SafeNet's provider.");
    }).catch(() => {
      setMessage("Android Private DNS settings could not be opened.");
    });
  };

  const acceptEula = () => {
    setAcceptedEulaVersion(SAFE_NET_PRIVATE_DNS_EULA_VERSION);
    setEulaOpen(false);
    void enablePrivateDns();
  };

  const statusText = !privateDns.supported
    ? "Available in the SafeNet Android app."
    : privateDns.isBusy
      ? "Opening Android Private DNS settings…"
      : privateDns.status?.running
        ? "SafeNet Private DNS is active on this phone."
        : privateDns.expectedHostname
          ? "Off · switch on to configure Android Private DNS."
          : "Select a compatible DNS server to enable protection.";

  const badgeText = !privateDns.supported
    ? "Android only"
    : privateDns.status?.running
      ? "Protected"
      : privateDns.status?.mode === "unknown"
        ? "Checking"
        : "Off";

  return (
    <CyberCard className="w-full">
      <PrivateDnsEulaDialog
        open={eulaOpen}
        onOpenChange={setEulaOpen}
        onAccept={acceptEula}
        onCancel={() => setEulaOpen(false)}
      />
      <div className="space-y-4 rounded-lg border border-white/10 bg-background/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-primary" />
              SafeNet Private DNS
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Uses Android&apos;s built-in encrypted DNS setting. No local VPN or VPN server is used.
            </p>
          </div>
          <Badge variant="outline">{badgeText}</Badge>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-background/30 p-3">
          <div className="space-y-1">
            <Label htmlFor="private-dns-protection" className="cursor-pointer">
              Protect this phone
            </Label>
            <p id="private-dns-protection-status" aria-live="polite" className="text-xs text-muted-foreground">
              {statusText}
            </p>
          </div>
          <Switch
            id="private-dns-protection"
            aria-describedby="private-dns-protection-status"
            aria-label="SafeNet Private DNS"
            checked={privateDns.status?.running === true}
            disabled={!privateDns.supported || privateDns.isBusy || privateDns.status?.mode === "unknown"}
            onCheckedChange={handleToggle}
            data-testid="switch-private-dns-protection"
          />
        </div>

        {privateDns.supported && (
          <Button
            disabled={privateDns.isBusy}
            variant="outline"
            size="sm"
            onClick={() => void privateDns.openSettings()}
          >
            <Globe2 className="mr-2 h-4 w-4" />
            Open Android Private DNS settings
          </Button>
        )}

        {(privateDns.status?.error || message) && (
          <p role="status" className="text-xs text-destructive">
            {privateDns.status?.error ?? message}
          </p>
        )}

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Selected DNS server: {selectedResolver?.name ?? "No active DNS server selected"}</p>
          {privateDns.expectedHostname && (
            <p>Android Private DNS hostname: {privateDns.expectedHostname}</p>
          )}
          {activeDns?.type === "sdns" && (
            <p>Android Private DNS requires a DNS-over-TLS hostname; SDNS stamps cannot be used directly.</p>
          )}
          <p>
            Android protects this system setting. Without optional privileged access, the switch opens Android
            settings and reflects the provider state after you return. Apps using their own encrypted DNS or
            another VPN may bypass it.
          </p>
        </div>
      </div>
    </CyberCard>
  );
}
