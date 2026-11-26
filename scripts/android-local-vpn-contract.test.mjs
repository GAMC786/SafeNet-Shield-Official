import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const manifest = read("../android/app/src/main/AndroidManifest.xml");
const mainActivity = read("../android/app/src/main/java/com/safenet/dns/MainActivity.java");
const dashboard = read("../client/src/pages/Dashboard.tsx");
const card = read("../client/src/components/PrivateDnsCard.tsx");
const privateDnsEula = read("../client/src/components/PrivateDnsEulaDialog.tsx");
const dnsSettings = read("../client/src/pages/DnsSettings.tsx");
const service = read("../android/app/src/main/java/com/safenet/dns/SafeNetLocalVpnService.kt");
const dnsFirewall = read("../android/app/src/main/java/com/safenet/dns/DnsFirewall.java");
const plugin = read("../android/app/src/main/java/com/safenet/dns/SafeNetLocalVpnPlugin.java");
const firewallPage = read("../client/src/pages/Firewall.tsx");
const dnscryptBridge = read("../android/local-vpn-bridge/dnscrypt.go");
const privateDnsHook = read("../client/src/hooks/use-private-dns.ts");
const vpnUiInstrumentation = read("../android/app/src/androidTest/java/com/safenet/dns/SafeNetVpnUiInstrumentationTest.java");
const androidSmokeTest = read("../scripts/android-smoke-test.sh");

test("SafeNet declares a local Android VPN service without the old VPN service", () => {
  assert.match(manifest, /android:name="\.SafeNetLocalVpnService"/);
  assert.match(manifest, /android:permission="android\.permission\.BIND_VPN_SERVICE"/);
  assert.match(manifest, /android\.net\.VpnService/);
  assert.doesNotMatch(manifest, /GoBackend\$VpnService|SafeNetWindscribe|SafeNetDnsVpnService/);
  assert.doesNotMatch(mainActivity, /SafeNetWindscribe/);
});

test("Dashboard uses built-in SafeNet Private DNS with a Radix switch", () => {
  assert.match(dashboard, /<PrivateDnsCard\s*\/>/);
  assert.match(card, /SafeNet Private DNS/);
  assert.match(card, /Android&apos;s built-in encrypted DNS setting/);
  assert.match(card, /No local VPN or VPN server is used/);
  assert.match(card, /<Switch/);
  assert.match(card, /checked=\{privateDns\.status\?\.running === true\}/);
  assert.match(card, /onCheckedChange=\{handleToggle\}/);
  assert.match(card, /Selected DNS server:/);
  assert.match(card, /switch-private-dns-protection/);
});

test("SafeNet Private DNS requires EULA acceptance before configuration", () => {
  assert.match(card, /acceptedEulaVersion !== SAFE_NET_PRIVATE_DNS_EULA_VERSION/);
  assert.match(card, /setEulaOpen\(true\)/);
  assert.match(card, /setAcceptedEulaVersion\(SAFE_NET_PRIVATE_DNS_EULA_VERSION\)/);
  assert.match(card, /onAccept=\{acceptEula\}/);
  assert.match(privateDnsEula, /data-testid="button-private-dns-eula-accept"/);
  assert.match(privateDnsEula, /SafeNet Private DNS EULA/);
  assert.match(privateDnsEula, /authorize SafeNet to use the Android Private DNS settings/);
});

test("DNS resolver management no longer depends on the optional Private DNS wrapper", () => {
  assert.doesNotMatch(dnsSettings, /SafeNet Private DNS|Open Private DNS|switch-safe-net-private-dns/);
  assert.match(card, /Open Android Private DNS settings/);
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

test("Android consent cancellation stays off and is retried in release smoke", () => {
  assert.match(
    plugin,
    /Android VPN permission was canceled\. DNS protection remains off; try again to enable it\./
  );
  assert.match(
    vpnUiInstrumentation,
    /localVpnConsentBackCancellationLeavesToggleOffAndRetryable/
  );
  assert.match(vpnUiInstrumentation, /VpnService\.prepare\(context\)/);
  assert.match(vpnUiInstrumentation, /pressBackFromVpnPermissionDialog\(\)/);
  assert.match(vpnUiInstrumentation, /grantVpnPermissionDialog\(\)/);
  assert.match(
    androidSmokeTest,
    /SafeNetUiInstrumentationTest#localVpnConsentBackCancellationLeavesToggleOffAndRetryable/
  );
});

test("Android process death restarts the sticky VPN service in device smoke", () => {
  const recoveryStart = vpnUiInstrumentation.indexOf(
    "public void localVpnRestoresSavedResolverAfterServiceRestartAndReportsFailure()"
  );
  const reclaimStart = vpnUiInstrumentation.indexOf(
    "String originalPid = appProcessId();",
    recoveryStart
  );
  const reopenStart = vpnUiInstrumentation.indexOf("relaunchActivity();", reclaimStart);
  const reclaimFlow = vpnUiInstrumentation.slice(reclaimStart, reopenStart);

  assert.ok(recoveryStart >= 0);
  assert.ok(reclaimStart > recoveryStart);
  assert.ok(reopenStart > reclaimStart);
  assert.match(reclaimFlow, /device\.pressHome\(\)/);
  assert.match(reclaimFlow, /am kill /);
  assert.match(reclaimFlow, /waitForStickyVpnServiceProcess\(originalPid\)/);
  assert.match(reclaimFlow, /device\.getCurrentPackageName\(\)/);
  assert.doesNotMatch(reclaimFlow, /am force-stop|startForegroundService/);
  assert.match(vpnUiInstrumentation, /private String waitForStickyVpnServiceProcess/);
  assert.match(
    androidSmokeTest,
    /SafeNetUiInstrumentationTest#localVpnRestoresSavedResolverAfterServiceRestartAndReportsFailure/
  );
});

test("phone firewall action syncs policy, enables the local VPN, and exposes supported rule limits", () => {
  const newRuleButton = firewallPage.indexOf("> New Rule");
  const usePhoneButton = firewallPage.indexOf('data-testid="button-use-firewall-rules-on-phone"');
  assert.ok(newRuleButton >= 0 && newRuleButton < usePhoneButton);
  assert.match(firewallPage, /SafeNetVpn\.syncFirewallConfig/);
  assert.match(firewallPage, /localVpn\.start\(/);
  assert.match(firewallPage, /firewallEnabled: true/);
  assert.match(service, /evaluateNetworkAccessRule\(srcIp, dstIp, "tcp"/);
  assert.match(service, /evaluateNetworkAccessRule\(srcIp, dstIp, "udp"/);
  assert.match(dnsFirewall, /service\.equals\("http"\).*port == 80/s);
  assert.match(dnsFirewall, /service\.equals\("https"\).*port == 443/s);
  assert.match(firewallPage, /HTTPS content is not inspected/);
});
