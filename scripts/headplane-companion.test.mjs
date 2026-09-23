import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Headplane is vendored as an isolated companion service", async () => {
  const [packageJson, launcher, readme, license] = await Promise.all([
    readFile("headplane/package.json", "utf8"),
    readFile("scripts/start-headplane.mjs", "utf8"),
    readFile("headplane/README.safenet.md", "utf8"),
    readFile("headplane/LICENSE", "utf8"),
  ]);

  const packageData = JSON.parse(packageJson);
  assert.equal(packageData.name, "headplane");
  assert.equal(packageData.version, "0.7.1");
  assert.match(license, /MIT License/);
  assert.match(launcher, /HEADSCALE_API_KEY/);
  assert.match(launcher, /HEADPLANE_COOKIE_SECRET/);
  assert.match(launcher, /HEADPLANE_CONFIG_PATH/);
  assert.match(launcher, /pnpm/);
  assert.match(readme, /upstream Headplane project/);
  assert.match(readme, /npm run headplane:install/);
});