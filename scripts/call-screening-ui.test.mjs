import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile("client/src/pages/SecureDialer.tsx", "utf8");

test("Secure Dialer page links to its official project and release channels", () => {
  assert.match(pageSource, /https:\/\/github\.com\/Secure-Phone-apps\/Secure-Dialer/);
  assert.match(pageSource, /https:\/\/github\.com\/Secure-Phone-apps\/Secure-Dialer\/releases/);
  assert.match(pageSource, /https:\/\/secure-phone-apps\.github\.io\/Secure-Dialer\//);
  assert.match(pageSource, /https:\/\/apps\.obtainium\.imranr\.dev/);
  assert.match(pageSource, /target="_blank" rel="noopener noreferrer"/);
  assert.match(pageSource, /GitHub blocks its repository pages from being displayed inside/);
  assert.doesNotMatch(pageSource, /Junkboy SMS Filter/);
});
