#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const mode = process.argv[2] ?? "dev";
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: npm run headplane:dev | npm run headplane:start");
  process.exit(64);
}

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to run the Headplane companion service.`);
  }
  return value;
};

const validHttpUrl = (name, value) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain embedded credentials.`);
  }
  return url;
};

const yamlString = (value) => JSON.stringify(value);
const headscaleUrl = validHttpUrl("HEADSCALE_URL", required("HEADSCALE_URL"));
const apiKey = required("HEADSCALE_API_KEY");
const cookieSecret = required("HEADPLANE_COOKIE_SECRET");
if (cookieSecret.length !== 32) {
  throw new Error("HEADPLANE_COOKIE_SECRET must be exactly 32 characters.");
}

const port = Number.parseInt(process.env.HEADPLANE_PORT ?? "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("HEADPLANE_PORT must be a valid TCP port.");
}

const configuredPublicUrl = process.env.HEADPLANE_URL?.trim();
const publicUrl = configuredPublicUrl
  ? validHttpUrl("HEADPLANE_URL", configuredPublicUrl)
  : new URL(`http://127.0.0.1:${port}/admin`);
const baseUrl = process.env.HEADPLANE_BASE_URL?.trim()
  ? validHttpUrl("HEADPLANE_BASE_URL", process.env.HEADPLANE_BASE_URL.trim())
  : new URL(publicUrl.toString().replace(/\/admin\/?$/, ""));
const cookieSecure = (process.env.HEADPLANE_COOKIE_SECURE ?? (baseUrl.protocol === "https:" ? "true" : "false")) === "true";
const dataPath = path.resolve(process.env.HEADPLANE_DATA_PATH ?? "headplane/.runtime/data");
const configPath = path.resolve("headplane/.runtime/config.yaml");

await mkdir(path.dirname(configPath), { recursive: true });
await mkdir(dataPath, { recursive: true });
await writeFile(
  configPath,
  [
    "server:",
    "  host: \"0.0.0.0\"",
    `  port: ${port}`,
    `  base_url: ${yamlString(baseUrl.toString().replace(/\/$/, ""))}`,
    `  cookie_secret: ${yamlString(cookieSecret)}`,
    `  cookie_secure: ${cookieSecure}`,
    `  data_path: ${yamlString(dataPath)}`,
    "headscale:",
    `  url: ${yamlString(headscaleUrl.toString().replace(/\/$/, ""))}`,
    `  public_url: ${yamlString(headscaleUrl.toString().replace(/\/$/, ""))}`,
    `  api_key: ${yamlString(apiKey)}`,
    "integration:",
    "  agent:",
    "    enabled: false",
    "  docker:",
    "    enabled: false",
    "  kubernetes:",
    "    enabled: false",
    "    pod_name: \"headscale\"",
    "  proc:",
    "    enabled: false",
    "",
  ].join("\n"),
  { mode: 0o600 },
);

const args = mode === "dev"
  ? ["--dir", "headplane", "exec", "react-router", "dev"]
  : ["--dir", "headplane", "start"];

console.log(`Starting Headplane ${mode} on ${baseUrl.toString().replace(/\/$/, "")}/admin`);
const child = spawn("pnpm", args, {
  env: {
    ...process.env,
    HEADPLANE_CONFIG_PATH: configPath,
  },
  stdio: "inherit",
});

const forwardSignal = (signal) => child.kill(signal);
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});