import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../client/src/App.tsx", import.meta.url),
  "utf8",
);

test("the app shell gives the page content a bounded scroll container", () => {
  assert.match(source, /h-screen min-h-0 h-\[100dvh\][^"]*overflow-hidden/);
  assert.match(source, /min-h-0 flex-1[^"]*overflow-y-auto/);
});