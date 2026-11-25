import { FormEvent, useState } from "react";
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { CyberCard } from "@/components/CyberCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

type ConnectionStatus = {
  adguard: { connected: boolean; profileId: string | null; lastSyncedAt: string | null };
};

type Filter = {
  filterId: string;
  name: string;
  description: string;
  rulesCount: number | null;
  enabled: boolean;
};

type FilterResponse = { serverId: string; filters: Filter[] };

async function familyDnsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((body as { message?: string } | null)?.message || "AdGuard DNS request failed.");
  }
  return body as T;
}

export function AdGuardDnsBlocklists() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [serverId, setServerId] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  const connectionQuery = useQuery({
    queryKey: ["family-dns-connections", userId],
    queryFn: () => familyDnsRequest<ConnectionStatus>("/api/family-dns/connections"),
    enabled: isLoaded && Boolean(isSignedIn && userId),
  });
  const connected = connectionQuery.data?.adguard.connected === true;

  const filtersQuery = useQuery({
    queryKey: ["adguard-dns-filter-lists", userId],
    queryFn: () => familyDnsRequest<FilterResponse>("/api/family-dns/adguard/filters"),
    enabled: isLoaded && Boolean(isSignedIn && userId && connected),
  });

  const filterMutation = useMutation({
    mutationFn: ({ filterId, enabled }: { filterId: string; enabled: boolean }) =>
      familyDnsRequest<FilterResponse>(`/api/family-dns/adguard/filters/${encodeURIComponent(filterId)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData(["adguard-dns-filter-lists", userId], result);
    },
    onError: (error) => toast({
      title: "AdGuard filter could not be updated",
      description: error instanceof Error ? error.message : "Try again shortly.",
      variant: "destructive",
    }),
  });

  const handleConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = apiKey.trim();
    const server = serverId.trim();
    if (!token || !server || isConnecting) return;
    setApiKey("");
    setIsConnecting(true);
    try {
      await familyDnsRequest("/api/family-dns/connections", {
        method: "POST",
        body: JSON.stringify({ provider: "adguard", profileId: server, token }),
      });
      setServerId("");
      await queryClient.invalidateQueries({ queryKey: ["family-dns-connections", userId] });
      await queryClient.invalidateQueries({ queryKey: ["adguard-dns-filter-lists", userId] });
      toast({ title: "AdGuard DNS connected", description: "SafeNet can now manage built-in filters for this DNS server." });
    } catch (error) {
      toast({
        title: "AdGuard DNS could not be connected",
        description: error instanceof Error ? error.message : "Check the API key and DNS server ID.",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const filters = filtersQuery.data?.filters ?? [];

  return (
    <CyberCard className="border-emerald-400/20 bg-emerald-400/5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display font-bold text-white">AdGuard DNS Built-in Blocklists</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose AdGuard’s built-in filters for your connected DNS server. AdGuard DNS applies these filters to requests using that server.
              </p>
            </div>
            {connected && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void filtersQuery.refetch()}
                disabled={filtersQuery.isFetching || filterMutation.isPending}
                className="border-emerald-300/30 text-emerald-200"
              >
                {filtersQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
            )}
          </div>

          {!connected && (
            !isLoaded || !isSignedIn ? (
              <p className="mt-4 text-sm text-muted-foreground">Sign in to connect and manage an AdGuard DNS server.</p>
            ) : (
            <form onSubmit={handleConnect} className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="adguard-api-key" className="text-xs font-medium text-foreground">AdGuard DNS API key</label>
                  <Input
                    id="adguard-api-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Paste API key"
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="adguard-server-id" className="text-xs font-medium text-foreground">DNS server ID</label>
                  <Input
                    id="adguard-server-id"
                    value={serverId}
                    onChange={(event) => setServerId(event.target.value)}
                    placeholder="Server ID from AdGuard DNS"
                    className="bg-background border-border font-mono"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  SafeNet verifies the connection and encrypts the API key for your account.
                </p>
                <Button type="submit" size="sm" disabled={!apiKey.trim() || !serverId.trim() || isConnecting}>
                  {isConnecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect AdGuard DNS
                </Button>
              </div>
            </form>
            )
          )}

          {connected && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">
                Connected server: <span className="font-mono text-foreground">{filtersQuery.data?.serverId ?? connectionQuery.data?.adguard.profileId}</span>
              </p>
              {filtersQuery.isLoading ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading AdGuard filters…
                </p>
              ) : filtersQuery.isError ? (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {filtersQuery.error instanceof Error ? filtersQuery.error.message : "AdGuard filter lists could not be loaded."}
                </p>
              ) : filters.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No built-in AdGuard filter lists were returned for this account.</p>
              ) : (
                <div className="mt-3 grid gap-2">
                  {filters.map((filter) => (
                    <div key={filter.filterId} className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-background/30 p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{filter.name}</p>
                        {filter.description && <p className="mt-0.5 text-xs text-muted-foreground">{filter.description}</p>}
                        {filter.rulesCount !== null && (
                          <p className="mt-1 text-[11px] text-muted-foreground">{filter.rulesCount.toLocaleString()} rules</p>
                        )}
                      </div>
                      <Switch
                        checked={filter.enabled}
                        onCheckedChange={(enabled) => filterMutation.mutate({ filterId: filter.filterId, enabled })}
                        disabled={filterMutation.isPending || filtersQuery.isFetching}
                        aria-label={`${filter.enabled ? "Disable" : "Enable"} ${filter.name}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </CyberCard>
  );
}
