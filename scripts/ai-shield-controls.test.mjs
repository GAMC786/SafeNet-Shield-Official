import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controlsSource = await readFile(
  new URL("../client/src/components/AiShieldControls.tsx", import.meta.url),
  "utf8",
);

test("AI Shield uses monitor switches as the single camera and screen control path", () => {
  assert.match(controlsSource, /data-testid="switch-ai-camera"/);
  assert.match(controlsSource, /data-testid="switch-ai-screen"/);
  assert.match(controlsSource, /toggleSource\("camera", checked\)/);
  assert.match(controlsSource, /toggleSource\("screen", checked\)/);
  assert.doesNotMatch(controlsSource, /Start Camera|Start Screen|Stop Detector/);
  assert.doesNotMatch(controlsSource, /button-ai-start-camera|button-ai-start-screen|button-ai-stop/);
});