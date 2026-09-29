import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Radio, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CyberCard } from "@/components/CyberCard";
import { Switch } from "@/components/ui/switch";
import { WindscribeEulaDialog } from "@/components/WindscribeEulaDialog";
import { useWindscribeVpn, useWindscribeWireGuardFallback } from "@/hooks/use-windscribe";
import type { WindscribeCredentialInput, WindscribeVpnStatus } from "@/hooks/use-windscribe";
import type { DnsServer } from "@shared/schema";

const WINDSCRIBE_EULA_STORAGE_KEY = "safenet-windscribe-eula-version";
const WINDSCRIBE_EULA_VERSION = "2018-01-04";

function hasAcceptedWindscribeEula() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WINDSCRIBE_EULA_STORAGE_KEY) === WINDSCRIBE_EULA_VERSION;
  } catch {
    return false;
  }
}

type WindscribeTileWindow = Window & {
  __safenetWindscribeTileTogglePending?: boolean;
};

export function WindscribeVpnCard({ activeDns }: { activeDns?: DnsServer }) {
  const sdnsSelected = activeDns?.type === "sdns";
  const resolverStamp = sdnsSelected ? activeDns.primaryAddress : null;
  const vpn = useWindscribeVpn(resolverStamp);
  const wireGuardFallback = useWindscribeWireGuardFallback(resolverStamp);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [serverHost, setServerHost] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [windscribeEulaAccepted, setWindscribeEulaAccepted] = useState(hasAcceptedWindscribeEula);
  const [windscribeEulaOpen, setWindscribeEulaOpen] = useState(false);
  const pendingConnectAfterEula = useRef(false);
  const status = vpn.status;
  const wireGuardStatus = wireGuardFallback.status;
  const credentialsConfigured =
    status?.credentialsConfigured === true || status?.profileImported === true;
  const connected = status?.connected === true;
  const connecting = status?.connecting === true;
  const wireGuardProfileImported = wireGuardStatus?.profileImported === true;
  const wireGuardConnected = wireGuardStatus?.connected === true;
  const sdnsApplied = status?.sdnsApplied === true;
  const sdnsError = status?.sdnsError ?? status?.dnsError;

  const perform = useCallback(
    async (action: () => Promise<WindscribeVpnStatus>) => {
      setActionError(null);
      setActionPending(true);
      try {
        const nextStatus = await action();
        if (nextStatus.error) setActionError(nextStatus.error);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Windscribe VPN action failed.");
      } finally {
        setActionPending(false);
      }
    },
    [],
  );

  const toggleVpn = useCallback(() => {
    if (actionPending) return;
    if (!credentialsConfigured) {
      setActionError("Save your generated Windscribe IKEv2 credentials before connecting.");
      return;
    }
    if (connected) {
      void perform(vpn.disconnect);
      return;
    }
    if (!windscribeEulaAccepted) {
      pendingConnectAfterEula.current = true;
      setWindscribeEulaOpen(true);
      return;
    }
    void perform(vpn.connect);
  }, [actionPending, connected, credentialsConfigured, perform, vpn.connect, vpn.disconnect, windscribeEulaAccepted]);

  const acceptWindscribeEula = useCallback(() => {
    const shouldConnect = pendingConnectAfterEula.current;
    pendingConnectAfterEula.current = false;
    try {
      window.localStorage.setItem(WINDSCRIBE_EULA_STORAGE_KEY, WINDSCRIBE_EULA_VERSION);
    } catch {
      setActionError("Could not save Windscribe EULA acceptance. The VPN connection was not started.");
      setWindscribeEulaOpen(false);
      return;
    }
    setWindscribeEulaAccepted(true);
    setWindscribeEulaOpen(false);
    if (shouldConnect) void perform(vpn.connect);
  }, [perform, vpn.connect]);

  const handleWindscribeEulaOpenChange = useCallback((open: boolean) => {
    setWindscribeEulaOpen(open);
    if (!open) pendingConnectAfterEula.current = false;
  }, []);

  useEffect(() => {
    if (!vpn.isAndroid) return;
    const tileWindow = window as WindscribeTileWindow;
    const consumeTileToggle = () => {
      tileWindow.__safenetWindscribeTileTogglePending = false;
      toggleVpn();
    };
    window.addEventListener("safenet:windscribe-tile-toggle", consumeTileToggle);
    if (tileWindow.__safenetWindscribeTileTogglePending) consumeTileToggle();
    return () => {
      window.removeEventListener("safenet:windscribe-tile-toggle", consumeTileToggle);
    };
  }, [toggleVpn, vpn.isAndroid]);

  const statusLabel = !vpn.isAndroid
    ? "Android only"
    : vpn.isLoading
      ? "Checking"
      : status?.connected
        ? "Connected"
        : connecting
          ? "Connecting"
          : credentialsConfigured
          ? "Disconnected"
          : "Credentials required";
  const statusClass = connected
    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
    : "border-white/15 bg-white/5 text-muted-foreground";

  const saveCredentials = () => {
    const credentials: WindscribeCredentialInput = { serverHost, username, password };
    void perform(async () => {
      const nextStatus = await vpn.saveCredentials(credentials);
      if (!nextStatus.error) {
        setServerHost("");
        setUsername("");
        setPassword("");
      }
      return nextStatus;
    });
  };

  const removeProfile = () => {
    if (!window.confirm("Remove the encrypted Windscribe IKEv2 credentials from this device?")) return;
    void perform(vpn.removeProfile);
  };

  const toggleWireGuardFallback = () => {
    if (actionPending) return;
    if (connected || connecting) {
      setActionError("Disconnect Windscribe IKEv2 before using the WireGuard fallback.");
      return;
    }
    if (!wireGuardProfileImported) {
      setActionError("Import a Windscribe WireGuard profile before connecting the fallback.");
      return;
    }
    void perform(wireGuardConnected ? wireGuardFallback.disconnect : wireGuardFallback.connect);
  };

  const removeWireGuardFallback = () => {
    if (!window.confirm("Remove the saved legacy WireGuard profile from this device?")) return;
    void perform(wireGuardFallback.removeProfile);
  };

  return (
    <CyberCard className="flex min-h-[104px] w-full items-center">
      <WindscribeEulaDialog
        open={windscribeEulaOpen}
        onOpenChange={handleWindscribeEulaOpenChange}
        onAccept={acceptWindscribeEula}
        onCancel={() => handleWindscribeEulaOpenChange(false)}
      />
      <div className="w-full space-y-4 rounded-lg border border-white/10 bg-background/30 px-3 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Radio className="h-4 w-4 shrink-0 text-primary" />
                <p className="min-w-0 text-sm font-medium text-foreground">Windscribe IKEv2 with Control D</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => void vpn.refresh()}
                disabled={!vpn.isAndroid || vpn.isFetching}
                aria-label="Refresh Windscribe VPN status"
                data-testid="button-refresh-windscribe"
              >
                <RefreshCw className={`h-4 w-4 ${vpn.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter the IKEv2 hostname and credentials generated in Windscribe. SafeNet stores them encrypted on this device and does not upload them to SafeNet servers.
            </p>
          </div>
          <Badge
            variant="outline"
            className={`w-fit gap-1.5 px-2 text-[10px] font-bold uppercase tracking-wider ${statusClass}`}
            aria-label={`Windscribe VPN: ${statusLabel}`}
            data-testid="windscribe-vpn-status"
          >
            {statusLabel}
          </Badge>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-3">
          <p
            className="rounded-md border border-orange-400/20 bg-orange-400/5 px-3 py-2 text-xs text-orange-100/90"
            role="status"
            data-testid="windscribe-firewall-verification"
          >
            SafeNet DNS rules apply to cleartext UDP/TCP port 53 only. IKEv2 tunnel enforcement still needs a real Android device test; HTTPS, DoH, and DoT are not inspected.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">On-device IKEv2 credentials</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Use the server hostname, username, and password generated for IKEv2 by Windscribe.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                checked={connected}
                onCheckedChange={toggleVpn}
                disabled={
                  !vpn.isAndroid
                  || status?.supported === false
                  || !credentialsConfigured
                  || actionPending
                }
                aria-label={`Windscribe VPN ${statusLabel}`}
                data-testid="switch-windscribe-vpn"
              />
            </div>
          </div>

          <form
            className="space-y-3"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              saveCredentials();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Windscribe IKEv2 credentials">
              <label className="min-w-0 space-y-1 text-xs font-medium text-foreground">
                Server hostname
                <input
                  type="text"
                  name="safenet-windscribe-ike-host"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={253}
                  value={serverHost}
                  onChange={(event) => setServerHost(event.target.value)}
                  placeholder="server.example.com"
                  className="h-10 w-full rounded-md border border-white/15 bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  disabled={!vpn.isAndroid || status?.supported === false || actionPending || connected || connecting}
                  data-testid="input-windscribe-ike-host"
                />
              </label>
              <label className="min-w-0 space-y-1 text-xs font-medium text-foreground">
                IKEv2 username
                <input
                  type="text"
                  name="safenet-windscribe-ike-username"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={512}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Generated username"
                  className="h-10 w-full rounded-md border border-white/15 bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  disabled={!vpn.isAndroid || status?.supported === false || actionPending || connected || connecting}
                  data-testid="input-windscribe-ike-username"
                />
              </label>
              <label className="min-w-0 space-y-1 text-xs font-medium text-foreground">
                IKEv2 password
                <input
                  type="password"
                  name="safenet-windscribe-ike-password"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={512}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Generated password"
                  className="h-10 w-full rounded-md border border-white/15 bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  disabled={!vpn.isAndroid || status?.supported === false || actionPending || connected || connecting}
                  data-testid="input-windscribe-ike-password"
                />
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Credentials are passed directly to Android's encrypted store and kept out of browser storage.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={
                  !vpn.isAndroid
                  || status?.supported === false
                  || actionPending
                  || connected
                  || connecting
                  || !serverHost.trim()
                  || !username.trim()
                  || !password
                }
                data-testid="button-save-windscribe-credentials"
              >
                {credentialsConfigured ? "Replace credentials" : "Save credentials"}
              </Button>
              <a
                href="https://windscribe.com/terms/eula"
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 px-2 text-xs text-primary underline underline-offset-2"
                data-testid="link-windscribe-eula"
              >
                Windscribe EULA
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              {credentialsConfigured && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={removeProfile}
                  disabled={actionPending}
                  className="ml-auto text-muted-foreground hover:text-red-300"
                  data-testid="button-remove-windscribe-credentials"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remove credentials
                </Button>
              )}
            </div>
          </form>
          <details
            className="rounded-md border border-white/10 bg-background/20 px-3 py-2"
            data-testid="legacy-windscribe-wireguard-fallback"
          >
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Existing WireGuard profile fallback
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Keep using the previous tunnel while IKEv2 device verification is pending. Only one Android VPN can carry traffic at a time.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                  {wireGuardFallback.isLoading
                    ? "Checking"
                    : wireGuardConnected
                      ? "Connected"
                      : wireGuardProfileImported
                        ? "Disconnected"
                        : "Profile required"}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void perform(wireGuardFallback.importProfile)}
                  disabled={
                    !vpn.isAndroid
                    || wireGuardStatus?.supported === false
                    || actionPending
                    || connected
                    || connecting
                  }
                  data-testid="button-import-windscribe-wireguard-fallback"
                >
                  Import WireGuard profile
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleWireGuardFallback}
                  disabled={
                    !vpn.isAndroid
                    || wireGuardStatus?.supported === false
                    || !wireGuardProfileImported
                    || actionPending
                    || connected
                    || connecting
                  }
                  data-testid="button-toggle-windscribe-wireguard-fallback"
                >
                  {wireGuardConnected ? "Disconnect fallback" : "Connect fallback"}
                </Button>
                <a
                  href="https://windscribe.com/getconfig/wireguard"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 items-center gap-1.5 px-2 text-xs text-primary underline underline-offset-2"
                  data-testid="link-windscribe-wireguard-profile-generator"
                >
                  Generate a profile
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {wireGuardProfileImported && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={removeWireGuardFallback}
                    disabled={actionPending || wireGuardConnected}
                    className="text-muted-foreground hover:text-red-300"
                    data-testid="button-remove-windscribe-wireguard-fallback"
                  >
                    Remove fallback
                  </Button>
                )}
              </div>
              {(wireGuardStatus?.error || wireGuardFallback.error) && (
                <p className="text-xs text-red-300" role="alert">
                  {wireGuardStatus?.error
                    ?? (wireGuardFallback.error instanceof Error
                      ? wireGuardFallback.error.message
                      : "The WireGuard fallback status is unavailable.")}
                </p>
              )}
            </div>
          </details>
        </div>
        {sdnsSelected && (
          <div
            className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs"
            data-testid="windscribe-sdns-status"
          >
            <p className="font-medium text-foreground">
              SDNS resolver: {activeDns.name}
            </p>
            <p className={sdnsError ? "mt-1 text-red-300" : "mt-1 text-muted-foreground"}>
              {sdnsError
                ?? (sdnsApplied
                  ? "Applied inside the Windscribe tunnel."
                  : "Waiting for the Windscribe tunnel to apply this resolver.")}
            </p>
          </div>
        )}

        {(actionError || vpn.error || status?.error) && (
          <p className="text-xs text-red-300" role="alert" data-testid="windscribe-action-error">
            {actionError
              ?? status?.error
              ?? (vpn.error instanceof Error ? vpn.error.message : "Windscribe VPN status is unavailable.")}
          </p>
        )}
      </div>
    </CyberCard>
  );
}