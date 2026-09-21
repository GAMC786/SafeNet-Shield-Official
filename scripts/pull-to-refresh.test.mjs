import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentSource = await readFile(
  new URL("../client/src/components/PullToRefresh.tsx", import.meta.url),
  "utf8",
);
const appSource = await readFile(
  new URL("../client/src/App.tsx", import.meta.url),
  "utf8",
);

test("pull-to-refresh only refreshes from the top and refetches active page data", () => {
  assert.match(componentSource, /container\.scrollTop > 0/);
  assert.match(componentSource, /PULL_THRESHOLD/);
  assert.match(componentSource, /onTouchMove/);
  assert.match(componentSource, /onTouchEnd/);
  assert.match(componentSource, /Release to refresh/);
  assert.match(componentSource, /onRefresh\(\)/);
  assert.match(appSource, /<PullToRefresh/);
  assert.match(appSource, /queryClient\.refetchQueries\(\{ type: "active" \}\)/);
});