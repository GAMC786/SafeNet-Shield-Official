import { useMemo, useState } from "react";
import { Loader2, ListFilter, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CyberCard } from "@/components/CyberCard";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useVpnProxyBrowserBlocker } from "@/hooks/use-vpn-proxy-browser-blocker";
import type { VpnProxyBrowserApp } from "@/hooks/use-vpn-proxy-browser-blocker";

export function VpnProxyBrowserBlocker() {
  const blocker = useVpnProxyBrowserBlocker();
  const { toast } = useToast();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [apps, setApps] = useState<VpnProxyBrowserApp[]>([]);
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [isLoadingApps, setIsLoadingApps] = useState(false);

  const stateLabel = !blocker.supported
    ? "ANDROID ONLY"
    : blocker.status.active
      ? "ACTIVE"
      : blocker.status.enabled
        ? "SETUP REQUIRED"
        : "OFF";
  const stateClassName = blocker.status.active
    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
    : blocker.status.enabled
      ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
      : "border-white/15 bg-white/5 text-muted-foreground";

  const filteredApps = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return apps;
    return apps.filter((app) =>
      app.displayName.toLowerCase().includes(query)
      || app.packageName.toLowerCase().includes(query),
    );
  }, [apps, search]);

  const openChooser = async () => {
    if (!blocker.supported || isLoadingApps) return;
    setIsLoadingApps(true);
    try {
      const current = await blocker.refresh();
      const installedApps = await blocker.getLaunchableApps();
      setSelectedPackages(current.blockedPackages);
      setApps(installedApps);
      setSearch("");
      setChooserOpen(true);
    } catch (error) {
      toast({
        title: "Could not load installed apps",
        description: error instanceof Error ? error.message : "Try again on your Android device.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingApps(false);
    }
  };

  const handleEnabledChange = async (enabled: boolean) => {
    try {
      const next = await blocker.setEnabled(enabled);
      if (enabled && next.blockedPackages.length === 0) {
        await openChooser();
      }
    } catch (error) {
      toast({
        title: "The launch blocker could not be updated",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const saveSelectedApps = async () => {
    try {
      const next = await blocker.setBlockedPackages(selectedPackages);
      setSelectedPackages(next.blockedPackages);
      setChooserOpen(false);
      toast({
        title: "Blocked apps saved",
        description: next.blockedPackages.length
          ? `${next.blockedPackages.length} app${next.blockedPackages.length === 1 ? "" : "s"} selected on this device.`
          : "No apps are selected for blocking.",
      });
    } catch (error) {
      toast({
        title: "Blocked apps could not be saved",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const openAccessibilitySettings = async () => {
    try {
      await blocker.openAccessibilitySettings();
    } catch (error) {
      toast({
        title: "Accessibility Settings could not be opened",
        description: error instanceof Error ? error.message : "Open Android Settings and enable SafeNet's Accessibility Service.",
        variant: "destructive",
      });
    }
  };

  return (
    <CyberCard className="col-span-1 border-amber-400/20 bg-amber-400/[0.025] sm:col-span-2">
      <div className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-200">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-sm font-bold uppercase tracking-wider text-white">
                  VPN &amp; Proxy Browser Blocker
                </h3>
                <Badge variant="outline" className={`text-[10px] font-bold tracking-wider ${stateClassName}`}>
                  {stateLabel}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Stop selected VPN and proxy apps from opening on this Android device.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-lg border border-white/10 bg-background/30 px-3 py-2">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Block launches</span>
            <Switch
              checked={blocker.status.enabled}
              onCheckedChange={(enabled) => void handleEnabledChange(enabled)}
              disabled={!blocker.supported || blocker.isBusy}
              aria-label="VPN and proxy browser blocker"
              data-testid="switch-vpn-proxy-browser-blocker"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground" role="status">
              {blocker.status.message}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground/80">
              App selection is stored on this device. SafeNet returns selected launches to Android Home; the Accessibility opt-in can be disabled in Android Settings, and this does not inspect or stop traffic inside encrypted VPN or proxy tunnels.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void openChooser()}
              disabled={!blocker.supported || isLoadingApps}
              className="border-white/15"
            >
              {isLoadingApps
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                : <ListFilter className="mr-2 h-4 w-4" aria-hidden="true" />}
              Choose apps ({blocker.status.blockedPackages.length})
            </Button>
            {blocker.supported
              && blocker.status.enabled
              && !blocker.status.accessibilityServiceEnabled && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void openAccessibilitySettings()}
                >
                  Enable Accessibility
                </Button>
              )}
          </div>
        </div>

        {chooserOpen && (
          <section
            aria-label="Choose apps to block"
            className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-white">Choose installed apps</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Select only the VPN or proxy apps you want SafeNet to block.
                </p>
              </div>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search apps"
                aria-label="Search installed apps"
                className="h-9 rounded-md border border-white/10 bg-slate-950 px-3 text-sm text-white placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 sm:w-64"
              />
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-white/5 p-2">
              {filteredApps.length ? filteredApps.map((app) => {
                const checked = selectedPackages.includes(app.packageName);
                return (
                  <label
                    key={app.packageName}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setSelectedPackages((current) => event.target.checked
                          ? Array.from(new Set([...current, app.packageName]))
                          : current.filter((packageName) => packageName !== app.packageName));
                      }}
                      className="h-4 w-4 accent-amber-400"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-white">{app.displayName}</span>
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">{app.packageName}</span>
                    </span>
                  </label>
                );
              }) : (
                <p className="p-3 text-sm text-muted-foreground">
                  {apps.length ? "No installed apps match this search." : "No launchable apps were found."}
                </p>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setChooserOpen(false)}
                disabled={blocker.isBusy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void saveSelectedApps()}
                disabled={blocker.isBusy}
              >
                {blocker.isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Save selected apps
              </Button>
            </div>
          </section>
        )}
      </div>
    </CyberCard>
  );
}