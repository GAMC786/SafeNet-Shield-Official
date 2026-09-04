import { BlockList, isIP } from "node:net";

const rawUrl = process.argv[2];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

if (!rawUrl) {
  fail("MOBILE_API_URL is required.");
}

let url;
try {
  url = new URL(rawUrl);
} catch {
  fail("MOBILE_API_URL is not a valid URL.");
}

if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.pathname !== "/" ||
  url.search ||
  url.hash
) {
  fail(
    "MOBILE_API_URL must be an origin-only HTTPS URL with no path, query, fragment, or credentials.",
  );
}

const blocked = new BlockList();
[
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, "ipv4"));

[
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, "ipv6"));

const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
if (
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname.endsWith(".local")
) {
  fail("MOBILE_API_URL cannot use a local hostname.");
}

let addresses;
try {
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    const answers = await Promise.all(
      ["A", "AAAA"].map(async (type) => {
        const endpoint = new URL("https://dns.google/resolve");
        endpoint.searchParams.set("name", hostname);
        endpoint.searchParams.set("type", type);
        const response = await fetch(endpoint, {
          signal: AbortSignal.timeout(10000),
          headers: { Accept: "application/dns-json" },
        });
        if (!response.ok) {
          throw new Error("Public DNS lookup failed");
        }
        const payload = await response.json();
        return (payload.Answer || [])
          .filter((answer) => answer.type === 1 || answer.type === 28)
          .map((answer) => ({
            address: answer.data,
            family: answer.type === 28 ? 6 : 4,
          }));
      }),
    );
    addresses = answers.flat();
  }
} catch {
  fail(`The backend hostname ${hostname} could not be resolved using public DNS.`);
}

if (
  addresses.length === 0 ||
  addresses.some(
    ({ address, family }) =>
      (family === 6 && address.toLowerCase().startsWith("::ffff:")) ||
      blocked.check(address, family === 6 ? "ipv6" : "ipv4"),
  )
) {
  fail("MOBILE_API_URL resolves to a private, local, or reserved network address.");
}

let response;
try {
  response = await fetch(new URL("/api/auth/status", url), {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json" },
    redirect: "manual",
  });
} catch {
  fail(`The mobile backend is not reachable at ${url.origin}/api/auth/status.`);
}

if (response.status >= 300 && response.status < 400) {
  const location = response.headers.get("location") || "";
  if (location.includes("/__replshield")) {
    fail(
      "The published deployment protects the mobile API with Replit Shield. Set deployment visibility to Public and republish before building native clients.",
    );
  }
  fail(`The mobile backend authentication endpoint returned HTTP ${response.status}.`);
}

if (!response.ok) {
  fail(`The mobile backend authentication endpoint returned HTTP ${response.status}.`);
}

try {
  const status = await response.json();
  if (
    typeof status !== "object" ||
    status === null ||
    typeof status.authenticated !== "boolean" ||
    typeof status.pinRequired !== "boolean"
  ) {
    fail("The mobile backend authentication endpoint returned an invalid response.");
  }
} catch {
  fail("The mobile backend authentication endpoint did not return valid JSON.");
}

process.stdout.write(url.origin);