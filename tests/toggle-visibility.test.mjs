import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { chromium } from "playwright";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.UI_TEST_PORT || 4173);
const baseUrl = process.env.UI_TEST_BASE_URL || `http://127.0.0.1:${port}`;
const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "narrow", width: 390, height: 844 },
];

let browser;
let viteProcess;

async function waitForServer(url) {
  const deadline = Date.now() + 30000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Vite did not start at ${url}: ${lastError?.message || "timed out"}`);
}

async function startVite() {
  if (process.env.UI_TEST_BASE_URL) return;

  const viteBin = path.join(rootDirectory, "node_modules", "vite", "bin", "vite.js");
  await readFile(viteBin);
  viteProcess = spawn(
    process.execPath,
    [viteBin, "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: rootDirectory,
      env: { ...process.env, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  viteProcess.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  viteProcess.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  viteProcess.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      output += `\nVite exited with code ${code}${signal ? ` (${signal})` : ""}.`;
    }
  });

  try {
    await waitForServer(baseUrl);
  } catch (error) {
    throw new Error(`${error.message}\n${output}`);
  }
}

function mockApi(page, { ddnsUpdateResponses = [], threatFeedUpdateResponses = [] } = {}) {
  let settings = {
    id: 1,
    pinRecoveryEmail: null,
    pinConfigured: true,
    isPinEnabled: true,
    aiShieldEnabled: true,
    alwaysOnEnabled: false,
    deviceAdminEnabled: false,
    firewallEnabled: false,
    theme: "red-gray-blue",
  };
  let dnsServers = [
    {
      id: 1,
      name: "SafeNet Default",
      type: "doh",
      primaryAddress: "https://dns.google/dns-query",
      secondaryAddress: "https://cloudflare-dns.com/dns-query",
      isActive: true,
      isCustom: false,
    },
    {
      id: 2,
      name: "Backup Resolver",
      type: "plain",
      primaryAddress: "94.140.14.14",
      secondaryAddress: "94.140.15.15",
      isActive: false,
      isCustom: true,
    },
  ];
  let antivirusSettings = {
    id: 1,
    isEnabled: true,
    realTimeProtection: true,
    malwareDomainBlocking: true,
    phishingProtection: true,
    downloadScanning: true,
    threatSensitivity: "medium",
    autoQuarantine: true,
    lastScanTime: null,
    lastUpdateTime: null,
  };
  const threatFeeds = [
    {
      id: 1,
      name: "SafeNet Malware Feed",
      url: "https://feeds.example.com/malware",
      type: "malware",
      isEnabled: true,
      lastSync: null,
      entriesCount: 128,
    },
    {
      id: 2,
      name: "SafeNet Phishing Feed",
      url: "https://feeds.example.com/phishing",
      type: "phishing",
      isEnabled: true,
      lastSync: null,
      entriesCount: 64,
    },
  ];
  const antivirusEvents = [];
  const antivirusStats = {
    totalThreats: 0,
    blockedToday: 0,
    activeFeeds: 2,
  };
  let ddnsUpdateAttempt = 0;
  let threatFeedUpdateAttempt = 0;
  const updaters = [
    {
      id: 1,
      hostname: "home.example.com",
      provider: "duckdns",
      lastIpAddress: null,
      lastUpdateTime: null,
      isEnabled: true,
      updateInterval: 3600000,
    },
    {
      id: 2,
      hostname: "backup.example.com",
      provider: "noip",
      lastIpAddress: null,
      lastUpdateTime: null,
      isEnabled: false,
      updateInterval: 3600000,
    },
  ];

  return Promise.all([
    page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      let response;

      if (url.pathname === "/api/auth/status") {
        response = { authenticated: true, pinRequired: true };
      } else if (url.pathname === "/api/settings" && method === "GET") {
        response = settings;
      } else if (url.pathname === "/api/settings" && method === "PUT") {
        settings = { ...settings, ...JSON.parse(request.postData() || "{}") };
        response = settings;
      } else if (url.pathname === "/api/dns" && method === "GET") {
        response = dnsServers;
      } else if (url.pathname === "/api/dns" && method === "POST") {
        const input = JSON.parse(request.postData() || "{}");
        const server = {
          ...input,
          id: Math.max(...dnsServers.map((candidate) => candidate.id), 0) + 1,
          isActive: Boolean(input.isActive),
          isCustom: input.isCustom ?? true,
        };
        if (server.isActive) {
          dnsServers = dnsServers.map((candidate) => ({ ...candidate, isActive: false }));
        }
        dnsServers = [...dnsServers, server];
        response = server;
      } else if (url.pathname.startsWith("/api/dns/") && method === "PUT") {
        const id = Number(url.pathname.split("/").at(-1));
        const update = JSON.parse(request.postData() || "{}");
        dnsServers = dnsServers.map((server) => server.id === id ? { ...server, ...update } : server);
        response = dnsServers.find((server) => server.id === id);
      } else if (url.pathname.startsWith("/api/dns/") && method === "DELETE") {
        const id = Number(url.pathname.split("/").at(-1));
        dnsServers = dnsServers.filter((server) => server.id !== id);
        await route.fulfill({ status: 204, body: "" });
        return;
      } else if (url.pathname.startsWith("/api/dns/") && url.pathname.endsWith("/activate") && method === "POST") {
        const id = Number(url.pathname.split("/").at(-2));
        dnsServers = dnsServers.map((server) => ({ ...server, isActive: server.id === id }));
        response = dnsServers.find((server) => server.id === id);
      } else if (url.pathname === "/api/antivirus/settings" && method === "GET") {
        response = antivirusSettings;
      } else if (url.pathname === "/api/antivirus/settings" && method === "PUT") {
        const update = JSON.parse(request.postData() || "{}");
        if (update.malwareDomainBlocking === false) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ message: "Antivirus settings are temporarily unavailable" }),
          });
          return;
        }
        antivirusSettings = { ...antivirusSettings, ...update };
        response = antivirusSettings;
      } else if (url.pathname === "/api/speedtest/ping" && method === "GET") {
        await new Promise((resolve) => setTimeout(resolve, 50));
        response = { timestamp: Date.now() };
      } else if (url.pathname === "/api/speedtest/download" && method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/octet-stream",
          headers: { "cache-control": "no-store" },
          body: Buffer.alloc(Number(url.searchParams.get("size")) || 100000),
        });
        return;
      } else if (url.pathname === "/api/speedtest/upload" && method === "POST") {
        response = { bytesReceived: 1500000, duration: 0.01, speedMbps: 1200 };
      } else if (url.pathname === "/api/antivirus/feeds" && method === "GET") {
        response = threatFeeds;
      } else if (url.pathname.startsWith("/api/antivirus/feeds/") && method === "PATCH") {
        const configuredResponse = threatFeedUpdateResponses[threatFeedUpdateAttempt];
        threatFeedUpdateAttempt += 1;
        if (configuredResponse) {
          if (configuredResponse.delayMs) {
            await new Promise((resolve) => setTimeout(resolve, configuredResponse.delayMs));
          }
          if (configuredResponse.feedState) {
            const id = Number(url.pathname.split("/").at(-1));
            const feed = threatFeeds.find((candidate) => candidate.id === id);
            if (feed) Object.assign(feed, configuredResponse.feedState);
          }
          await route.fulfill({
            status: configuredResponse.status,
            contentType: "application/json",
            body: configuredResponse.rawBody ?? JSON.stringify(configuredResponse.body),
          });
          return;
        }
        const id = Number(url.pathname.split("/").at(-1));
        const feed = threatFeeds.find((candidate) => candidate.id === id);
        if (feed) {
          Object.assign(feed, JSON.parse(request.postData() || "{}"));
        }
        response = feed;
      } else if (url.pathname === "/api/antivirus/events" && method === "GET") {
        response = antivirusEvents;
      } else if (url.pathname === "/api/antivirus/stats" && method === "GET") {
        response = antivirusStats;
      } else if (url.pathname === "/api/ddns" && method === "GET") {
        response = updaters;
      } else if (url.pathname === "/api/ddns/update-all" && method === "POST") {
        const configuredResponse = ddnsUpdateResponses[ddnsUpdateAttempt] || { status: 200, body: {} };
        ddnsUpdateAttempt += 1;
        await route.fulfill({
          status: configuredResponse.status,
          contentType: "application/json",
          body: JSON.stringify(configuredResponse.body),
        });
        return;
      } else if (url.pathname.startsWith("/api/ddns/") && method === "PATCH") {
        const updater = updaters.find((candidate) => String(candidate.id) === url.pathname.split("/").pop());
        if (updater) {
          Object.assign(updater, JSON.parse(request.postData() || "{}"));
        }
        response = updater;
      } else {
        response = {};
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    }),
    page.route("https://api.ipify.org/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      }),
    ),
  ]);
}

async function waitForAttribute(locator, attribute, expected) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await locator.getAttribute(attribute)) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(await locator.getAttribute(attribute), expected);
}

async function focusWithKeyboard(page, locator) {
  await page.locator("body").focus();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await locator.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  assert.fail(`Could not focus ${await locator.getAttribute("aria-label")} with keyboard navigation`);
}

async function assertNoHorizontalOverflow(page, viewportName) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert.ok(
    dimensions.document <= dimensions.viewport,
    `${viewportName} layout overflows horizontally (${dimensions.document}px > ${dimensions.viewport}px)`,
  );
}

before(async () => {
  await startVite();
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (viteProcess) {
    viteProcess.kill("SIGTERM");
    await once(viteProcess, "exit").catch(() => {});
  }
});

for (const viewport of viewports) {
  test(`Settings toggle visibility and states at ${viewport.name} width`, async () => {
    const page = await browser.newPage({ viewport });
    await mockApi(page);
    await page.goto(`${baseUrl}/settings`);
    await page.getByRole("heading", { name: "System Settings" }).waitFor();
    await assertNoHorizontalOverflow(page, viewport.name);

    const expectedStates = new Map([
      ["AI Shield", "true"],
      ["App Firewall", "false"],
      ["Always-On VPN", "false"],
      ["Device Admin", "false"],
      ["PIN Protection", "true"],
    ]);
    const backgroundColors = new Set();

    for (const [name, expectedState] of expectedStates) {
      const toggle = page.getByRole("switch", { name });
      assert.equal(await toggle.count(), 1, `${name} must expose one accessible switch`);
      assert.equal(await toggle.getAttribute("aria-checked"), expectedState);
      const box = await toggle.boundingBox();
      assert.ok(box && box.width >= 64 && box.height >= 40, `${name} switch is too small to be visible`);
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, `${name} switch is clipped`);

      const colors = await toggle.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, border: style.borderColor };
      });
      assert.notEqual(colors.background, "rgba(0, 0, 0, 0)", `${name} needs a visible background`);
      assert.notEqual(colors.border, "rgba(0, 0, 0, 0)", `${name} needs a visible border`);
      backgroundColors.add(colors.background);
    }

    assert.ok(backgroundColors.size >= 2, "checked and unchecked switches must have distinguishable colors");

    const firewall = page.getByRole("switch", { name: "App Firewall" });
    await focusWithKeyboard(page, firewall);
    assert.equal(await firewall.evaluate((element) => element === document.activeElement), true);
    assert.notEqual(
      await firewall.evaluate((element) => getComputedStyle(element).boxShadow),
      "none",
      "keyboard-focused switches need a visible focus ring",
    );

    await firewall.click();
    await firewall.waitFor({ state: "attached" });
    for (let attempt = 0; attempt < 20 && (await firewall.getAttribute("aria-checked")) !== "true"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(await firewall.getAttribute("aria-checked"), "true", "unchecked switch should become checked");

    for (const [name, expectedState] of [
      ["AI Shield", "false"],
      ["Always-On VPN", "true"],
      ["Device Admin", "true"],
      ["PIN Protection", "false"],
    ]) {
      const toggle = page.getByRole("switch", { name });
      await toggle.click();
      await waitForAttribute(toggle, "aria-checked", expectedState);
    }

    const browserVpn = page.getByRole("switch", { name: "DNS Protection VPN unavailable in web browser" });
    assert.equal(await browserVpn.isDisabled(), true);
    await page.close();
  });

  test(`DDNS toggle visibility and states at ${viewport.name} width`, async () => {
    const page = await browser.newPage({ viewport });
    await mockApi(page);
    await page.goto(`${baseUrl}/ddns`);
      await page.getByRole("heading", { name: "DDNS" }).waitFor();
    await assertNoHorizontalOverflow(page, viewport.name);

    const activeToggle = page.getByRole("button", { name: "Disable home.example.com" });
    const inactiveToggle = page.getByRole("button", { name: "Enable backup.example.com" });
    assert.equal(await activeToggle.getAttribute("aria-pressed"), "true");
    assert.equal(await inactiveToggle.getAttribute("aria-pressed"), "false");

    await activeToggle.click();
    const enableHome = page.getByRole("button", { name: "Enable home.example.com" });
    await enableHome.waitFor();
    assert.equal(await enableHome.getAttribute("aria-pressed"), "false");
    await enableHome.click();
    await page.getByRole("button", { name: "Disable home.example.com" }).waitFor();

    for (const [name, toggle] of [
      ["active DDNS toggle", activeToggle],
      ["inactive DDNS toggle", inactiveToggle],
    ]) {
      const box = await toggle.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 40, `${name} is too small to be visible`);
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, `${name} is clipped`);
      assert.notEqual(
        await toggle.evaluate((element) => getComputedStyle(element).borderColor),
        "rgba(0, 0, 0, 0)",
        `${name} needs a visible border`,
      );
    }

    const autoMode = page.getByRole("button", { name: "Switch to Auto" });
    assert.equal(await autoMode.getAttribute("aria-pressed"), "false");
    await autoMode.click();
    await page.getByRole("button", { name: "Auto Mode On" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Auto Mode On" }).getAttribute("aria-pressed"), "true");
    const enabledBackupToggle = page.getByRole("button", { name: "Disable backup.example.com" });
    await enabledBackupToggle.waitFor();
    await focusWithKeyboard(page, enabledBackupToggle);
    assert.equal(await enabledBackupToggle.evaluate((element) => element === document.activeElement), true);
    assert.notEqual(
      await enabledBackupToggle.evaluate((element) => getComputedStyle(element).boxShadow),
      "none",
      "keyboard-focused DDNS toggles need a visible focus ring",
    );

    await page.getByRole("button", { name: "Add DDNS" }).click();
    await page.getByRole("heading", { name: "New DDNS Updater" }).waitFor();
    const intervalInput = page.locator('input[type="number"]');
    assert.equal(await intervalInput.inputValue(), "3600000");
    await page.keyboard.press("Escape");
    await page.close();
  });
}

test("DNS resolver management supports activation and CRUD controls", async () => {
  const page = await browser.newPage({ viewport: viewports[0] });
  await mockApi(page);
  await page.goto(`${baseUrl}/dns`);
  await page.getByRole("heading", { name: "DNS Servers" }).waitFor();

  const safeNetCard = page.getByRole("heading", { name: "SafeNet Default" }).locator("xpath=ancestor::div[contains(@class, 'glass-panel')][1]");
  const backupCard = page.getByRole("heading", { name: "Backup Resolver" }).locator("xpath=ancestor::div[contains(@class, 'glass-panel')][1]");
  const useBackup = backupCard.getByRole("button", { name: "Use This" });
  await safeNetCard.getByRole("button", { name: "Active" }).waitFor();
  await useBackup.waitFor();

  await useBackup.click();

  await waitForAttribute(backupCard.getByRole("button", { name: "Active" }), "disabled", "");
  assert.equal(await backupCard.getByRole("button", { name: "Active" }).count(), 1);
  assert.equal(await safeNetCard.getByRole("button", { name: "Use This" }).count(), 1);

  await page.getByRole("button", { name: "Add a Resolver" }).click();
  await page.getByRole("heading", { name: "Add a Resolver" }).waitFor();
  await page.getByTestId("input-resolver-name").fill("Family Resolver");
  await page.getByTestId("input-resolver-primary").fill("1.1.1.3");
  await page.getByTestId("input-resolver-secondary").fill("1.0.0.3");
  await page.getByRole("button", { name: "Add Resolver" }).click();
  const familyCard = page.getByRole("heading", { name: "Family Resolver" }).locator("xpath=ancestor::div[contains(@class, 'glass-panel')][1]");
  await familyCard.waitFor();
  await familyCard.getByRole("button", { name: "Edit Family Resolver" }).click();
  await page.getByTestId("input-resolver-name").fill("Updated Family Resolver");
  await page.getByRole("button", { name: "Save Changes" }).click();
  const updatedFamilyCard = page.getByRole("heading", { name: "Updated Family Resolver" }).locator("xpath=ancestor::div[contains(@class, 'glass-panel')][1]");
  await updatedFamilyCard.waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await updatedFamilyCard.getByRole("button", { name: "Remove Updated Family Resolver" }).click();
  await updatedFamilyCard.waitFor({ state: "detached" });
  await page.close();
});

test("Antivirus switches show success and recover after an update error", async () => {
  const page = await browser.newPage({ viewport: viewports[0] });
  await mockApi(page);
  await page.goto(`${baseUrl}/antivirus`);
  await page.getByRole("heading", { name: "Built-In Antivirus" }).waitFor();

  const protectionSwitch = page.getByTestId("switch-antivirus-enabled");
  await waitForAttribute(protectionSwitch, "aria-checked", "true");
  await protectionSwitch.click();
  await waitForAttribute(protectionSwitch, "aria-checked", "false");

  await page.getByRole("tab", { name: "Settings" }).click();
  const malwareSwitch = page.getByTestId("switch-malware-settings");
  await waitForAttribute(malwareSwitch, "aria-checked", "true");
  await malwareSwitch.click();
  await waitForAttribute(malwareSwitch, "aria-checked", "false");
  await page.getByText("Malware domain blocking could not be changed", { exact: true }).waitFor();
  await waitForAttribute(malwareSwitch, "aria-checked", "true");
  await page.close();
});

test("Antivirus threat-feed switches roll back after an update error without browser errors", async () => {
  const page = await browser.newPage({ viewport: viewports[0] });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await mockApi(page, {
    threatFeedUpdateResponses: [
      {
        status: 200,
        rawBody: "{\"message\":\"Threat feed service is temporarily unavailable\"",
        delayMs: 150,
      },
    ],
  });
  await page.goto(`${baseUrl}/antivirus`);
  await page.getByRole("heading", { name: "Built-In Antivirus" }).waitFor();
  await page.getByRole("tab", { name: "Threat Feeds" }).click();

  const feedSwitch = page.getByTestId("switch-feed-1");
  await waitForAttribute(feedSwitch, "aria-checked", "true");
  const updateRequest = page.waitForRequest((request) =>
    request.method() === "PATCH" && request.url().includes("/api/antivirus/feeds/1"),
  );
  await feedSwitch.click();
  await updateRequest;
  assert.equal(await feedSwitch.isDisabled(), true, "the active feed toggle should lock while saving");
  await waitForAttribute(feedSwitch, "aria-checked", "false");
  await page.getByText("Threat feed could not be updated", { exact: true }).waitFor();
  await waitForAttribute(feedSwitch, "aria-checked", "true");
  assert.equal(await feedSwitch.isDisabled(), false, "the feed toggle should unlock after rollback");

  assert.deepEqual(
    pageErrors,
    [],
    `threat-feed rollback should not throw page errors: ${pageErrors.join("; ")}`,
  );
  assert.deepEqual(
    consoleErrors,
    [],
    `threat-feed rollback should not log console errors: ${consoleErrors.join("; ")}`,
  );
  await page.close();
});

test("Antivirus threat-feed switches keep the newest response after rapid updates", async () => {
  const page = await browser.newPage({ viewport: viewports[0] });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await mockApi(page, {
    threatFeedUpdateResponses: [
      {
        status: 200,
        body: {
          id: 1,
          name: "SafeNet Malware Feed",
          url: "https://feeds.example.com/malware",
          type: "malware",
          isEnabled: false,
          lastSync: null,
          entriesCount: 128,
        },
        delayMs: 200,
      },
      {
        status: 200,
        body: {
          id: 1,
          name: "SafeNet Malware Feed",
          url: "https://feeds.example.com/malware",
          type: "malware",
          isEnabled: true,
          lastSync: null,
          entriesCount: 128,
        },
      },
    ],
  });
  await page.goto(`${baseUrl}/antivirus`);
  await page.getByRole("heading", { name: "Built-In Antivirus" }).waitFor();
  await page.getByRole("tab", { name: "Threat Feeds" }).click();

  const feedSwitch = page.getByTestId("switch-feed-1");
  await waitForAttribute(feedSwitch, "aria-checked", "true");
  const firstRequest = page.waitForRequest((request) =>
    request.method() === "PATCH" && request.url().includes("/api/antivirus/feeds/1"),
  );
  await feedSwitch.click();
  await firstRequest;
  await waitForAttribute(feedSwitch, "aria-checked", "false");

  const secondRequest = page.waitForRequest((request) =>
    request.method() === "PATCH" && request.url().includes("/api/antivirus/feeds/1"),
  );
  await feedSwitch.click();
  await secondRequest;
  await waitForAttribute(feedSwitch, "aria-checked", "true");

  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(
    await feedSwitch.getAttribute("aria-checked"),
    "true",
    "a stale response must not restore the earlier optimistic state",
  );
  assert.deepEqual(
    pageErrors,
    [],
    `rapid threat-feed updates should not throw page errors: ${pageErrors.join("; ")}`,
  );
  assert.deepEqual(
    consoleErrors,
    [],
    `rapid threat-feed updates should not log console errors: ${consoleErrors.join("; ")}`,
  );
  await page.close();
});

test("Antivirus threat-feed switches keep each row correct when updates overlap", async () => {
  const page = await browser.newPage({ viewport: viewports[0] });
  const consoleErrors = [];
  const pageErrors = [];
  const completedUpdates = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() === "PATCH" && request.url().includes("/api/antivirus/feeds/")) {
      completedUpdates.push(request.url());
    }
  });

  await mockApi(page, {
    threatFeedUpdateResponses: [
      {
        status: 200,
        rawBody: "{\"message\":\"Threat feed service is temporarily unavailable\"",
        delayMs: 1000,
      },
      {
        status: 200,
        body: {
          id: 2,
          name: "SafeNet Phishing Feed",
          url: "https://feeds.example.com/phishing",
          type: "phishing",
          isEnabled: false,
          lastSync: null,
          entriesCount: 64,
        },
        feedState: { isEnabled: false },
        delayMs: 500,
      },
    ],
  });
  await page.goto(`${baseUrl}/antivirus`);
  await page.getByRole("heading", { name: "Built-In Antivirus" }).waitFor();
  await page.getByRole("tab", { name: "Threat Feeds" }).click();

  const malwareSwitch = page.getByTestId("switch-feed-1");
  const phishingSwitch = page.getByTestId("switch-feed-2");
  await waitForAttribute(malwareSwitch, "aria-checked", "true");
  await waitForAttribute(phishingSwitch, "aria-checked", "true");

  const firstRequest = page.waitForRequest((request) =>
    request.method() === "PATCH" && request.url().includes("/api/antivirus/feeds/1"),
  );
  const firstResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/api/antivirus/feeds/1"),
  );
  await malwareSwitch.click();
  await firstRequest;
  await waitForAttribute(malwareSwitch, "aria-checked", "false");

  const secondRequest = page.waitForRequest((request) =>
    request.method() === "PATCH" && request.url().includes("/api/antivirus/feeds/2"),
  );
  const secondResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/api/antivirus/feeds/2"),
  );
  await phishingSwitch.click();
  await secondRequest;
  await waitForAttribute(phishingSwitch, "aria-checked", "false");
  assert.deepEqual(completedUpdates, [], "both feed updates should still be pending after the second request starts");

  await Promise.all([firstResponse, secondResponse]);
  await page.getByText("Threat feed could not be updated", { exact: true }).waitFor();
  await waitForAttribute(malwareSwitch, "aria-checked", "true");
  await waitForAttribute(phishingSwitch, "aria-checked", "false");

  assert.deepEqual(
    pageErrors,
    [],
    `overlapping threat-feed updates should not throw page errors: ${pageErrors.join("; ")}`,
  );
  assert.deepEqual(
    consoleErrors,
    [],
    `overlapping threat-feed updates should not log console errors: ${consoleErrors.join("; ")}`,
  );
  await page.close();
});

test("SafeNet wave speed test completes with populated results without browser errors", async () => {
  const page = await browser.newPage({ viewport: viewports[0] });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await mockApi(page);
  await page.goto(`${baseUrl}/speedtest`);
  await page.getByRole("heading", { name: "Speed Test" }).waitFor();
  await assertNoHorizontalOverflow(page, "desktop");

  await page.getByTestId("button-start-speedtest").click();
  await page.getByTestId("speedtest-wave-chart").waitFor();
  await page.getByText("Measuring latency", { exact: true }).first().waitFor();

  const pauseButton = page.getByTestId("button-pause-speedtest");
  await pauseButton.waitFor({ state: "visible" });
  await pauseButton.click();

  const resumeButton = page.getByRole("button", { name: "Resume Test" });
  await resumeButton.waitFor({ state: "visible" });
  assert.equal(await pauseButton.isVisible(), false, "pausing should hide the pause control");

  await resumeButton.click();
  await pauseButton.waitFor({ state: "visible" });
  await page.getByText("Measuring latency", { exact: true }).first().waitFor();

  await page.getByText("Test complete", { exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Run Again" }).waitFor({ state: "visible" });
  assert.equal(await page.getByRole("alert").count(), 0, "completed speed test should not show an error alert");
  assert.equal(await page.getByTestId("speedtest-wave-chart").getAttribute("aria-label"), "Network performance wave chart, 100% complete");
  for (const [testId, unit] of [
    ["text-ping-result", "ms"],
    ["text-download-result", "Mbps"],
    ["text-upload-result", "Mbps"],
  ]) {
    assert.match(
      (await page.getByTestId(testId).textContent()).trim(),
      new RegExp(`^\\d+(?:\\.\\d+)? ${unit}$`),
      `${testId} should show a completed numeric result`,
    );
  }

  assert.deepEqual(
    pageErrors,
    [],
    `speed test should not throw page errors: ${pageErrors.join("; ")}`,
  );
  assert.deepEqual(
    consoleErrors,
    [],
    `speed test should not log console errors: ${consoleErrors.join("; ")}`,
  );
  await page.close();
});
