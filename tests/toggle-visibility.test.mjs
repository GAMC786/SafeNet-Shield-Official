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

function mockApi(page) {
  let settings = {
    id: 1,
    isPinEnabled: true,
    aiShieldEnabled: true,
    alwaysOnEnabled: false,
    deviceAdminEnabled: false,
    firewallEnabled: false,
    theme: "red-gray-blue",
  };
  const updaters = [
    {
      id: 1,
      hostname: "home.example.com",
      provider: "duckdns",
      lastIpAddress: null,
      lastUpdateTime: null,
      isEnabled: true,
      updateInterval: 3600,
    },
    {
      id: 2,
      hostname: "backup.example.com",
      provider: "noip",
      lastIpAddress: null,
      lastUpdateTime: null,
      isEnabled: false,
      updateInterval: 3600,
    },
  ];

  return Promise.all([
    page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      let response;

      if (url.pathname === "/api/auth/status") {
        response = { authenticated: true, pinRequired: false };
      } else if (url.pathname === "/api/settings" && method === "GET") {
        response = settings;
      } else if (url.pathname === "/api/settings" && method === "PUT") {
        settings = { ...settings, ...JSON.parse(request.postData() || "{}") };
        response = settings;
      } else if (url.pathname === "/api/dns" && method === "GET") {
        response = [
          {
            id: 1,
            name: "SafeNet Resolver",
            type: "dot",
            primaryAddress: "1.1.1.1",
            secondaryAddress: "1.0.0.1",
            isActive: true,
          },
        ];
      } else if (url.pathname === "/api/ddns" && method === "GET") {
        response = updaters;
      } else if (url.pathname.startsWith("/api/ddns/") && method === "PATCH") {
        response = updaters.find((updater) => String(updater.id) === url.pathname.split("/").pop());
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
    await page.close();
  });

  test(`DDNS toggle visibility and states at ${viewport.name} width`, async () => {
    const page = await browser.newPage({ viewport });
    await mockApi(page);
    await page.goto(`${baseUrl}/ddns`);
    await page.getByRole("heading", { name: "Dynamic DNS" }).waitFor();
    await assertNoHorizontalOverflow(page, viewport.name);

    const activeToggle = page.getByRole("button", { name: "Disable home.example.com" });
    const inactiveToggle = page.getByRole("button", { name: "Enable backup.example.com" });
    assert.equal(await activeToggle.getAttribute("aria-pressed"), "true");
    assert.equal(await inactiveToggle.getAttribute("aria-pressed"), "false");

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

    const updateNow = page.getByRole("button", { name: "Update Now" });
    assert.equal(await updateNow.isDisabled(), true, "Update Now should expose its disabled state");
    await focusWithKeyboard(page, inactiveToggle);
    assert.equal(await inactiveToggle.evaluate((element) => element === document.activeElement), true);
    assert.notEqual(
      await inactiveToggle.evaluate((element) => getComputedStyle(element).boxShadow),
      "none",
      "keyboard-focused DDNS toggles need a visible focus ring",
    );
    await page.close();
  });
}