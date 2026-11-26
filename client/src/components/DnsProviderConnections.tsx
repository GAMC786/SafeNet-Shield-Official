import { useState, type FormEvent } from "react";
import { useSafeNetAuth as useAuth } from "@/lib/safenet-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlugZap, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CyberCard } from "@/components/CyberCard";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

type Provider = "nextdns" | "adguard" | "cleanbrowsing";
type ProviderStatuses = Record<Provider, { connected: boolean; profileId: string | null }>;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((body as { message?: string } | null)?.message ?? "DNS provider request failed.");
  }
  return body as T;
}

const providerNames: Record<Provider, string> = {
  nextdns: "NextDNS",
  adguard: "AdGuard DNS",
  cleanbrowsing: "CleanBrowsing",
};

export default function DnsProviderConnections() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<Provider>("nextdns");
  const [token, setToken] = useState("");
  const [profileId, setProfileId] = useState("");
  const [adguardServers, setAdguardServers] = useState<Array<{ id: string; name: string }>>([]);

  const invalidateProviderBlocklistQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dns-api-provider-connections", userId] }),
      queryClient.invalidateQueries({ queryKey: ["dns-provider-list-status", userId] }),
      queryClient.invalidateQueries({ queryKey: ["dns-provider-native-lists", userId] }),
      queryClient.invalidateQueries({ queryKey: ["family-dns-connections", userId] }),
      queryClient.invalidateQueries({ queryKey: ["adguard-dns-filter-lists", userId] }),
    ]);
  };

  const statusQuery = useQuery({
    queryKey: ["dns-api-provider-connections", userId],
    enabled: isLoaded && Boolean(isSignedIn && userId),
    queryFn: async () => {
      const [family, next] = await Promise.all([
        request<{ adguard: { connected: boolean; profileId: string | null }; cleanbrowsing: { connected: boolean; profileId: string | null } }>("/api/family-dns/connections"),
        request<{ connected: boolean; profileId: string | null }>("/api/nextdns/connection"),
      ]);
      return {
        nextdns: next,
        adguard: family.adguard,
        cleanbrowsing: family.cleanbrowsing,
      } satisfies ProviderStatuses;
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const body = JSON.stringify({ token, profileId });
      if (provider === "nextdns") {
        return request("/api/nextdns/connection", { method: "POST", body });
      }
      return request("/api/family-dns/connections", {
        method: "POST",
        body: JSON.stringify({ provider, token, profileId }),
      });
    },
    onSuccess: async () => {
      setToken("");
      setProfileId("");
      setAdguardServers([]);
      await invalidateProviderBlocklistQueries();
      toast({ title: `${providerNames[provider]} connected`, description: "The credential was verified and encrypted for your account." });
    },
    onError: (error) => toast({
      title: `${providerNames[provider]} could not be connected`,
      description: error instanceof Error ? error.message : "Check the token and account or profile ID.",
      variant: "destructive",
    }),
  });

  const loadAdGuardServersMutation = useMutation({
    mutationFn: () => request<{ servers: Array<{ id: string; name: string }> }>("/api/family-dns/adguard/servers", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
    onSuccess: ({ servers }) => {
      setAdguardServers(servers);
      setProfileId(servers.length === 1 ? servers[0]!.id : "");
      if (servers.length === 0) {
        toast({ title: "No AdGuard DNS servers found", description: "This API key did not return any servers from its account." });
      }
    },
    onError: (error) => toast({
      title: "Could not load AdGuard DNS servers",
      description: error instanceof Error ? error.message : "Check the API key and try again.",
      variant: "destructive",
    }),
  });

  const disconnectMutation = useMutation({
    mutationFn: (target: Provider) => request<void>(
      target === "nextdns" ? "/api/nextdns/connection" : `/api/family-dns/connections/${target}`,
      { method: "DELETE" },
    ),
    onSuccess: async (_, target) => {
      await invalidateProviderBlocklistQueries();
      toast({ title: `${providerNames[target]} disconnected`, description: "SafeNet removed the encrypted API credential." });
    },
    onError: (error) => toast({
      title: "Provider could not be disconnected",
      description: error instanceof Error ? error.message : "Try again shortly.",
      variant: "destructive",
    }),
  });

  if (!isLoaded) return null;
  if (!isSignedIn || !userId) {
    return (
      <CyberCard className="border-cyan-400/20 bg-cyan-400/[0.03]">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">DNS provider API connections</h2>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to connect and manage encrypted provider credentials.</p>
        <Button
          size="sm"
          className="mt-3"
          onClick={() => setLocation(`/sign-in?redirect_url=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`)}
        >
          Sign in
        </Button>
      </CyberCard>
    );
  }
  const connection = statusQuery.data?.[provider];

  const handleConnect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token.trim() || !profileId.trim() || connectMutation.isPending) return;
    connectMutation.mutate();
  };

  return (
    <CyberCard className="border-cyan-400/20 bg-cyan-400/[0.03]">
      <div className="flex items-start gap-3">
        <PlugZap className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">DNS provider API connections</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the provider first. SafeNet verifies credentials with that provider only; tokens are encrypted and never saved in browser storage.
          </p>

          {statusQuery.isError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {statusQuery.error instanceof Error ? statusQuery.error.message : "Connection status is unavailable."}
            </p>
          )}

          <form onSubmit={handleConnect} className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="dns-api-provider" className="text-xs font-medium text-foreground">DNS provider</label>
                <select
                  id="dns-api-provider"
                  value={provider}
                  onChange={(event) => {
                    setProvider(event.target.value as Provider);
                    setToken("");
                    setProfileId("");
                    setAdguardServers([]);
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                >
                  {Object.entries(providerNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="dns-api-profile" className="text-xs font-medium text-foreground">
                  {provider === "adguard" ? "AdGuard DNS server" : provider === "nextdns" ? "NextDNS profile ID" : "CleanBrowsing profile name"}
                </label>
                {provider === "adguard" ? (
                  <select
                    id="dns-api-profile"
                    value={profileId}
                    onChange={(event) => setProfileId(event.target.value)}
                    disabled={adguardServers.length === 0 || loadAdGuardServersMutation.isPending}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:opacity-50"
                  >
                    <option value="">{adguardServers.length ? "Choose a DNS server" : "Load servers from your account"}</option>
                    {adguardServers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
                  </select>
                ) : (
                  <Input
                    id="dns-api-profile"
                    value={profileId}
                    onChange={(event) => setProfileId(event.target.value)}
                    placeholder={provider === "nextdns" ? "Profile ID" : "Profile name"}
                    autoComplete="off"
                  />
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="dns-api-token" className="text-xs font-medium text-foreground">{providerNames[provider]} API token</label>
              <Input
                id="dns-api-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  if (provider === "adguard") {
                    setProfileId("");
                    setAdguardServers([]);
                  }
                }}
                placeholder={`Paste your ${providerNames[provider]} API token`}
              />
            </div>
            {provider === "adguard" && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  SafeNet loads server IDs from your account. The Server setup ID is only for device enrollment.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!token.trim() || loadAdGuardServersMutation.isPending || connectMutation.isPending}
                  onClick={() => loadAdGuardServersMutation.mutate()}
                >
                  {loadAdGuardServersMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Load AdGuard servers
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {connection?.connected
                  ? `Connected account: ${connection.profileId ?? "verified"}`
                  : "Control D account management is available in the separate Control D card above."}
              </p>
              <div className="flex flex-wrap gap-2">
                {connection?.connected && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disconnectMutation.isPending}
                    onClick={() => disconnectMutation.mutate(provider)}
                  >
                    {disconnectMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unplug className="mr-2 h-4 w-4" />}
                    Disconnect
                  </Button>
                )}
                <Button type="submit" size="sm" disabled={!token.trim() || !profileId.trim() || connectMutation.isPending || loadAdGuardServersMutation.isPending}>
                  {connectMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {connection?.connected ? "Replace connection" : `Connect ${providerNames[provider]}`}
                </Button>
              </div>
            </div>
          </form>

          <div className="mt-4 grid gap-2 border-t border-white/10 pt-3 text-xs text-muted-foreground sm:grid-cols-2">
            <p><strong className="text-foreground">OpenDNS Home / FamilyShield:</strong> resolver-only; no API token connection is available here.</p>
            <p><strong className="text-foreground">uBlockDNS:</strong> no supported account API is configured; add its resolver manually if you use it.</p>
          </div>
        </div>
      </div>
    </CyberCard>
  );
}
