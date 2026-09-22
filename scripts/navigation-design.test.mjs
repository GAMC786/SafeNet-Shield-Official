import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../client/src/components/Navigation.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../client/src/index.css", import.meta.url),
  "utf8",
);

test("top and bottom navigation menus share the same item design", () => {
  assert.match(source, /const navItemClass =/);
  assert.match(source, /const navInactiveClass =/);
  assert.match(source, /const navIconClass = "w-6 h-6"/);
  assert.match(source, /const navLabelClass = "text-\[10px\] mt-1 font-medium"/);
  assert.equal((source.match(/navItemClass/g) ?? []).length, 3);
  assert.equal((source.match(/navInactiveClass/g) ?? []).length, 3);
  assert.equal((source.match(/navIconClass/g) ?? []).length, 3);
  assert.equal((source.match(/navLabelClass/g) ?? []).length, 3);
});

test("top navigation active indicator is centered on the front lower tab edge", () => {
  assert.match(
    source,
    /<Link key=\{item\.path\} href=\{item\.path\} className="flex w-full min-w-0 justify-center">[\s\S]*?layoutId="activeSystemTab"[\s\S]*?className="absolute -bottom-1 inset-x-0 z-10 mx-auto h-1 w-8/,
  );
});

test("top navigation stays flush to the top while reserving the Android status-bar inset", () => {
  assert.match(source, /className="safenet-system-navigation glass-panel fixed/);
  assert.match(
    styles,
    /\.safenet-system-navigation \{\s*top: 0;\s*height: calc\(5rem \+ var\(--safenet-status-bar-inset\)\);\s*padding-top: var\(--safenet-status-bar-inset\);/,
  );
});

test("bottom navigation stays flush to the bottom while reserving the Android navigation-bar inset", () => {
  assert.match(source, /className="safenet-bottom-navigation fixed/);
  assert.match(
    styles,
    /\.safenet-bottom-navigation \{\s*bottom: 0;\s*height: calc\(5rem \+ var\(--safenet-navigation-bar-inset\)\);\s*padding-bottom: var\(--safenet-navigation-bar-inset\);/,
  );
});
