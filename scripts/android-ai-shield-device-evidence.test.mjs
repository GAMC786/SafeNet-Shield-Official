import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const parserPath = new URL("./android-ai-shield-device-evidence.sh", import.meta.url);
const deviceTestPath = new URL("./android-ai-shield-device-test.sh", import.meta.url);

/*
 * Physical-device evidence marker contract:
 * - camera permission:
 *   AI_SHIELD_DEVICE_EVENT event=camera_permission_granted source=camera
 * - MediaProjection consent:
 *   AI_SHIELD_DEVICE_EVENT event=media_projection_consent_granted source=screen
 * - both switch directions, each paired with its instrumentation method:
 *   aiShieldRapidCameraToScreenSwitchKeepsNewProjectionActive
 *   AI_SHIELD_DEVICE_EVENT event=test_pass source=camera_to_screen
 *   aiShieldRapidScreenToCameraSwitchKeepsNewCameraActive
 *   AI_SHIELD_DEVICE_EVENT event=test_pass source=screen_to_camera
 * - callback ordering:
 *   AI_SHIELD_CALLBACK event=<event> source=<camera|screen>
 *     generation=<number> active=<true|false>
 *
 * The parser must fail closed: every required marker is needed before result=PASS.
 */

const completeLogcat = [
  "I/AiShieldDeviceSmoke: AI_SHIELD_DEVICE_EVENT event=camera_permission_granted source=camera test=consent",
  "I/AiShieldDeviceSmoke: AI_SHIELD_DEVICE_EVENT event=media_projection_consent_granted source=screen test=consent",
  "I/AiShieldDeviceSmoke: aiShieldRapidCameraToScreenSwitchKeepsNewProjectionActive",
  "I/AiShieldDeviceSmoke: AI_SHIELD_DEVICE_EVENT event=source_stable source=screen test=aiShieldRapidCameraToScreenSwitchKeepsNewProjectionActive",
  "I/AiShieldDeviceSmoke: AI_SHIELD_DEVICE_EVENT event=test_pass source=camera_to_screen test=aiShieldRapidCameraToScreenSwitchKeepsNewProjectionActive",
  "I/AiShieldDeviceSmoke: aiShieldRapidScreenToCameraSwitchKeepsNewCameraActive",
  "I/AiShieldDeviceSmoke: AI_SHIELD_DEVICE_EVENT event=source_stable source=camera test=aiShieldRapidScreenToCameraSwitchKeepsNewCameraActive",
  "I/AiShieldDeviceSmoke: AI_SHIELD_DEVICE_EVENT event=test_pass source=screen_to_camera test=aiShieldRapidScreenToCameraSwitchKeepsNewCameraActive",
  "I/AiShieldManager: AI_SHIELD_CALLBACK event=camera_opened source=camera generation=1 active=true",
  "I/AiShieldManager: AI_SHIELD_CALLBACK event=projection_result_received source=screen generation=2 active=true",
].join("\n");

function runParser(logcat = completeLogcat) {
  const directory = mkdtempSync(join(tmpdir(), "android-ai-shield-evidence-"));
  const logcatPath = join(directory, "logcat.txt");
  const instrumentationPath = join(directory, "instrumentation.log");
  const outputPath = join(directory, "result.txt");
  writeFileSync(logcatPath, `${logcat}\n`);
  writeFileSync(instrumentationPath, "INSTRUMENTATION_CODE: 0\n");

  const result = spawnSync(
    "bash",
    [
      parserPath.pathname,
      "--logcat",
      logcatPath,
      "--instrumentation-log",
      instrumentationPath,
      "--output",
      outputPath,
      "--target",
      "physical-serial",
      "--profile",
      "pixel-android-14",
      "--profile-status",
      "MATCH",
    ],
    { encoding: "utf8" },
  );
  const fields = Object.fromEntries(
    readFileSync(outputPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("=", 2)),
  );
  return { fields, result };
}

test("accepts complete physical-device AI Shield evidence", () => {
  const { fields, result } = runParser();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fields.camera_to_screen, "PASS");
  assert.equal(fields.screen_to_camera, "PASS");
  assert.equal(fields.camera_permission, "PASS");
  assert.equal(fields.media_projection_consent, "PASS");
  assert.equal(fields.callback_order, "PASS");
  assert.equal(fields.generation_numbered_callbacks, "PASS");
  assert.equal(fields.failure_class, "NONE");
  assert.equal(fields.failure_category, "PASS");
  assert.equal(fields.result, "PASS");
});

test("rejects evidence with missing consent", () => {
  const { fields, result } = runParser(
    completeLogcat.replace(
      /I\/AiShieldDeviceSmoke: AI_SHIELD_DEVICE_EVENT event=media_projection_consent_granted[^\n]+\n/,
      "",
    ),
  );

  assert.notEqual(result.status, 0);
  assert.equal(fields.media_projection_consent, "NOT_RECORDED");
  assert.equal(fields.failure_class, "DEVICE");
  assert.equal(fields.failure_category, "DEVICE_CONSENT_FAILURE");
  assert.equal(fields.result, "FAIL");
});

test("rejects evidence with missing callbacks", () => {
  const { fields, result } = runParser(
    completeLogcat
      .split("\n")
      .filter((line) => !line.includes("AI_SHIELD_CALLBACK"))
      .join("\n"),
  );

  assert.notEqual(result.status, 0);
  assert.equal(fields.callback_order, "NOT_RECORDED");
  assert.equal(fields.generation_numbered_callbacks, "NOT_RECORDED");
  assert.equal(fields.failure_class, "EVIDENCE");
  assert.equal(fields.failure_category, "INCOMPLETE_DEVICE_EVIDENCE");
  assert.equal(fields.result, "FAIL");
});

test("rejects partial switch evidence", () => {
  const { fields, result } = runParser(
    completeLogcat.replace(
      /I\/AiShieldDeviceSmoke: aiShieldRapidScreenToCameraSwitchKeepsNewCameraActive\n/,
      "",
    ).replace(
      /I\/AiShieldDeviceSmoke: AI_SHIELD_DEVICE_EVENT event=source_stable source=camera[^\n]+\n/,
      "",
    ).replace(
      /I\/AiShieldDeviceSmoke: AI_SHIELD_DEVICE_EVENT event=test_pass source=screen_to_camera[^\n]+\n/,
      "",
    ),
  );

  assert.notEqual(result.status, 0);
  assert.equal(fields.camera_to_screen, "PASS");
  assert.equal(fields.screen_to_camera, "FAIL");
  assert.equal(fields.failure_class, "EVIDENCE");
  assert.equal(fields.failure_category, "INCOMPLETE_DEVICE_EVIDENCE");
  assert.equal(fields.result, "FAIL");
});

test("physical-device runner delegates its pass decision to the tested parser", () => {
  const deviceTest = readFileSync(deviceTestPath, "utf8");

  assert.match(
    deviceTest,
    /android-ai-shield-device-evidence\.sh/,
    "the live physical-device runner must use the tested evidence parser",
  );
});