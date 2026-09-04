import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

const baseUrl = process.env.AUTH_SMOKE_BASE_URL;
const storageState = process.env.AUTH_SMOKE_STORAGE_STATE;
const googleEmail = process.env.AUTH_SMOKE_GOOGLE_EMAIL;
const googlePassword = process.env.AUTH_SMOKE_GOOGLE_PASSWORD;
const hasGoogleCredentials = Boolean(googleEmail && googlePassword);
const isConfigured = Boolean(baseUrl && (storageState || hasGoogleCredentials));
const isHealthCheck = process.env.AUTH_SMOKE_HEALTH_CHECK === "true";

function appUrl(pathname) {
  if (!baseUrl) throw new Error("AUTH_SMOKE_BASE_URL is required.");
  return new URL(pathname, baseUrl).toString();
}

function parseStorageState() {
  if (!storageState) return undefined;

  try {
    return JSON.parse(storageState);
  } catch {
    throw new Error(
      "AUTH_SMOKE_STORAGE_STATE must contain valid Playwright storage-state JSON.",
    );
  }
}

async function completeGoogleSignIn(page, context) {
  await page.goto(appUrl("/sign-in"), { waitUntil: "domcontentloaded" });

  const googleButton = page.getByRole("button", { name: /google/i }).first();
  await googleButton.waitFor({ state: "visible", timeout: 30000 });

  const popupPromise = context
    .waitForEvent("page", { timeout: 3000 })
    .catch(() => undefined);
  await googleButton.click();
  const popup = await popupPromise;
  const providerPage = popup || page;

  const emailInput = providerPage.locator('input[type="email"]');
  await emailInput.waitFor({ state: "visible", timeout: 30000 });
  await emailInput.fill(googleEmail);
  await providerPage.getByRole("button", { name: /^next$/i }).click();

  const passwordInput = providerPage.locator('input[type="password"]');
  await passwordInput.waitFor({ state: "visible", timeout: 30000 });
  await passwordInput.fill(googlePassword);
  await providerPage.getByRole("button", { name: /^next$/i }).click();

  // A test Google account may require one consent screen on its first use.
  // Do not fail if the account is already approved and this control is absent.
  const continueButton = providerPage.getByRole("button", {
    name: /^(allow|continue)$/i,
  });
  if (await continueButton.count()) {
    await continueButton.first().click().catch(() => {});
  }

  await page.waitForURL(
    (url) =>
      url.origin === new URL(baseUrl).origin &&
      !url.pathname.includes("/sign-in"),
    { timeout: 120000 },
  );
}

async function assertAuthenticatedDashboard(page) {
  await page.getByRole("heading", { name: "Command Center" }).waitFor({
    state: "visible",
    timeout: 30000,
  });
  await page.getByRole("button", { name: /sign out/i }).waitFor({
    state: "visible",
    timeout: 30000,
  });
}

test(
  isHealthCheck
    ? "Configured Clerk authentication can load the SafeNet dashboard"
    : "Google callback loads the SafeNet dashboard and sign-out returns to public access",
  { skip: !isConfigured ? "Configure the auth smoke test environment first." : false },
  async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState: parseStorageState(),
    });
    const page = await context.newPage();

    try {
      if (hasGoogleCredentials && !storageState) {
        await completeGoogleSignIn(page, context);
      } else {
        // The recorded state is produced only after completing Google sign-in
        // with the non-production test account. The fresh context keeps the
        // session isolated from other browser runs.
        await page.goto(appUrl("/"), { waitUntil: "domcontentloaded" });
      }

      await assertAuthenticatedDashboard(page);

      if (isHealthCheck) {
        // A health check deliberately stops after proving that the configured
        // session is still accepted. It must not mutate the account or write
        // the session state anywhere in the workspace.
        return;
      }

      await page.getByRole("button", { name: /sign out/i }).click();
      await page.getByRole("link", { name: "Sign in with Google" }).waitFor({
        state: "visible",
        timeout: 30000,
      });
      assert.equal(
        await page.getByRole("link", { name: "Sign in with Google" }).count(),
        1,
        "sign-out should return to the public SafeNet access screen",
      );
    } finally {
      await context.close();
      await browser.close();
    }
  },
);