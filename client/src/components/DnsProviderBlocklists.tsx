import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

type Provider = "adguard" | "cleanbrowsing" | "nextdns" | "controld";
type ListItem = { id: string; name: string; description: string; enabled: boolean; rulesCount: number | null };
type Profile = { id: string; name: string };
type Statuses = {
  adguard: boolean;
  cleanbrowsing: boolean;
  nextdns: boolean;
  controld: boolean;
};

const providerNames: Record<Provider, string> = {
  adguard: "AdGuard DNS",
  cleanbrowsing: "CleanBrowsing",
  nextdns: "NextDNS",
  controld: "Control D",
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error((body as { message?: string } | null)?.message ?? "DNS provider request failed.");
  return body as T;
}

export function DnsProviderBlocklists() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<Provider>("adguard");
  const [controlDProfileId, setControlDProfileId] = useState("");

  const statusQuery = useQuery({
    queryKey: ["dns-provider-list-status", userId],
    enabled: isLoaded && Boolean(isSignedIn && userId),
    queryFn: async (): Promise<Statuses> => {
      const [family, nextdns, controld] = await Promise.all([
        request<{ adguard: { connected: boolean }; cleanbrowsing: { connected: boolean } }>("/api/family-dns/connections"),
        request<{ connected: boolean }>("/api/nextdns/connection"),
        request<{ connected: boolean }>("/api/control-d/connection"),
      ]);
      return {
        adguard: family.adguard.connected,
        cleanbrowsing: family.cleanbrowsing.connected,
        nextdns: nextdns.connected,
        controld: controld.connected,
      };
    },
  });

  const controlDAccountQuery = useQuery({
    queryKey: ["control-d-account", userId],
    enabled: Boolean(statusQuery.data?.controld),
    queryFn: () => request<{ profiles: Profile[] }>("/api/control-d/account"),
  });
  const availableProviders = useMemo(
    () => (Object.keys(providerNames) as Provider[]).filter((name) => statusQuery.data?.[name]),
    [statusQuery.data],
  );
  useEffect(() => {
    if (availableProviders.length && !availableProviders.includes(provider)) setProvider(availableProviders[0]!);
  }, [availableProviders, provider]);
  useEffect(() => {
    const firstProfile = controlDAccountQuery.data?.profiles[0]?.id;
    if (provider === "controld" && !controlDProfileId && firstProfile) setControlDProfileId(firstProfile);
  }, [controlDAccountQuery.data, controlDProfileId, provider]);

  const currentProfileId = provider === "controld" ? controlDProfileId : "";
  const listQuery = useQuery({
    queryKey: ["dns-provider-native-lists", userId, provider, currentProfileId],
    enabled: Boolean(userId && isSignedIn && availableProviders.includes(provider)
      && (provider !== "controld" || currentProfileId)),
    queryFn: async (): Promise<ListItem[]> => {
      if (provider === "adguard") {
        const result = await request<{ filters: Array<{ filterId: string; name: string; description: string; rulesCount: number | null; enabled: boolean }> }>("/api/family-dns/adguard/filters");
        return result.filters.map((item) => ({ id: item.filterId, name: item.name, description: item.description, rulesCount: item.rulesCount, enabled: item.enabled }));
      }
      if (provider === "cleanbrowsing") {
        return (await request<{ lists: ListItem[] }>("/api/family-dns/cleanbrowsing/categories")).lists;
      }
      if (provider === "nextdns") {
        return (await request<{ lists: ListItem[] }>("/api/nextdns/blocklists")).lists;
      }
      return (await request<{ filters: Array<{ id: string; name: string; description: string; enabled: boolean }> }>(
        `/api/control-d/profiles/${encodeURIComponent(currentProfileId)}/filters`,
      )).filters.map((item) => ({ ...item, rulesCount: null }));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ targetProvider, targetProfileId, id, enabled }: {
      targetProvider: Provider;
      targetProfileId: string;
      id: string;
      enabled: boolean;
    }) => {
      if (targetProvider === "adguard") {
        const result = await request<{ filters: Array<{ filterId: string; name: string; description: string; rulesCount: number | null; enabled: boolean }> }>(
          `/api/family-dns/adguard/filters/${encodeURIComponent(id)}`,
          { method: "PATCH", body: JSON.stringify({ enabled }) },
        );
        return result.filters.map((item) => ({ id: item.filterId, name: item.name, description: item.description, rulesCount: item.rulesCount, enabled: item.enabled }));
      }
      if (targetProvider === "cleanbrowsing") {
        return (await request<{ lists: ListItem[] }>(`/api/family-dns/cleanbrowsing/categories/${encodeURIComponent(id)}`, {
          method: "PATCH", body: JSON.stringify({ enabled }),
        })).lists;
      }
      if (targetProvider === "nextdns") {
        return (await request<{ lists: ListItem[] }>(`/api/nextdns/blocklists/${encodeURIComponent(id)}`, {
          method: "PATCH", body: JSON.stringify({ enabled }),
        })).lists;
      }
      return (await request<{ filters: Array<{ id: string; name: string; description: string; enabled: boolean }> }>(
        `/api/control-d/profiles/${encodeURIComponent(targetProfileId)}/filters/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify({ enabled }) },
      )).filters.map((item) => ({ ...item, rulesCount: null }));
    },
    onSuccess: (lists, variables) => queryClient.setQueryData(
      ["dns-provider-native-lists", userId, variables.targetProvider, variables.targetProfileId],
      lists,
    ),
    onError: (error, variables) => toast({
      title: `${providerNames[variables.targetProvider]} blocklist could not be updated`,
      description: error instanceof Error ? error.message : "Check provider permissions and try again.",
      variant: "destructive",
    }),
  });

  const syncMutation = useMutation({
    mutationFn: () => request<{ message: string }>(
      provider === "nextdns" ? "/api/nextdns/sync" : `/api/family-dns/${provider}/sync`,
      { method: "POST" },
    ),
    onSuccess: (result) => toast({ title: "SafeNet rules synced", description: result.message }),
    onError: (error) => toast({
      title: "SafeNet DNS rules could not be synced",
      description: error instanceof Error ? error.message : "Check the provider connection and try again.",
      variant: "destructive",
    }),
  });

  if (!isLoaded) return null;
  if (!isSignedIn || !userId) {
    return (
      <CyberCard className="border-emerald-400/20 bg-emerald-400/5">
        <h3 className="font-display font-bold text-white">DNS provider blocklists</h3>
        <p className="mt-1 text-xs text-muted-foreground">Sign in to manage provider-native filters and SafeNet rule sync.</p>
        <Button className="mt-3" size="sm" onClick={() => setLocation(`/sign-in?redirect_url=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`)}>Sign in</Button>
      </CyberCard>
    );
  }

  const syncSupported = provider !== "controld";
  return (
    <CyberCard className="border-emerald-400/20 bg-emerald-400/5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display font-bold text-white">DNS provider blocklists</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Manage filters in the selected provider. SafeNet firewall rule sync is a separate action and does not replace these lists.
              </p>
            </div>
            {availableProviders.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => void listQuery.refetch()} disabled={listQuery.isFetching || toggleMutation.isPending}>
                {listQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Refresh
              </Button>
            )}
          </div>

          {statusQuery.isLoading ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking provider connections…</p>
          ) : statusQuery.isError ? (
            <p role="alert" className="mt-4 text-sm text-destructive">{statusQuery.error instanceof Error ? statusQuery.error.message : "Provider connections are unavailable."}</p>
          ) : availableProviders.length === 0 ? (
            <div className="mt-4 rounded-md border border-white/10 bg-background/30 p-3">
              <p className="text-sm text-muted-foreground">No supported DNS API is connected. Connect a provider on <a href="/dns" className="text-primary underline">DNS Servers</a>.</p>
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="native-list-provider" className="text-xs font-medium text-foreground">Connected DNS provider</label>
                  <select id="native-list-provider" value={provider} onChange={(event) => setProvider(event.target.value as Provider)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                    {availableProviders.map((item) => <option value={item} key={item}>{providerNames[item]}</option>)}
                  </select>
                </div>
                {provider === "controld" && (
                  <div className="space-y-1.5">
                    <label htmlFor="control-d-filter-profile" className="text-xs font-medium text-foreground">Control D profile</label>
                    <select id="control-d-filter-profile" value={controlDProfileId} onChange={(event) => setControlDProfileId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                      {(controlDAccountQuery.data?.profiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {listQuery.isLoading ? (
                <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading {providerNames[provider]} filters…</p>
              ) : listQuery.isError ? (
                <p role="alert" className="mt-4 text-sm text-destructive">{listQuery.error instanceof Error ? listQuery.error.message : "Provider filters could not be loaded."}</p>
              ) : listQuery.data?.length ? (
                <div className="mt-3 grid gap-2">
                  {listQuery.data.map((list) => (
                    <div key={list.id} className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-background/30 p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{list.name}</p>
                        {list.description && <p className="mt-0.5 text-xs text-muted-foreground">{list.description}</p>}
                        {list.rulesCount !== null && <p className="mt-1 text-[11px] text-muted-foreground">{list.rulesCount.toLocaleString()} rules</p>}
                      </div>
                      <Switch checked={list.enabled} onCheckedChange={(enabled) => toggleMutation.mutate({
                        targetProvider: provider,
                        targetProfileId: currentProfileId,
                        id: list.id,
                        enabled,
                      })} disabled={toggleMutation.isPending} aria-label={`${list.enabled ? "Disable" : "Enable"} ${list.name}`} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">This provider has no native lists available for the selected profile.</p>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                <p className="text-xs text-muted-foreground">
                  {provider === "controld"
                    ? "Control D native filters are managed above. SafeNet rule sync is currently available for NextDNS, AdGuard DNS, and CleanBrowsing."
                    : "SafeNet rule sync updates only SafeNet-owned entries; native provider filters remain separate."}
                </p>
                {syncSupported && <Button size="sm" variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                  {syncMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sync SafeNet rules
                </Button>}
              </div>
            </>
          )}

          <p className="mt-4 border-t border-white/10 pt-3 text-xs text-muted-foreground">
            OpenDNS Home is resolver-only, and uBlockDNS has no supported account API here.
          </p>
        </div>
      </div>
    </CyberCard>
  );
}
