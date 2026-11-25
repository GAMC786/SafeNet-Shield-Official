import assert from "node:assert/strict";
import test from "node:test";
import { CustomDnsBlocklistError, fetchCustomDnsBlocklist, parseCustomDnsBlocklist } from "./custom-dns-blocklists";

test("custom blocklist parser accepts domains, hosts files, and AdGuard domain rules", () => {
  assert.deepEqual(parseCustomDnsBlocklist([
    "! title",
    "0.0.0.0 Ads.Example.com tracker.example.com",
    "||ads.example.com^",
    "||phishing.example^$important",
    "plain.example",
    "127.0.0.1 localhost",
  ].join("\n")), [
    "ads.example.com",
    "phishing.example",
    "plain.example",
    "tracker.example.com",
  ]);
});

test("custom blocklist parser rejects content without supported domain rules", () => {
  assert.throws(
    () => parseCustomDnsBlocklist("! empty list\n@@||allowed.example^"),
    CustomDnsBlocklistError,
  );
});

test("custom blocklist import refuses insecure URLs and IP-literal targets", async () => {
  await assert.rejects(fetchCustomDnsBlocklist("http://example.com/list.txt"), CustomDnsBlocklistError);
  await assert.rejects(fetchCustomDnsBlocklist("https://127.0.0.1/list.txt"), CustomDnsBlocklistError);
});
