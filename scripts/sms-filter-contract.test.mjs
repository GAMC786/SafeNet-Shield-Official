import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Firewall no longer exposes its DNS keyword filtering tab", async () => {
  const source = await read("client/src/pages/Firewall.tsx");
  assert.doesNotMatch(source, /Keyword Filtering/);
  assert.doesNotMatch(source, /TabsContent value="keywords"/);
  assert.match(source, /useBlocklists/); // Removing the tab does not trigger deletion of saved rules.
});

test("SMS filtering stays local and uses a user-granted default SMS role", async () => {
  const [manifest, plugin, filter, page, backup] = await Promise.all([
    read("android/app/src/main/AndroidManifest.xml"),
    read("android/app/src/main/java/com/safenet/dns/SafeNetSmsPlugin.java"),
    read("android/app/src/main/java/com/safenet/dns/SafeNetSmsFilter.java"),
    read("client/src/pages/SpamCallBlocker.tsx"),
    read("android/app/src/main/res/xml/data_extraction_rules.xml"),
  ]);

  assert.match(manifest, /android\.provider\.Telephony\.SMS_DELIVER/);
  assert.match(manifest, /android\.intent\.action\.SENDTO/);
  assert.match(manifest, /android\.intent\.action\.RESPOND_VIA_MESSAGE/);
  assert.match(manifest, /android\.permission\.WRITE_SMS/);
  assert.match(plugin, /requestDefaultSmsApp/);
  assert.match(plugin, /requestPermissionForAlias\("sms"/);
  assert.match(plugin, /alias = "receiveSms"/);
  assert.match(plugin, /requestPermissionForAlias\("receiveSms", call, "smsPermissionResult"\)/);
  assert.match(plugin, /filterPermissionGranted/);
  assert.doesNotMatch(plugin, /WRITE_SMS/);
  assert.match(plugin, /Manifest\.permission\.READ_SMS/);
  assert.match(plugin, /Manifest\.permission\.RECEIVE_SMS/);
  assert.match(plugin, /Manifest\.permission\.SEND_SMS/);
  assert.match(filter, /PREF_ENABLED, false/);
  assert.match(filter, /return roleHeld && receiveSmsPermissionGranted/);
  assert.match(filter, /MAX_QUARANTINED_MESSAGES = 100/);
  assert.match(page, /Junkboy SMS Filter/);
  assert.match(page, /sms\.requestFilterPermission\(\)/);
  assert.match(page, /if \(!status\.filterPermissionGranted\)/);
  assert.match(page, /MMS photos and group messages/);
  assert.match(backup, /safenet_sms_filter\.xml/);
  assert.doesNotMatch(plugin, /apiFetch|fetch\(/);
});