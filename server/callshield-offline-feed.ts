import { createHash } from "node:crypto";
import offlineFeedJson from "../shared/callshield-offline-feed.json";
import offlineManifestJson from "../shared/callshield-offline-manifest.json";
import type {
  CallShieldOfflineFeed,
  CallShieldOfflineManifest,
} from "./callshield-offline-generator";

export type {
  CallShieldOfflineFeed,
  CallShieldOfflineManifest,
} from "./callshield-offline-generator";

export const CALLSHIELD_OFFLINE_FEED =
  offlineFeedJson as unknown as CallShieldOfflineFeed;
export const CALLSHIELD_OFFLINE_MANIFEST =
  offlineManifestJson as unknown as CallShieldOfflineManifest;

export const CALLSHIELD_APPROVED_OFFLINE_SOURCES = ["github_database"] as const;

export function verifyCallShieldOfflineSnapshot(
  feed: CallShieldOfflineFeed,
  manifest: CallShieldOfflineManifest,
  minimumVersion = 0,
) {
  const approvedSources = new Set<string>(CALLSHIELD_APPROVED_OFFLINE_SOURCES);
  const numberRowsAreApproved = feed.numbers.every((entry) =>
    entry.sources.length === 1 &&
    approvedSources.has(entry.sources[0]) &&
    manifest.includedSources.includes(entry.sources[0])
  );
  const prefixRowsAreApproved = feed.prefixes.every((entry) =>
    entry.sources.length === 1 &&
    approvedSources.has(entry.sources[0]) &&
    manifest.includedSources.includes(entry.sources[0])
  );

  if (
    manifest.formatVersion !== 1 ||
    manifest.sourceManifestVersion !== 1 ||
    !manifest.redistributable ||
    manifest.feedVersion < minimumVersion ||
    manifest.feedVersion !== feed.version ||
    manifest.updated !== feed.updated ||
    !manifest.license.trim() ||
    !manifest.attribution.trim() ||
    manifest.numberCount !== feed.numbers.length ||
    manifest.prefixCount !== feed.prefixes.length ||
    manifest.includedSources.length !== CALLSHIELD_APPROVED_OFFLINE_SOURCES.length ||
    manifest.includedSources.some((source) => !approvedSources.has(source)) ||
    feed.sources.length !== CALLSHIELD_APPROVED_OFFLINE_SOURCES.length ||
    feed.sources.some((source) => !approvedSources.has(source)) ||
    !manifest.includedSources.every((source) => feed.sources.includes(source)) ||
    !feed.sources.every((source) => manifest.includedSources.includes(source)) ||
    !numberRowsAreApproved ||
    !prefixRowsAreApproved
  ) {
    return false;
  }

  const digest = createHash("sha256")
    .update(JSON.stringify(feed), "utf8")
    .digest("hex");
  return digest === manifest.sha256;
}