import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createCallShieldOfflineManifest,
  filterCallShieldOfflineFeed,
} from "../server/callshield-offline-generator.ts";

const [upstreamFeedPath, sourceManifestPath] = process.argv.slice(2);
if (!upstreamFeedPath || !sourceManifestPath) {
  console.error(
    "Usage: npm run callshield:offline-snapshot -- <spam_numbers.json> <source-manifest.json>",
  );
  process.exit(2);
}

const upstreamFeed = JSON.parse(await readFile(upstreamFeedPath, "utf8"));
const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
const feed = filterCallShieldOfflineFeed(upstreamFeed, sourceManifest);
const manifest = createCallShieldOfflineManifest(feed, sourceManifest);
const feedJson = JSON.stringify(feed);
const manifestJson = JSON.stringify(manifest);
const root = process.cwd();
const targets = [
  {
    feed: path.join(root, "shared/callshield-offline-feed.json"),
    manifest: path.join(root, "shared/callshield-offline-manifest.json"),
  },
  {
    feed: path.join(root, "android/app/src/main/assets/callshield/spam_numbers.json"),
    manifest: path.join(root, "android/app/src/main/assets/callshield/manifest.json"),
  },
];

for (const target of targets) {
  await mkdir(path.dirname(target.feed), { recursive: true });
  await writeFile(target.feed, feedJson);
  await writeFile(target.manifest, manifestJson);
}

console.log(
  `CallShield offline snapshot v${feed.version}: ${feed.numbers.length} numbers, ` +
    `${feed.prefixes.length} prefixes, SHA-256 ${manifest.sha256}`,
);