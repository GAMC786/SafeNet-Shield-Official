#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createSign } from "node:crypto";

const [, , inputPath, outputPath, privateKeyPath] = process.argv;

if (!inputPath || !outputPath || !privateKeyPath) {
  console.error("Usage: sign-apk-signature-update.mjs <catalog.json> <signed-update.json> <private-key.pem>");
  process.exit(1);
}

const catalog = JSON.stringify(JSON.parse(await readFile(inputPath, "utf8")));
const signer = createSign("RSA-SHA256");
signer.update(catalog, "utf8");
signer.end();

const envelope = {
  algorithm: "SHA256withRSA",
  payload: catalog,
  signature: signer.sign(await readFile(privateKeyPath), "base64"),
};

await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");