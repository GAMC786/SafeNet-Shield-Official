import { useState, type FormEvent } from "react";
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Check, Copy, Loader2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CyberCard } from "@/components/CyberCard";
import { useToast } from "@/hooks/use-toast";

type ConnectionStatus = {
  connected: boolean;
  connectedAt: string | null;
};

type ControlDProfile = {
  id: string;
  name: string;
  updatedAt: number | null;
};

type ControlDDevice = {
  id: string;
  name: string;
  profileId: string | null;
  profileName: string | null;
  dotHostname: string | null;
  dohUrl: string | null;
};

type ControlDAccount = {
  profiles: ControlDProfile[];
  devices: ControlDDevice[];
};

async function controlDRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) {
    throw new Error(body?.message || "Control D request failed.");
  }
  return body as T;
}

function ControlDIntegration() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [apiToken, setApiToken] = useState("");
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, string>>({});
  const [isConnecting, setIsConnecting] = useState(false);

  const connectionQuery = useQuery({
    queryKey: ["control-d-connection", userId],
    queryFn: () => controlDRequest<ConnectionStatus>("/api/control-d/connection"),
    enabled: isLoaded && Boolean(isSignedIn && userId),
  });

  const accountQuery = useQuery({
    queryKey: ["control-d-account", userId],
    queryFn: () => controlDRequest<ControlDAccount>("/api/control-d/account"),
    enabled: isLoaded && Boolean(isSignedIn && userId && connectionQuery.data?.connected),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => controlDRequest<void>("/api/control-d/connection", { method: "DELETE" }),
    onSuccess: async () => {
      setSelectedProfiles({});
      queryClient.removeQueries({ queryKey: ["control-d-account", userId] });
      queryClient.setQueryData<ConnectionStatus>(["control-d-connection", userId], {
        connected: false,
        connectedAt: null,
      });
      toast({
        title: "Control D disconnected",
        description: "SafeNet removed the encrypted token. Your Control D endpoints were not changed.",
      });
    },
    onError: (error) => toast({
      title: "Control D could not be disconnected",
      description: error instanceof Error ? error.message : "Try again shortly.",
      variant: "destructive",
    }),
  });

  const profileMutation = useMutation({
    mutationFn: ({ deviceId, profileId }: { deviceId: string; profileId: string }) =>
      controlDRequest<{ device: ControlDDevice }>(
        `/api/control-d/devices/${encodeURIComponent(deviceId)}/profile`,
        { method: "PATCH", body: JSON.stringify({ profileId }) },
      ),
    onSuccess: async () => {
      setSelectedProfiles({});
      await queryClient.invalidateQueries({ queryKey: ["control-d-account", userId] });
      toast({
        title: "Control D profile updated",
        description: "The endpoint now uses the selected profile.",
      });
    },
    onError: (error) => toast({
      title: "Control D profile could not be updated",
      description: error instanceof Error ? error.message : "Try again shortly.",
      variant: "destructive",
    }),
  });

  const handleConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = apiToken.trim();
    if (!token || isConnecting) return;

    // Keep the provider token only in this short-lived local variable; it is
    // not placed in a React Query mutation cache or browser storage.
    setApiToken("");
    setIsConnecting(true);
    try {
      await controlDRequest<ConnectionStatus>("/api/control-d/connect", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      await queryClient.invalidateQueries({ queryKey: ["control-d-connection", userId] });
      toast({
        title: "Control D connected",
        description: "Your account was verified and its API token was encrypted for your SafeNet user.",
      });
    } catch (error) {
      toast({
        title: "Control D could not be connected",
        description: error instanceof Error ? error.message : "Check the token and try again.",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    if (!window.confirm(
      "Disconnect Control D from SafeNet? This removes the encrypted token but does not delete or modify Control D endpoints.",
    )) return;
    disconnectMutation.mutate();
  };

  const copyResolver = async (hostname: string) => {
    try {
      await navigator.clipboard.writeText(hostname);
      toast({ title: "Resolver hostname copied" });
    } catch {
      toast({
        title: "Could not copy the resolver hostname",
        description: "Select and copy the hostname manually.",
        variant: "destructive",
      });
    }
  };

  const openSignIn = () => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    setLocation(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  };

  return (
    <CyberCard className="border-sky-400/20 bg-sky-400/[0.03]">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-300">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">
              Control D account
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect your account to view its endpoints and assign profiles. Control D management is the only SafeNet feature here that requires sign-in.
            </p>
          </div>
        </div>

        {!isLoaded ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking sign-in…
          </div>
        ) : !isSignedIn ? (
          <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Sign in only to connect or manage your Control D account. The rest of SafeNet stays public.
            </p>
            <Button type="button" onClick={openSignIn} className="shrink-0">
              Sign in to connect
            </Button>
          </div>
        ) : connectionQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading connection status…
          </div>
        ) : connectionQuery.isError ? (
          <p className="rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200" role="alert">
            {connectionQuery.error instanceof Error
              ? connectionQuery.error.message
              : "Control D connection status is unavailable."}
          </p>
        ) : !connectionQuery.data?.connected ? (
          <form onSubmit={handleConnect} className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="space-y-2">
              <label htmlFor="control-d-api-token" className="text-sm font-medium text-white">
                Control D API token
              </label>
              <Input
                id="control-d-api-token"
                name="control-d-api-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiToken}
                onChange={(event) => setApiToken(event.target.value)}
                placeholder="Paste your Control D API token"
                aria-describedby="control-d-token-help"
                className="border-white/10 bg-slate-950/80"
              />
              <p id="control-d-token-help" className="text-xs leading-relaxed text-muted-foreground">
                SafeNet verifies the token before saving it. It is encrypted at rest, never returned by the API, and removed when you disconnect.
              </p>
            </div>
            <Button type="submit" disabled={!apiToken.trim() || isConnecting}>
              {isConnecting
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
              {isConnecting ? "Connecting…" : "Connect Control D"}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-emerald-200">
                <Check className="h-4 w-4" aria-hidden="true" />
                <span>
                  Connected
                  {connectionQuery.data.connectedAt
                    ? ` since ${new Date(connectionQuery.data.connectedAt).toLocaleDateString()}`
                    : ""}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disconnectMutation.isPending}
                onClick={handleDisconnect}
                className="border-white/15"
              >
                {disconnectMutation.isPending
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Unplug className="mr-2 h-4 w-4" aria-hidden="true" />}
                Disconnect
              </Button>
            </div>

            {accountQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading Control D profiles and endpoints…
              </div>
            ) : accountQuery.isError ? (
              <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-100" role="alert">
                {accountQuery.error instanceof Error
                  ? accountQuery.error.message
                  : "Control D account data could not be loaded."}
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Applying a profile changes that endpoint in Control D. Its resolver hostname is shown for Android Private DNS; SafeNet does not add account-specific resolvers to the shared DNS list.
                </p>

                {accountQuery.data?.devices.length ? (
                  <div className="space-y-3">
                    {accountQuery.data.devices.map((device) => {
                      const currentSelection = selectedProfiles[device.id] ?? device.profileId ?? "";
                      const isDirty = currentSelection !== (device.profileId ?? "");
                      const isUpdating = profileMutation.isPending
                        && profileMutation.variables?.deviceId === device.id;

                      return (
                        <div key={device.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <h3 className="font-medium text-white">{device.name}</h3>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Current profile: {device.profileName ?? "None"}
                              </p>
                            </div>
                            <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-64">
                              <label htmlFor={`control-d-profile-${device.id}`} className="text-xs font-medium text-muted-foreground">
                                Assign profile
                              </label>
                              <div className="flex gap-2">
                                <select
                                  id={`control-d-profile-${device.id}`}
                                  value={currentSelection}
                                  onChange={(event) => setSelectedProfiles((current) => ({
                                    ...current,
                                    [device.id]: event.target.value,
                                  }))}
                                  disabled={!accountQuery.data?.profiles.length || profileMutation.isPending}
                                  className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-slate-950 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                                >
                                  {accountQuery.data?.profiles.map((profile) => (
                                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                                  ))}
                                </select>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={!isDirty || !currentSelection || profileMutation.isPending}
                                  onClick={() => profileMutation.mutate({
                                    deviceId: device.id,
                                    profileId: currentSelection,
                                  })}
                                  className="shrink-0"
                                >
                                  {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                                  Apply
                                </Button>
                              </div>
                            </div>
                          </div>

                          {device.dotHostname && (
                            <div className="mt-3 flex flex-col gap-2 border-t border-white/5 pt-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-muted-foreground">Android Private DNS hostname</p>
                                <code className="mt-1 block break-all text-xs text-sky-200">{device.dotHostname}</code>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => void copyResolver(device.dotHostname!)}
                                className="shrink-0"
                              >
                                <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                                Copy hostname
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-muted-foreground">
                    No Control D endpoints were found for this account.
                  </p>
                )}

                {!accountQuery.data?.profiles.length && (
                  <p className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-muted-foreground">
                    No profiles were found. Create a profile in Control D, then refresh this page.
                  </p>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={accountQuery.isFetching}
                  onClick={() => void accountQuery.refetch()}
                >
                  {accountQuery.isFetching
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
                  Refresh Control D data
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </CyberCard>
  );
}

export default ControlDIntegration;