import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requiredValues = [
  "SAFENET_WIREGUARD_GATEWAY_ENDPOINT",
  "SAFENET_WIREGUARD_GATEWAY_OWNER",
  "SAFENET_WIREGUARD_PEER_PUBLIC_KEY",
  "SAFENET_WIREGUARD_CLIENT_PRIVATE_KEY",
  "SAFENET_WIREGUARD_CLIENT_ADDRESS",
  "SAFENET_WIREGUARD_ALLOWED_IPS",
  "SAFENET_WIREGUARD_DNS_SERVERS",
  "SAFENET_WIREGUARD_PERSISTENT_KEEPALIVE",
];

const buildGradle = await readFile(
  new URL("../android/app/build.gradle", import.meta.url),
  "utf8",
);
const mainWorkflow = await readFile(
  new URL("../.github/workflows/build.yml", import.meta.url),
  "utf8",
);
const apkOnlyWorkflow = await readFile(
  new URL("../.github/workflows/build-apk-only.yml", import.meta.url),
  "utf8",
);
const pluginSource = await readFile(
  new URL("../android/app/src/main/java/com/safenet/dns/SafeNetVpnPlugin.java", import.meta.url),
  "utf8",
);
const buildInstructions = await readFile(
  new URL("../BUILD_INSTRUCTIONS.md", import.meta.url),
  "utf8",
);

test("Gradle exposes the complete SafeNet WireGuard build configuration", () => {
  for (const value of requiredValues) {
    assert.match(
      buildGradle,
      new RegExp(`"${value}"`),
      `${value} must be available to the native build`,
    );
  }
});

test("release workflows source every WireGuard value from protected secrets", () => {
  for (const [name, workflow, minimumOccurrences] of [
    ["main Android workflow", mainWorkflow, 3],
    ["APK-only workflow", apkOnlyWorkflow, 2],
  ]) {
    for (const value of requiredValues) {
      assert.equal(
        workflow.split(`secrets.${value}`).length - 1 >= minimumOccurrences,
        true,
        `${name} must validate and pass ${value} to every release Gradle build`,
      );
    }
  }
});

test("the client private key is not available during the web asset build", () => {
  const webBuildSection = mainWorkflow.slice(
    mainWorkflow.indexOf("- name: Build and sync mobile web assets"),
    mainWorkflow.indexOf("- name: Decode Android release keystore"),
  );
  assert.equal(webBuildSection.includes("SAFENET_WIREGUARD_CLIENT_PRIVATE_KEY"), false);
  assert.equal(webBuildSection.includes("secrets.SAFENET_WIREGUARD_"), false);
});

test("configured status reports gateway identity but never private material", () => {
  for (const field of [
    "wireguardGateway",
    "wireguardGatewayOwner",
    "wireguardPeerPublicKey",
    "wireguardAllowedIps",
    "wireguardDnsServers",
  ]) {
    assert.match(pluginSource, new RegExp(`"${field}"`));
  }
  assert.equal(pluginSource.includes("wireguardClientPrivateKey"), false);
  for (const value of requiredValues) {
    assert.match(buildInstructions, new RegExp(value));
  }
  assert.match(
    buildInstructions,
    /private key is passed only to\s+Gradle's native build configuration,\s+never to the web build or frontend\s+assets/i,
  );
});