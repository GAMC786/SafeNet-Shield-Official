#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const allowedFields = new Set([
  "result",
  "failure_category",
  "node_name",
  "node_owner",
  "node_online",
  "headplane_node_name",
  "headplane_node_visibility",
  "headplane_node_status",
  "headplane_node_owner",
]);

function usage() {
  console.error(
    "Usage: render-headscale-android-mesh-summary.mjs --output FILE [--evidence FILE] [--evidence-url URL]",
  );
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const output = argumentValue(args, "--output");
const evidencePath = argumentValue(args, "--evidence");
const evidenceUrl =
  argumentValue(args, "--evidence-url") ?? "unavailable";

if (!output) {
  usage();
  process.exit(2);
}

const fields = new Map();
if (evidencePath) {
  try {
    for (const line of readFileSync(evidencePath, "utf8").split(/\r?\n/)) {
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator);
      if (!allowedFields.has(key) || fields.has(key)) continue;
      fields.set(key, line.slice(separator + 1).replace(/[\r\n]/g, " ").trim());
    }
  } catch {
    // Missing or unreadable evidence is represented by the bounded BLOCKED result.
  }
}

const rawResult = fields.get("result");
const isPass = rawResult === "PASS";
const result = isPass ? "PASS" : "BLOCKED";
const failureCategory = isPass
  ? "NONE"
  : /^[A-Z0-9_]+$/.test(fields.get("failure_category") ?? "")
    ? fields.get("failure_category")
    : evidencePath
      ? "HEADSCALE_MESH_EVIDENCE_INVALID"
      : "HEADSCALE_MESH_EVIDENCE_MISSING";

const value = (name) => {
  const candidate = fields.get(name);
  return candidate && candidate !== "NOT_RECORDED" && candidate !== "NOT_CONFIGURED"
    ? candidate.slice(0, 160)
    : "NOT_RECORDED";
};

const codeValue = (name) =>
  value(name).replaceAll("\\", "\\\\").replaceAll("`", "\\`");

const headscaleNode = codeValue("node_name");
const headplaneNode = codeValue("headplane_node_name");
const headscaleOwner = codeValue("node_owner");
const headplaneOwner = codeValue("headplane_node_owner");
const ownerComparison =
  isPass && headscaleOwner !== "NOT_RECORDED" && headscaleOwner === headplaneOwner
    ? "PASS"
    : failureCategory === "HEADPLANE_OWNER_MISMATCH"
      ? "MISMATCH"
      : "NOT_RECORDED";

const lines = [
  "### Headplane node ownership verification",
  "",
  `- **Result:** \`${result}\``,
  `- **Bounded evidence:** [Download the Headplane verification report](${evidenceUrl})`,
];

if (!isPass) {
  lines.push(`- **Blocker:** \`${failureCategory}\``);
}

lines.push(
  `- **Verified node identity:** Headscale \`${headscaleNode}\`; Headplane \`${headplaneNode}\``,
  `- **Headplane visibility:** \`${codeValue("headplane_node_visibility")}\``,
  `- **Headplane status:** \`${codeValue("headplane_node_status")}\``,
  `- **Owner comparison:** Headscale \`${headscaleOwner}\`; Headplane \`${headplaneOwner}\`; result \`${ownerComparison}\``,
);

writeFileSync(output, `${lines.join("\n")}\n`);