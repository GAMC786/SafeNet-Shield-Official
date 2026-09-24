#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const allowed = new Set([
  "result", "failure_category", "peer_name", "peer_owner", "peer_online",
  "status_peer_name", "status_peer_online", "client_package",
]);
const args = process.argv.slice(2);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (args.includes("--help") || args.includes("-h")) {
  console.error("Usage: render-netbird-android-mesh-summary.mjs --output FILE [--evidence FILE] [--evidence-url URL]");
  process.exit(0);
}
const output = value("--output");
if (!output) process.exit(2);
const fields = new Map();
const evidence = value("--evidence");
if (evidence) {
  try {
    for (const line of readFileSync(evidence, "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i > 0 && allowed.has(line.slice(0, i)) && !fields.has(line.slice(0, i))) {
        fields.set(line.slice(0, i), line.slice(i + 1).replace(/[\r\n]/g, " ").trim());
      }
    }
  } catch { /* represent unreadable evidence as BLOCKED */ }
}
const pass = fields.get("result") === "PASS";
const category = pass ? "NONE" : /^[A-Z0-9_]+$/.test(fields.get("failure_category") ?? "")
  ? fields.get("failure_category") : evidence ? "NETBIRD_MESH_EVIDENCE_INVALID" : "NETBIRD_MESH_EVIDENCE_MISSING";
const text = (key) => {
  const v = fields.get(key);
  return v && v !== "NOT_RECORDED" && v !== "NOT_CONFIGURED" ? v.slice(0, 160).replaceAll("`", "\\`") : "NOT_RECORDED";
};
const lines = [
  "### NetBird Android peer verification", "",
  `- **Result:** \`${pass ? "PASS" : "BLOCKED"}\``,
  `- **Bounded evidence:** [Download the NetBird verification report](${value("--evidence-url") ?? "unavailable"})`,
];
if (!pass) lines.push(`- **Blocker:** \`${category}\``);
lines.push(
  `- **Verified peer:** NetBird \`${text("peer_name")}\``,
  `- **Management peer status:** \`${text("peer_online")}\`; SafeNet adapter: \`${text("status_peer_online")}\``,
  `- **Owner:** \`${text("peer_owner")}\``,
  `- **Android client package:** \`${text("client_package")}\``,
  "- **Native SafeNet VPN:** `NOT_IMPLEMENTED` (the official NetBird Android client is a separate peer)",
);
writeFileSync(output, `${lines.join("\n")}\n`);