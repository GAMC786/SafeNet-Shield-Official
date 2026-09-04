import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { useQuery } from "@tanstack/react-query";
import { firewallConfigSchema, type FirewallConfig } from "@shared/schema";
import { api } from "@shared/routes";
import { apiFetch } from "@/lib/api";
import { SafeNetVpn } from "@/hooks/use-vpn";
import { firewallConfigQueryKey } from "@/hooks/firewall-config-key";

/**
 * Keeps Android's encrypted offline policy in step with the authenticated
 * server snapshot. A failed refresh intentionally leaves the last known
 * native policy in place.
 */
export function useFirewallConfig(enabled = true) {
  const query = useQuery({
    queryKey: firewallConfigQueryKey,
    enabled,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(api.firewall.config.path, {
        signal,
        timeoutMs: 10000,
      });
      if (!response.ok) throw new Error("Failed to fetch firewall configuration");
      return firewallConfigSchema.parse(await response.json()) as FirewallConfig;
    },
  });

  const serializedConfig = query.data ? JSON.stringify(query.data) : null;
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android" || !serializedConfig) {
      return;
    }

    let cancelled = false;
    void SafeNetVpn.syncFirewallConfig({ config: JSON.parse(serializedConfig) }).catch((error) => {
      if (!cancelled) {
        console.warn("SafeNet could not sync the firewall policy to Android.", error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [serializedConfig]);

  return query;
}