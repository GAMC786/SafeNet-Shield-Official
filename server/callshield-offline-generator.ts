import { createHash } from "node:crypto";

export type CallShieldOfflineFeed = {
  version: number;
  updated: string;
  sources: string[];
  numbers: Array<{
    number: string;
    type: string;
    reports: number;
    sources: string[];
  }>;
  prefixes: Array<{
    prefix: string;
    type: string;
    description?: string;
    sources: string[];
  }>;
};

export type CallShieldOfflineManifest = {
  formatVersion: number;
  sourceManifestVersion: number;
  sourceManifestUrl: string;
  feedVersion: number;
  updated: string;
  sha256: string;
  redistributable: boolean;
  license: string;
  attribution: string;
  includedSources: string[];
  numberCount: number;
  prefixCount: number;
};

type CallShieldProvenance = {
  source_id?: unknown;
  license?: unknown;
  attribution?: unknown;
  expires_at_epoch_ms?: unknown;
};

type CallShieldSourceDeclaration = {
  id: string;
  redistributable: boolean;
  license: string;
  attribution: string;
};

type CallShieldSourceManifest = {
  version: number;
  sources: CallShieldSourceDeclaration[];
};

type CallShieldUpstreamRow = {
  number?: unknown;
  prefix?: unknown;
  type?: unknown;
  reports?: unknown;
  description?: unknown;
  evidence?: unknown;
};

type CallShieldUpstreamFeed = {
  version: number;
  updated: string;
  numbers: CallShieldUpstreamRow[];
  prefixes: CallShieldUpstreamRow[];
};

export const CALLSHIELD_SOURCE_MANIFEST_URL =
  "https://raw.githubusercontent.com/SysAdminDoc/CallShield/master/data/source-manifest.json";
export const CALLSHIELD_APPROVED_OFFLINE_SOURCES = ["github_database"] as const;

const E164_NUMBER_PATTERN = /^\+[1-9]\d{6,14}$/;
const E164_PREFIX_PATTERN = /^\+[1-9]\d{1,14}$/;

function validSourceManifest(
  value: CallShieldSourceManifest,
): value is CallShieldSourceManifest {
  return value.version === 1 &&
    Array.isArray(value.sources) &&
    value.sources.every((source) =>
      typeof source.id === "string" &&
      typeof source.redistributable === "boolean" &&
      typeof source.license === "string" &&
      typeof source.attribution === "string"
    );
}

function provenanceForRow(
  row: CallShieldUpstreamRow,
  sourceManifest: CallShieldSourceManifest,
  snapshotCutoff: number,
) {
  if (!Array.isArray(row.evidence) || row.evidence.length === 0) return null;
  const evidence = row.evidence as CallShieldProvenance[];
  const sourceIds = Array.from(new Set(evidence.map((item) => item.source_id)));
  if (
    sourceIds.length !== 1 ||
    typeof sourceIds[0] !== "string" ||
    !CALLSHIELD_APPROVED_OFFLINE_SOURCES.includes(
      sourceIds[0] as (typeof CALLSHIELD_APPROVED_OFFLINE_SOURCES)[number],
    )
  ) {
    return null;
  }

  const declaration = sourceManifest.sources.find(
    (source) => source.id === sourceIds[0],
  );
  if (!declaration?.redistributable) return null;

  const evidenceIsApproved = evidence.every((item) =>
    item.source_id === declaration.id &&
    item.license === declaration.license &&
    item.attribution === declaration.attribution &&
    typeof item.expires_at_epoch_ms === "number" &&
    Number.isFinite(item.expires_at_epoch_ms) &&
    item.expires_at_epoch_ms > snapshotCutoff
  );
  return evidenceIsApproved ? declaration : null;
}

