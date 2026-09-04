import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.AUTH_SMOKE_BASE_URL;
const outputPath = path.resolve(
  process.env.AUTH_SMOKE_RECORD_PATH || ".auth/safenet-auth-state.json",
);

if (!baseUrl) {
  throw new Error("AUTH_SMOKE_BASE_URL is required.");
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

try {
  console.log("Complete Google sign-in in the opened browser window.");
  console.log("The fixture will be saved locally after the SafeNet dashboard loads.");
  await page.goto(new URL("/sign-in", baseUrl), { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Welcome back" }).waitFor({
    state: "visible",
    timeout: 30000,
  });
  await page.getByRole("heading", { name: "Command Center" }).waitFor({
    state: "visible",
    timeout: 300000,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(await context.storageState(), null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(outputPath, 0o600);
  console.log(`Saved the auth fixture to ${outputPath}.`);
  console.log(
    "This file contains a live non-production session. Keep it out of version control; update the AUTH_SMOKE_STORAGE_STATE secret from its contents without printing or committing the JSON.",
  );
} finally {
  await context.close();
  await browser.close();
}