import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Radio, RefreshCw, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CyberCard } from "@/components/CyberCard";
import { Switch } from "@/components/ui/switch";
import { WindscribeEulaDialog } from "@/components/WindscribeEulaDialog";
import { useWindscribeVpn } from "@/hooks/use-windscribe";
import type { WindscribeVpnStatus } from "@/hooks/use-windscribe";

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

export function WindscribeVpnCard() {
  const vpn = useWindscribeVpn();
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [windscribeEulaAccepted, setWindscribeEulaAccepted] = useState(hasAcceptedWindscribeEula);
  const [windscribeEulaOpen, setWindscribeEulaOpen] = useState(false);
  const pendingConnectAfterEula = useRef(false);
  const status = vpn.status;
  const profileImported = status?.profileImported === true;
  const connected = status?.connected === true;

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
    if (!profileImported) {
      setActionError("Import a Windscribe WireGuard profile before connecting.");
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
  }, [actionPending, connected, perform, profileImported, vpn.connect, vpn.disconnect, windscribeEulaAccepted]);

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
        : status?.profileImported
          ? "Disconnected"
          : "Profile required";
  const statusClass = connected
    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
    : "border-white/15 bg-white/5 text-muted-foreground";

  const removeProfile = () => {
    if (!window.confirm("Remove the saved Windscribe profile from this device?")) return;
    void perform(vpn.removeProfile);
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
                <p className="min-w-0 text-sm font-medium text-foreground">Windscribe VPN</p>
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
              Import a WireGuard profile generated in your Windscribe account. Your profile and private key stay encrypted on this device and are never uploaded to SafeNet.
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">On-device WireGuard profile</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Manual profiles require a Windscribe paid plan and do not include all features of the Windscribe app, such as its firewall and split tunneling.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                checked={connected}
                onCheckedChange={toggleVpn}
                disabled={
                  !vpn.isAndroid
                  || status?.supported === false
                  || !profileImported
                  || actionPending
                }
                aria-label={`Windscribe VPN ${statusLabel}`}
                data-testid="switch-windscribe-vpn"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void perform(vpn.importProfile)}
              disabled={!vpn.isAndroid || status?.supported === false || actionPending}
              data-testid="button-import-windscribe-profile"
            >
              <Upload className="mr-2 h-3.5 w-3.5" />
              {profileImported ? "Replace profile" : "Import profile"}
            </Button>
            <a
              href="https://windscribe.com/getconfig/wireguard"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 px-2 text-xs text-primary underline underline-offset-2"
              data-testid="link-windscribe-profile-generator"
            >
              Generate a profile
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
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
            {profileImported && (
              <Button
                variant="ghost"
                size="sm"
                onClick={removeProfile}
                disabled={actionPending}
                className="ml-auto text-muted-foreground hover:text-red-300"
                data-testid="button-remove-windscribe-profile"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Remove
              </Button>
            )}
          </div>
        </div>

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