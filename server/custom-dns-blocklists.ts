import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import https from "node:https";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DOMAINS = 10_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;

export class CustomDnsBlocklistError extends Error {}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 || a === 10 || a === 127
      || (a === 100 && b! >= 64 && b! <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0 && c === 113)
      || a! >= 224
    );
  }
  if (family !== 6) return false;
  const normalized = address.toLowerCase().split("%")[0]!;
  if (normalized.startsWith("::ffff:")) return false;
  const firstSegment = Number.parseInt(normalized.split(":")[0] || "0", 16);
  return firstSegment >= 0x2000 && firstSegment < 0x4000
    && !normalized.startsWith("2001:db8")
    && !normalized.startsWith("2001:10")
    && !normalized.startsWith("2002:");
}

async function resolvePinnedPublicAddress(hostname: string): Promise<{ address: string; family: number }> {
  if (isIP(hostname)) throw new CustomDnsBlocklistError("Use a public HTTPS hostname, not an IP address.");
  if (hostname === "localhost" || /\.(localhost|local|internal|test|invalid)$/.test(hostname)) {
    throw new CustomDnsBlocklistError("The blocklist URL must use a public hostname.");
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new CustomDnsBlocklistError("The blocklist host could not be resolved.");
  }
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
    throw new CustomDnsBlocklistError("The blocklist host must resolve only to public IP addresses.");
  }
  return records[0]!;
}

function validateUrl(input: URL): void {
  if (
    input.protocol !== "https:"
    || input.username
    || input.password
    || (input.port && input.port !== "443")
    || input.search
    || input.hash
    || !input.hostname
  ) {
    throw new CustomDnsBlocklistError("Use a public HTTPS blocklist URL on the standard port without credentials or query parameters.");
  }
}

function getUrlBody(url: URL, pinned: { address: string; family: number }): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const pinnedLookup = ((_hostname: string, options: { all?: boolean }, callback: (...args: any[]) => void) => {
      if (options?.all) callback(null, [pinned]);
      else callback(null, pinned.address, pinned.family);
    }) as any;
    const request = https.get(url, {
      agent: false,
      lookup: pinnedLookup,
      servername: url.hostname,
      headers: { Accept: "text/plain, */*;q=0.1", "User-Agent": "SafeNet-Blocklist-Importer/1.0" },
      timeout: FETCH_TIMEOUT_MS,
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location ?? null;
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          request.destroy(new CustomDnsBlocklistError("The blocklist is larger than the 2 MB import limit."));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => resolve({ status, location, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new CustomDnsBlocklistError("The blocklist request timed out.")));
    request.on("error", reject);
  });
}

async function fetchText(sourceUrl: string): Promise<string> {
  let current: URL;
  try {
    current = new URL(sourceUrl);
  } catch {
    throw new CustomDnsBlocklistError("Enter a valid blocklist URL.");
  }
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    validateUrl(current);
    const pinned = await resolvePinnedPublicAddress(current.hostname);
    const response = await getUrlBody(current, pinned);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      if (redirects === MAX_REDIRECTS) throw new CustomDnsBlocklistError("The blocklist URL redirected too many times.");
      try {
        current = new URL(response.location, current);
      } catch {
        throw new CustomDnsBlocklistError("The blocklist returned an invalid redirect.");
      }
      continue;
    }
    if (response.status !== 200) {
      throw new CustomDnsBlocklistError(`The blocklist server returned HTTP ${response.status || "an error"}.`);
    }
    return response.body;
  }
  throw new CustomDnsBlocklistError("The blocklist could not be downloaded.");
}

function normalizeDomain(value: string): string | null {
  const trimmed = value.trim().replace(/\.$/, "");
  if (!trimmed || trimmed.length > 253 || trimmed.includes("*")) return null;
  const ascii = domainToASCII(trimmed).toLowerCase();
  if (!ascii || ascii.length > 253) return null;
  const labels = ascii.split(".");
  if (labels.length < 2 || labels.some((label) => (
    label.length < 1
    || label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))) return null;
  return ascii;
}

export function parseCustomDnsBlocklist(text: string): string[] {
  const domains = new Set<string>();
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("!") || line.startsWith("#") || line.startsWith("[")) continue;
    const hosts = line.split(/\s+/);
    if (hosts.length > 1 && isIP(hosts[0]!)) {
      for (const host of hosts.slice(1)) {
        const domain = normalizeDomain(host);
        if (domain) domains.add(domain);
      }
    } else {
      const adblockMatch = line.match(/^\|\|([a-z0-9.-]+)\^(?:\$.*)?$/i);
      const plain = line.split(/\s|#/)[0]!;
      const domain = normalizeDomain(adblockMatch?.[1] ?? plain);
      if (domain) domains.add(domain);
    }
    if (domains.size > MAX_DOMAINS) {
      throw new CustomDnsBlocklistError(`A blocklist can contain at most ${MAX_DOMAINS.toLocaleString()} domains.`);
    }
  }
  if (!domains.size) throw new CustomDnsBlocklistError("No valid domains were found in this blocklist.");
  return Array.from(domains).sort();
}

export async function fetchCustomDnsBlocklist(sourceUrl: string): Promise<string[]> {
  return parseCustomDnsBlocklist(await fetchText(sourceUrl));
}
