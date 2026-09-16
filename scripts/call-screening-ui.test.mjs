import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile("client/src/pages/SpamCallBlocker.tsx", "utf8");
const hookSource = await readFile("client/src/hooks/use-vpn.ts", "utf8");

test("call-screening controls share the role request and settings fallback", () => {
  assert.match(pageSource, /const requestNativeRole = useCallback/);
  assert.match(pageSource, /return native\.openSettings\(\)/);
  assert.match(pageSource, /Choose SafeNet for call screening/);
  assert.match(pageSource, /Could not open call-screening settings/);
  assert.match(hookSource, /openCallScreeningSettings\(\): Promise<CallScreeningStatus>/);
});