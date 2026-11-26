import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { firewallConfigQueryKey } from "@/hooks/firewall-config-key";
import { apiFetch } from "@/lib/api";

type CustomDnsBlocklist = {
  id: number;
  name: string;
  sourceHost: string;
  domainCount: number;
  isActive: boolean;
  updatedAt: string;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, {
    ...init,
    credentials: "include",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error((body as { message?: string } | null)?.message ?? "Custom blocklist request failed.");
  return body as T;
}

export function CustomDnsBlocklists() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const listQuery = useQuery({
    queryKey: ["custom-dns-blocklists"],
    queryFn: () => request<CustomDnsBlocklist[]>("/api/custom-dns-blocklists"),
  });

  const refreshViews = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["custom-dns-blocklists"] }),
      queryClient.invalidateQueries({ queryKey: firewallConfigQueryKey }),
    ]);
  };
  const addMutation = useMutation({
    mutationFn: () => request<CustomDnsBlocklist>("/api/custom-dns-blocklists", {
      method: "POST",
      body: JSON.stringify({ name, sourceUrl }),
    }),
    onSuccess: async (list) => {
      setName("");
      setSourceUrl("");
      setShowForm(false);
      await refreshViews();
      toast({ title: "Custom blocklist added", description: `${list.domainCount.toLocaleString()} domains imported for SafeNet DNS filtering.` });
    },
    onError: (error) => toast({
      title: "Custom blocklist could not be added",
      description: error instanceof Error ? error.message : "Check the URL and try again.",
      variant: "destructive",
    }),
  });
  const refreshMutation = useMutation({
    mutationFn: (id: number) => request<CustomDnsBlocklist>(`/api/custom-dns-blocklists/${id}/refresh`, { method: "POST" }),
    onSuccess: async (list) => {
      await refreshViews();
      toast({ title: "Custom blocklist refreshed", description: `${list.domainCount.toLocaleString()} domains are now available to SafeNet.` });
    },
    onError: (error) => toast({
      title: "Custom blocklist could not be refreshed",
      description: error instanceof Error ? error.message : "The previous imported rules were kept.",
      variant: "destructive",
    }),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      request<CustomDnsBlocklist>(`/api/custom-dns-blocklists/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: refreshViews,
    onError: (error) => toast({
      title: "Custom blocklist status could not be changed",
      description: error instanceof Error ? error.message : "Try again.",
      variant: "destructive",
    }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => request<void>(`/api/custom-dns-blocklists/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await refreshViews();
      toast({ title: "Custom blocklist removed", description: "Its imported domains are no longer sent to the phone." });
    },
    onError: (error) => toast({
      title: "Custom blocklist could not be removed",
      description: error instanceof Error ? error.message : "Try again.",
      variant: "destructive",
    }),
  });

  const busy = addMutation.isPending || refreshMutation.isPending || toggleMutation.isPending || deleteMutation.isPending;
  return (
    <section className="mt-4 rounded-md border border-white/10 bg-background/30 p-3" aria-labelledby="custom-dns-blocklists-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 id="custom-dns-blocklists-title" className="text-sm font-semibold text-foreground">SafeNet custom blocklists</h4>
          <p className="mt-1 text-xs text-muted-foreground">Imported domains are enforced locally while SafeNet’s DNS-only VPN is active.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowForm((open) => !open)} data-testid="button-add-custom-dns-blocklist">
          <Plus className="mr-1.5 h-4 w-4" /> Add custom blocklist
        </Button>
      </div>

      {showForm && (
        <form
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && sourceUrl.trim()) addMutation.mutate();
          }}
        >
          <Input aria-label="Blocklist name" value={name} onChange={(event) => setName(event.target.value)} placeholder="List name" maxLength={100} required />
          <Input aria-label="Blocklist URL" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.org/blocklist.txt" maxLength={2048} required />
          <Button type="submit" size="sm" disabled={!name.trim() || !sourceUrl.trim() || addMutation.isPending}>
            {addMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Import list
          </Button>
          <p className="text-xs text-muted-foreground sm:col-span-3">Public HTTPS lists only; up to 10,000 supported domains per list. Refreshes are manual.</p>
        </form>
      )}

      {listQuery.isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading custom blocklists…</p>
      ) : listQuery.isError ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {listQuery.error instanceof Error ? listQuery.error.message : "Custom blocklists could not be loaded."}
        </p>
      ) : listQuery.data?.length ? (
        <div className="mt-3 space-y-2">
          {listQuery.data.map((list) => (
            <div key={list.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/10 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{list.name}</p>
                <p className="truncate text-xs text-muted-foreground">{list.domainCount.toLocaleString()} domains · {list.sourceHost}</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={list.isActive} onCheckedChange={(isActive) => toggleMutation.mutate({ id: list.id, isActive })} disabled={busy} aria-label={`${list.isActive ? "Disable" : "Enable"} ${list.name}`} />
                <Button size="icon" variant="ghost" title="Refresh list" aria-label={`Refresh ${list.name}`} disabled={busy} onClick={() => refreshMutation.mutate(list.id)}>
                  {refreshMutation.isPending && refreshMutation.variables === list.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" title="Remove list" aria-label={`Remove ${list.name}`} disabled={busy} onClick={() => {
                  if (window.confirm(`Remove the custom blocklist "${list.name}"?`)) deleteMutation.mutate(list.id);
                }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No custom SafeNet blocklists yet.</p>
      )}
    </section>
  );
}
