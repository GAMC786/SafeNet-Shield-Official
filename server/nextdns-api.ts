import type { NextDnsSyncedRule } from "@shared/schema";

const API = "https://api.nextdns.io";

export class NextDnsApiError extends Error {
  constructor(readonly rejected: boolean) {
    super("NextDNS request failed.");
    this.name = "NextDnsApiError";
  }
}

async function request<T>(
  token: string,
  path: string,
  fetchImpl: typeof fetch,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        "X-Api-Key": token,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new NextDnsApiError(false);
  }
  if (response.status === 204) return undefined as T;
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new NextDnsApiError(false);
  }
  if (!response.ok || body?.errors?.length) {
    throw new NextDnsApiError(response.status === 401 || response.status === 403 || response.status === 400);
  }
  return body.data as T;
}

export async function verifyNextDnsProfile(
  token: string,
  profileId: string,
  fetchImpl: typeof fetch = fetch,
) {
  return request(token, `/profiles/${encodeURIComponent(profileId)}`, fetchImpl);
}

type ProviderEntry = { id: string; active?: boolean };

export async function syncNextDnsRules(
  token: string,
  profileId: string,
  desiredRules: Array<Pick<NextDnsSyncedRule, "domain" | "action">>,
  previouslySynced: NextDnsSyncedRule[],
  fetchImpl: typeof fetch = fetch,
): Promise<NextDnsSyncedRule[]> {
  const next: NextDnsSyncedRule[] = [];
  const desired = new Map(desiredRules.map((rule) => [`${rule.action}:${rule.domain}`, rule]));
  const actions = ["allow", "block"] as const;

  for (const action of actions) {
    const listPath = `/profiles/${encodeURIComponent(profileId)}/${action === "allow" ? "allowlist" : "denylist"}`;
    const entries = await request<ProviderEntry[]>(token, listPath, fetchImpl);
    const remoteById = new Map(entries.map((entry) => [entry.id.toLowerCase(), entry]));
    const previous = new Map(previouslySynced
      .filter((rule) => rule.action === action)
      .map((rule) => [rule.domain, rule]));

    for (const old of Array.from(previous.values())) {
      if (desired.has(`${action}:${old.domain}`) || !old.ownedBySafeNet) continue;
      if (remoteById.has(old.domain)) {
        await request(token, `${listPath}/${encodeURIComponent(old.domain)}`, fetchImpl, { method: "DELETE" });
      }
    }

    for (const rule of Array.from(desired.values())) {
      if (rule.action !== action) continue;
      const domain = rule.domain.toLowerCase();
      const remote = remoteById.get(domain);
      let ownedBySafeNet = previous.get(domain)?.ownedBySafeNet ?? false;
      if (!remote) {
        await request(token, listPath, fetchImpl, {
          method: "POST",
          body: JSON.stringify({ id: domain, active: true }),
        });
        ownedBySafeNet = true;
      } else if (remote.active === false) {
        await request(token, `${listPath}/${encodeURIComponent(domain)}`, fetchImpl, {
          method: "PATCH",
          body: JSON.stringify({ active: true }),
        });
      }
      next.push({ domain, action, ownedBySafeNet });
    }
  }
  return next;
}
