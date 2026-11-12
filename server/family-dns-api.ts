import type { FamilyDnsCredential } from "@shared/schema";

export type FamilyDnsProvider = FamilyDnsCredential["provider"];
type Rule = { domain: string; action: "allow" | "block" };

export class FamilyDnsApiError extends Error {
  constructor(readonly rejected: boolean) {
    super("Family DNS provider request failed.");
  }
}

function adGuardHeaders(token: string) {
  return { Authorization: `ApiKey ${token}`, Accept: "application/json" };
}

async function adGuardRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.adguard-dns.io${path}`, {
      ...init,
      headers: { ...adGuardHeaders(token), ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new FamilyDnsApiError(false);
  }
  if (!response.ok) throw new FamilyDnsApiError([400, 401, 403, 404].includes(response.status));
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; } catch { throw new FamilyDnsApiError(false); }
}

function cleanBrowsingUrl(token: string, action: string, profileId: string, params: Record<string, string> = {}) {
  const url = new URL("https://my.cleanbrowsing.org/api");
  url.searchParams.set("apikey", token);
  url.searchParams.set("action", action);
  if (action !== "profiles/list") url.searchParams.set("profile_name", profileId);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function cleanBrowsingRequest(token: string, action: string, profileId: string, params: Record<string, string> = {}) {
  let response: Response;
  try {
    response = await fetch(cleanBrowsingUrl(token, action, profileId, params), { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new FamilyDnsApiError(false);
  }
  let body: any;
  try { body = await response.json(); } catch { throw new FamilyDnsApiError(false); }
  if (!response.ok || body?.status !== "success") {
    throw new FamilyDnsApiError(response.status === 401 || response.status === 403 || /api key|unauthorized/i.test(String(body?.reason ?? "")));
  }
  return body;
}

export async function verifyFamilyDnsAccount(provider: FamilyDnsProvider, token: string, profileId: string) {
  if (provider === "cleanbrowsing") {
    const body = await cleanBrowsingRequest(token, "profiles/list", profileId);
    if (!Array.isArray(body.profiles) || !body.profiles.includes(profileId)) throw new FamilyDnsApiError(true);
  } else {
    const settings = await adGuardRequest<any>(token, `/oapi/v1/dns_servers/${encodeURIComponent(profileId)}/settings`);
    if (!settings || typeof settings !== "object" || !settings.user_rules_settings) throw new FamilyDnsApiError(true);
  }
}

async function syncCleanBrowsing(token: string, profileId: string, desired: Rule[], previous: string[]) {
  const [allowBody, blockBody] = await Promise.all([
    cleanBrowsingRequest(token, "whitelist/list", profileId),
    cleanBrowsingRequest(token, "blocklist/list", profileId),
  ]);
  const currentAllow = Array.isArray(allowBody.whitelist?.[profileId]) ? allowBody.whitelist[profileId] as string[] : [];
  const currentBlock = Array.isArray(blockBody.blocklist?.[profileId]) ? blockBody.blocklist[profileId] as string[] : [];
  const desiredKeys = new Set(desired.map((rule) => `${rule.action}:${rule.domain}`));
  const nextOwned = new Set<string>();

  for (const old of previous) {
    const split = old.indexOf(":");
    const action = old.slice(0, split);
    const domain = old.slice(split + 1);
    if (desiredKeys.has(old)) {
      nextOwned.add(old);
    } else {
      const exists = action === "allow" ? currentAllow.includes(domain) : currentBlock.includes(domain);
      if (exists) await cleanBrowsingRequest(token, `${action === "allow" ? "whitelist" : "blocklist"}/delete`, profileId, { domain_name: domain });
    }
  }
  for (const rule of desired) {
    const key = `${rule.action}:${rule.domain}`;
    const exists = rule.action === "allow" ? currentAllow.includes(rule.domain) : currentBlock.includes(rule.domain);
    if (!exists) {
      await cleanBrowsingRequest(token, `${rule.action === "allow" ? "whitelist" : "blocklist"}/add`, profileId, { domain_name: rule.domain });
      nextOwned.add(key);
    } else if (previous.includes(key)) {
      nextOwned.add(key);
    }
  }
  return Array.from(nextOwned);
}

async function syncAdGuard(token: string, serverId: string, desired: Rule[], previous: string[]) {
  const current = await adGuardRequest<any>(token, `/oapi/v1/dns_servers/${encodeURIComponent(serverId)}/settings`);
  const userRules = current.user_rules_settings;
  if (!userRules || !Array.isArray(userRules.rules)) throw new FamilyDnsApiError(false);
  const toFilterRule = (rule: Rule) => rule.action === "allow" ? `@@||${rule.domain}^` : `||${rule.domain}^`;
  const oldOwned = new Set(previous);
  const desiredRules = desired.map(toFilterRule);
  const keptManual = (userRules.rules as string[]).filter((rule: string) => !oldOwned.has(rule));
  const ownedRules = desiredRules.filter((rule) => !keptManual.includes(rule));
  const merged = Array.from(new Set([...keptManual, ...desiredRules]));
  if (JSON.stringify(merged) !== JSON.stringify(userRules.rules)) {
    await adGuardRequest(token, `/oapi/v1/dns_servers/${encodeURIComponent(serverId)}/settings`, {
      method: "PUT",
      body: JSON.stringify({ user_rules_settings: { enabled: Boolean(userRules.enabled || merged.length), rules: merged } }),
    });
  }
  return ownedRules;
}

export async function syncFamilyDnsRules(
  provider: FamilyDnsProvider,
  token: string,
  profileId: string,
  desired: Rule[],
  previouslyOwned: string[],
) {
  return provider === "cleanbrowsing"
    ? syncCleanBrowsing(token, profileId, desired, previouslyOwned)
    : syncAdGuard(token, profileId, desired, previouslyOwned);
}
