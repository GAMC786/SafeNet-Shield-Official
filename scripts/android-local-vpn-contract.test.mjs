import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const manifest = read("../android/app/src/main/AndroidManifest.xml");
const mainActivity = read("../android/app/src/main/java/com/safenet/dns/MainActivity.java");
const dashboard = read("../client/src/pages/Dashboard.tsx");
const card = read("../client/src/components/LocalVpnCard.tsx");
const dnsSettings = read("../client/src/pages/DnsSettings.tsx");
const service = read("../android/app/src/main/java/com/safenet/dns/SafeNetLocalVpnService.kt");
const plugin = read("../android/app/src/main/java/com/safenet/dns/SafeNetLocalVpnPlugin.java");
const dnscryptBridge = read("../android/local-vpn-bridge/dnscrypt.go");
const privateDnsHook = read("../client/src/hooks/use-private-dns.ts");

test("SafeNet declares a local Android VPN service without the old VPN service", () => {
  assert.match(manifest, /android:name="\.SafeNetLocalVpnService"/);
  assert.match(manifest, /android:permission="android\.permission\.BIND_VPN_SERVICE"/);
  assert.match(manifest, /android\.net\.VpnService/);
  assert.doesNotMatch(manifest, /GoBackend\$VpnService|SafeNetWindscribe|SafeNetDnsVpnService/);
  assert.doesNotMatch(mainActivity, /SafeNetWindscribe/);
});

test("Dashboard offers phone-only ad filtering and Android Private DNS mode", () => {
  assert.match(dashboard, /<LocalVpnCard\s*\/>/);
  assert.match(card, /Protects this phone only/);
  assert.match(card, /DNS-based in-app ads and trackers/);
  assert.match(card, /System \/ Private DNS/);
  assert.match(card, /<Switch/);
  assert.match(card, /checked=\{vpn\.connected\}/);
  assert.match(card, /onCheckedChange=\{toggleLocalProtection\}/);
  assert.match(card, /Select an active DNS server to turn on protection/);
  assert.match(card, /active DNS server/);
  assert.match(card, /DNS-over-HTTPS or DNS-over-TLS may bypass ad filtering/);
});

test("DNS resolver management no longer depends on the optional Private DNS wrapper", () => {
  assert.doesNotMatch(dnsSettings, /SafeNet Private DNS|Open Private DNS|switch-safe-net-private-dns/);
  assert.match(card, /System \/ Private DNS/);
});

test("local packet forwarding captures direct DNS and protects upstream sockets", () => {
  assert.match(service, /addRoute\("0\.0\.0\.0", 0\)/);
  assert.match(service, /addRoute\("::", 0\)/);
  assert.match(service, /dstPort\.toInt\(\) == 53/);
  assert.match(service, /"plain" -> plainQuery/);
  assert.match(service, /"dot" -> dotQuery/);
  assert.match(service, /"doh" -> dohQuery/);
  assert.match(service, /"sdns" -> dnscryptResolver\?\.query/);
  assert.match(service, /Bridge\.newDnscryptResolver\(\)/);
  assert.match(dnscryptBridge, /type DnscryptResolver struct/);
  assert.match(dnscryptBridge, /github\.com\/ameshkov\/dnscrypt\/v2/);
  assert.match(dnscryptBridge, /client\.Exchange\(query, info\)/);
  assert.ok(privateDnsHook.includes("tls|dot"));
  assert.match(service, /protect\(raw\)/);
  assert.match(service, /protect\(socket\)/);
  assert.match(plugin, /VpnService\.prepare/);
  assert.match(plugin, /primaryAddress/);
  assert.match(plugin, /startForegroundService/);
});