export function filterCallShieldOfflineFeed(
  upstreamFeed: CallShieldUpstreamFeed,
  sourceManifest: CallShieldSourceManifest,
): CallShieldOfflineFeed {
  if (
    !Number.isInteger(upstreamFeed.version) ||
    upstreamFeed.version < 0 ||
    typeof upstreamFeed.updated !== "string" ||
    !Number.isFinite(Date.parse(`${upstreamFeed.updated}T23:59:59.999Z`)) ||
    !Array.isArray(upstreamFeed.numbers) ||
    !Array.isArray(upstreamFeed.prefixes) ||
    !validSourceManifest(sourceManifest)
  ) {
    throw new Error("CallShield feed or source manifest has an unsupported format.");
  }

  const snapshotCutoff = Date.parse(`${upstreamFeed.updated}T23:59:59.999Z`);
  const selectedNumbers: CallShieldOfflineFeed["numbers"] = [];
  const seenNumbers = new Set<string>();

  for (const row of upstreamFeed.numbers) {
    const source = provenanceForRow(row, sourceManifest, snapshotCutoff);
    if (
      !source ||
      typeof row.number !== "string" ||
      !E164_NUMBER_PATTERN.test(row.number) ||
      typeof row.type !== "string" ||
      !Number.isInteger(row.reports) ||
      (row.reports as number) < 0 ||
      seenNumbers.has(row.number)
    ) {
      continue;
    }
    seenNumbers.add(row.number);
    selectedNumbers.push({
      number: row.number,
      type: row.type,
      reports: row.reports as number,
      sources: [source.id],
    });
  }

  const selectedPrefixes: CallShieldOfflineFeed["prefixes"] = [];
  const seenPrefixes = new Set<string>();
  for (const row of upstreamFeed.prefixes) {
    const source = provenanceForRow(row, sourceManifest, snapshotCutoff);
    if (
      !source ||
      typeof row.prefix !== "string" ||
      !E164_PREFIX_PATTERN.test(row.prefix) ||
      typeof row.type !== "string" ||
      seenPrefixes.has(row.prefix)
    ) {
      continue;
    }
    seenPrefixes.add(row.prefix);
    selectedPrefixes.push({
      prefix: row.prefix,
      type: row.type,
      ...(typeof row.description === "string"
        ? { description: row.description }
        : {}),
      sources: [source.id],
    });
  }

  if (selectedNumbers.length === 0 && selectedPrefixes.length === 0) {
    throw new Error("CallShield provenance filtering selected no approved rows.");
  }

  return {
    version: upstreamFeed.version,
    updated: upstreamFeed.updated,
    sources: Array.from(new Set([
      ...selectedNumbers.flatMap((row) => row.sources),
      ...selectedPrefixes.flatMap((row) => row.sources),
    ])).sort(),
    numbers: selectedNumbers,
    prefixes: selectedPrefixes,
  };
}

export function createCallShieldOfflineManifest(
  feed: CallShieldOfflineFeed,
  sourceManifest: CallShieldSourceManifest,
): CallShieldOfflineManifest {
  if (
    feed.sources.length !== 1 ||
    feed.sources[0] !== CALLSHIELD_APPROVED_OFFLINE_SOURCES[0]
  ) {
    throw new Error("Offline manifest generation requires the reviewed source only.");
  }
  const source = sourceManifest.sources.find(
    (candidate) => candidate.id === feed.sources[0],
  );
  if (!source || !source.redistributable) {
    throw new Error("Selected CallShield data is not marked redistributable.");
  }

  return {
    formatVersion: 1,
    sourceManifestVersion: sourceManifest.version,
    sourceManifestUrl: CALLSHIELD_SOURCE_MANIFEST_URL,
    feedVersion: feed.version,
    updated: feed.updated,
    sha256: createHash("sha256")
      .update(JSON.stringify(feed), "utf8")
      .digest("hex"),
    redistributable: true,
    license: source.license,
    attribution: source.attribution,
    includedSources: [...feed.sources],
    numberCount: feed.numbers.length,
    prefixCount: feed.prefixes.length,
  };
}