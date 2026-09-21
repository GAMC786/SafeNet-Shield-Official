import { createHash } from "node:crypto";

export type CallShieldOfflineFeed = {
  version: number;
  updated: string;
  sources: string[];
  numbers: Array<{
    number: string;
    type: string;
    reports: number;
    description: string;
    sources: string[];
  }>;
  prefixes: Array<{
    prefix: string;
    type: string;
    description: string;
  }>;
};

export type CallShieldOfflineManifest = {
  formatVersion: number;
  feedVersion: number;
  updated: string;
  sha256: string;
  redistributable: boolean;
  license: string;
  attribution: string;
  includedSources: string[];
};

// This is intentionally limited to CallShield's explicitly redistributable
// community-report rows. Do not add rows from mixed-source numbers or ranges
// without reviewing source-manifest.json first.
export const CALLSHIELD_OFFLINE_FEED: CallShieldOfflineFeed = {
  version: 41,
  updated: "2026-09-05",
  sources: ["community_reports"],
  numbers: [
    {
      number: "+19057712581",
      type: "spam",
      reports: 7,
      description: "Community reported",
      sources: ["community"],
    },
    {
      number: "+33377145841",
      type: "spam",
      reports: 5,
      description: "Community reported",
      sources: ["community"],
    },
    {
      number: "+436776143525",
      type: "spam",
      reports: 4,
      description: "Community reported",
      sources: ["community"],
    },
    {
      number: "+917003869903",
      type: "spam",
      reports: 4,
      description: "Community reported",
      sources: ["community"],
    },
    {
      number: "+12029942853",
      type: "spam",
      reports: 3,
      description: "Community reported",
      sources: ["community"],
    },
    {
      number: "+19204669303",
      type: "spam",
      reports: 3,
      description: "Community reported",
      sources: ["community"],
    },
  ],
  prefixes: [],
};

export const CALLSHIELD_OFFLINE_MANIFEST: CallShieldOfflineManifest = {
  formatVersion: 1,
  feedVersion: 41,
  updated: "2026-09-05",
  sha256: "66daea9ddd83febdc3d95b6db374e8d1fa5627f55f4fba8e685e8e0c8d624656",
  redistributable: true,
  license: "CallShield database terms",
  attribution: "CallShield community reports",
  includedSources: ["community_reports"],
};

export function verifyCallShieldOfflineSnapshot(
  feed: CallShieldOfflineFeed,
  manifest: CallShieldOfflineManifest,
  minimumVersion = 0,
) {
  if (
    manifest.formatVersion !== 1 ||
    !manifest.redistributable ||
    manifest.feedVersion < minimumVersion ||
    manifest.feedVersion !== feed.version ||
    manifest.updated !== feed.updated ||
    !manifest.license.trim() ||
    !manifest.attribution.trim() ||
    manifest.includedSources.length === 0 ||
    manifest.includedSources.some((source) => source !== "community_reports") ||
    !manifest.includedSources.every((source) => feed.sources.includes(source)) ||
    !feed.sources.every((source) => manifest.includedSources.includes(source)) ||
    !feed.numbers.every((entry) => entry.sources.includes("community"))
  ) {
    return false;
  }

  const digest = createHash("sha256")
    .update(JSON.stringify(feed), "utf8")
    .digest("hex");
  return digest === manifest.sha256;
}
