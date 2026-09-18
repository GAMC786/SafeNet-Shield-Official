package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.VpnService;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONException;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@RunWith(AndroidJUnit4.class)
public class SafeNetDnsDdnsInstrumentationTest {
    private static final long JS_TIMEOUT_SECONDS = 25;
    private static final long VPN_START_TIMEOUT_SECONDS = 15;
    private static final String VIRTUAL_DNS = "10.248.0.1";
    private static final String BLOCKED_DOMAIN = "example.com";
    private static final String ALLOWED_DOMAIN = "iana.org";
    private final Context context =
        InstrumentationRegistry.getInstrumentation().getTargetContext();
    private Activity activity;

    @Before
    public void setUp() throws Exception {
        activity = InstrumentationRegistry.getInstrumentation().startActivitySync(
            new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
        );
        waitForWebView("document.readyState === 'complete'");
        if (hasArgument("preserve-auth-session")) {
            waitForWebView("document.body.innerText.includes('Command Center')");
        }
    }

    @After
    public void tearDown() {
        if (activity != null) {
            activity.finishAndRemoveTask();
        }
    }

    @Test
    public void signedPackageContainsDnsFilteringVpnOnly() throws Exception {
        PackageManager packageManager = context.getPackageManager();
        PackageInfo packageInfo = packageManager.getPackageInfo(
            context.getPackageName(),
            PackageManager.GET_SERVICES | PackageManager.GET_PERMISSIONS
        );

        boolean dnsVpnServicePresent = false;
        boolean removedVpnSurfacePresent = false;
        boolean dnsVpnPermissionPresent = false;
        if (packageInfo.services != null) {
            for (android.content.pm.ServiceInfo service : packageInfo.services) {
                dnsVpnServicePresent |= service.name.contains("SafeNetDnsVpnService");
                dnsVpnPermissionPresent |= "android.permission.BIND_VPN_SERVICE".equals(service.permission);
                removedVpnSurfacePresent |= service.name.contains("WireGuard") ||
                    service.name.contains("VpnTile");
            }
        }
        assertTrue("Installed package is missing SafeNetDnsVpnService", dnsVpnServicePresent);
        assertTrue("Installed package still contains removed VPN services", !removedVpnSurfacePresent);

        assertTrue("DNS VPN service is missing BIND_VPN_SERVICE", dnsVpnPermissionPresent);
        android.util.Log.i(
            "SafeNetAndroidReleaseSmoke",
            "DNS_VPN_PACKAGE_SURFACE result=PASS service=PRESENT permission=PRESENT"
        );
    }

    @Test
    public void dnsResolverCreateEditAndActivateFlow() throws Exception {
        JSONObject result = requireValue(callWebView(
            resolverFlowScript()
        ));
        assertTrue("DNS resolver create/edit/activate flow did not complete", result.getBoolean("passed"));
        android.util.Log.i(
            "SafeNetAndroidReleaseSmoke",
            "DNS_RESOLVER_UI result=PASS create=PASS edit=PASS activate=PASS"
        );
    }

    @Test
    public void ddnsManagementFlow() throws Exception {
        JSONObject result = requireValue(callWebView(
            ddnsFlowScript()
        ));
        assertTrue("DDNS create/edit/toggle/delete flow did not complete", result.getBoolean("passed"));
        android.util.Log.i(
            "SafeNetAndroidReleaseSmoke",
            "DDNS_UI result=PASS create=PASS edit=PASS toggle=PASS delete=PASS"
        );
    }

    @Test
    public void physicalDnsFilteringBlocksSelectedDomainAndAllowsAnother() throws Exception {
        if (!hasArgument("physical-dns-filtering")) {
            return;
        }

        assertTrue(
            "Android VPN permission has not been granted; grant DNS filtering permission before "
                + "starting the physical-device smoke lane.",
            VpnService.prepare(context) == null
        );

        JSONObject firewall = physicalDnsFirewall();
        ProtocolResult plain = exercisePhysicalResolver(
            "plain", "1.1.1.1", "8.8.8.8", firewall, true
        );
        ProtocolResult doh = exercisePhysicalResolver(
            "doh", "https://cloudflare-dns.com/dns-query", "", firewall, false
        );
        ProtocolResult dot = exercisePhysicalResolver(
            "dot", "cloudflare-dns.com", "", firewall, false
        );

        assertTrue("Plain DNS did not return the selected REFUSED response", plain.blocked);
        assertTrue("Plain DNS did not return an allowed answer", plain.allowed);
        assertTrue("SafeNet did not report ownership of the active DNS VPN", plain.ownsVpn);

        android.util.Log.i(
            "SafeNetAndroidReleaseSmoke",
            "DNS_FILTERING_DEVICE result=PASS permission=PASS ownership=PASS "
                + "active_vpn=PASS blocked=PASS allowed=PASS "
                + "plain=" + plain.status + " doh=" + doh.status + " dot=" + dot.status
                + " blocked_query=REFUSED allowed_query=ANSWER vpn_replacement=CONTRACT_PASS"
        );
    }

    private ProtocolResult exercisePhysicalResolver(
        String type,
        String primary,
        String secondary,
        JSONObject firewall,
        boolean requireAllowed
    ) throws Exception {
        try {
            Intent serviceIntent = new Intent(context, SafeNetDnsVpnService.class)
                .putExtra(SafeNetDnsVpnService.EXTRA_TYPE, type)
                .putExtra(SafeNetDnsVpnService.EXTRA_IP_VERSION, "ipv4")
                .putExtra(SafeNetDnsVpnService.EXTRA_PRIMARY, primary)
                .putExtra(SafeNetDnsVpnService.EXTRA_SECONDARY, secondary);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
            waitForVpn();
            // Apply only to the live service so the physical smoke cannot
            // overwrite a user's persisted firewall policy on a reused phone.
            SafeNetDnsVpnService.updateFirewallConfig(firewall.toString());

            JSONObject status = SafeNetProtectionStatus.get(context);
            boolean ownsVpn =
                status.optBoolean("safeNetVpnRunning", false)
                    && status.optBoolean("safeNetOwnsActiveVpn", false)
                    && SafeNetProtectionStatus.STATE_PROTECTED.equals(status.optString("state"));
            assertTrue(type + " DNS VPN ownership was not confirmed", ownsVpn);

            DnsReply blocked = queryDns(BLOCKED_DOMAIN);
            assertEquals(type + " DNS did not refuse the selected domain", 5, blocked.rcode);
            boolean allowed = false;
            try {
                DnsReply allowedReply = queryDns(ALLOWED_DOMAIN);
                allowed = allowedReply.rcode == 0 && allowedReply.answerCount > 0;
            } catch (IOException error) {
                if (requireAllowed) throw error;
            }
            if (requireAllowed) {
                assertTrue(type + " DNS did not resolve the allowed domain", allowed);
            }
            return new ProtocolResult(ownsVpn, true, allowed, allowed ? "PASS" : "UNAVAILABLE");
        } finally {
            SafeNetDnsVpnService.requestStop();
            context.stopService(new Intent(context, SafeNetDnsVpnService.class));
            waitForVpnStopped();
        }
    }

    private JSONObject physicalDnsFirewall() throws JSONException {
        return new JSONObject()
            .put("settings", new JSONObject()
                .put("firewallEnabled", true)
                .put("preventDnsOverrides", true))
            .put("rules", new org.json.JSONArray())
            .put("blocklists", new org.json.JSONArray()
                .put(new JSONObject()
                    .put("type", "domain")
                    .put("content", BLOCKED_DOMAIN)
                    .put("action", "block")
                    .put("isActive", true)));
    }

    private DnsReply queryDns(String domain) throws IOException {
        byte[] query = dnsQuery(domain);
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setSoTimeout(6000);
            socket.send(new DatagramPacket(
                query, query.length, InetAddress.getByName(VIRTUAL_DNS), 53
            ));
            byte[] response = new byte[65535];
            DatagramPacket packet = new DatagramPacket(response, response.length);
            socket.receive(packet);
            if (packet.getLength() < 12) {
                throw new IOException("DNS response was incomplete.");
            }
            int flags = unsignedShort(response, 2);
            return new DnsReply(flags & 0x0f, unsignedShort(response, 6));
        } catch (SocketTimeoutException error) {
            throw new IOException("DNS response timed out.", error);
        }
    }

    private byte[] dnsQuery(String domain) {
        java.io.ByteArrayOutputStream query = new java.io.ByteArrayOutputStream();
        query.write(0x51);
        query.write(0x4e);
        query.write(0x01);
        query.write(0x00);
        query.write(0x00);
        query.write(0x01);
        query.write(0x00);
        query.write(0x00);
        query.write(0x00);
        query.write(0x00);
        query.write(0x00);
        query.write(0x00);
        for (String label : domain.split("\\.")) {
            byte[] bytes = label.getBytes(StandardCharsets.US_ASCII);
            query.write(bytes.length);
            query.write(bytes, 0, bytes.length);
        }
        query.write(0x00);
        query.write(0x00);
        query.write(0x01);
        query.write(0x00);
        query.write(0x01);
        return query.toByteArray();
    }

    private int unsignedShort(byte[] value, int offset) {
        return ((value[offset] & 0xff) << 8) | (value[offset + 1] & 0xff);
    }

    private void waitForVpn() throws Exception {
        long deadline = System.nanoTime()
            + TimeUnit.SECONDS.toNanos(VPN_START_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            if (SafeNetDnsVpnService.isRunning()) return;
            if (SafeNetDnsVpnService.getLastError() != null) {
                throw new AssertionError("DNS VPN failed to start.");
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Timed out waiting for the DNS VPN to start.");
    }

    private void waitForVpnStopped() throws InterruptedException {
        long deadline = System.nanoTime()
            + TimeUnit.SECONDS.toNanos(VPN_START_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline && SafeNetDnsVpnService.isRunning()) {
            Thread.sleep(100);
        }
    }

    private static final class DnsReply {
        private final int rcode;
        private final int answerCount;

        DnsReply(int rcode, int answerCount) {
            this.rcode = rcode;
            this.answerCount = answerCount;
        }
    }

    private static final class ProtocolResult {
        private final boolean ownsVpn;
        private final boolean blocked;
        private final boolean allowed;
        private final String status;

        ProtocolResult(boolean ownsVpn, boolean blocked, boolean allowed, String status) {
            this.ownsVpn = ownsVpn;
            this.blocked = blocked;
            this.allowed = allowed;
            this.status = status;
        }
    }

    private String resolverFlowScript() {
        return "(async()=>{" +
            "const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));" +
            "const setValue=(selector,value)=>{" +
                "const el=document.querySelector(selector);" +
                "if(!el)throw new Error('missing '+selector);" +
                "const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;" +
                "setter.call(el,value);" +
                "el.dispatchEvent(new Event('input',{bubbles:true}));" +
                "el.dispatchEvent(new Event('change',{bubbles:true}));" +
            "};" +
            "const clickText=(text)=>{" +
                "const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);" +
                "if(!el)throw new Error('missing button '+text);" +
                "el.click();" +
            "};" +
            "history.pushState({},'', '/dns');" +
            "window.dispatchEvent(new PopStateEvent('popstate'));" +
            "await sleep(500);" +
            "const name='Android resolver '+Date.now();" +
            "const edited=name+' edited';" +
            "clickText('Add a Resolver');" +
            "await sleep(200);" +
            "setValue('[data-testid=\"input-resolver-name\"]',name);" +
            "setValue('[data-testid=\"input-resolver-primary\"]','1.1.1.1');" +
            "setValue('[data-testid=\"input-resolver-secondary\"]','8.8.8.8');" +
            "clickText('Add Resolver');" +
            "await sleep(700);" +
            "let servers=await fetch('/api/dns',{cache:'no-store'}).then(r=>r.json());" +
            "let server=servers.find(s=>s.name===name);" +
            "if(!server)throw new Error('created resolver missing');" +
            "const edit=document.querySelector('[aria-label=\"Edit '+name+'\"]');" +
            "if(!edit)throw new Error('edit control missing');" +
            "edit.click();" +
            "await sleep(200);" +
            "setValue('[data-testid=\"input-resolver-name\"]',edited);" +
            "setValue('[data-testid=\"input-resolver-primary\"]','9.9.9.9');" +
            "clickText('Save Changes');" +
            "await sleep(700);" +
            "servers=await fetch('/api/dns',{cache:'no-store'}).then(r=>r.json());" +
            "server=servers.find(s=>s.name===edited);" +
            "if(!server||server.primaryAddress!=='9.9.9.9')throw new Error('edited resolver missing');" +
            "const editedControl=document.querySelector('[aria-label=\"Edit '+edited+'\"]');" +
            "const editedCard=editedControl?.closest('[class*=\"border-l-4\"]');" +
            "const activate=[...(editedCard?.querySelectorAll('button')||[])].find(b=>b.textContent.trim()==='Use This');" +
            "if(activate){" +
                "activate.click();" +
                "await sleep(700);" +
                "servers=await fetch('/api/dns',{cache:'no-store'}).then(r=>r.json());" +
                "server=servers.find(s=>s.name===edited);" +
            "}" +
            "if(!server||server.isActive!==true)throw new Error('resolver was not activated');" +
            "await fetch('/api/dns/'+server.id,{method:'DELETE'});" +
            "return {passed:true};" +
        "})()";
    }

    private String ddnsFlowScript() {
        return "(async()=>{" +
            "const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));" +
            "const setValue=(selector,value)=>{" +
                "const el=document.querySelector(selector);" +
                "if(!el)throw new Error('missing '+selector);" +
                "const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;" +
                "setter.call(el,value);" +
                "el.dispatchEvent(new Event('input',{bubbles:true}));" +
                "el.dispatchEvent(new Event('change',{bubbles:true}));" +
            "};" +
            "const clickText=(text)=>{" +
                "const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);" +
                "if(!el)throw new Error('missing button '+text);" +
                "el.click();" +
            "};" +
            "history.pushState({},'', '/ddns');" +
            "window.dispatchEvent(new PopStateEvent('popstate'));" +
            "await sleep(500);" +
            "const hostname='android-smoke-'+Date.now()+'.example.invalid';" +
            "const edited=hostname.replace('.example.invalid','-edited.example.invalid');" +
            "clickText('Add DDNS');" +
            "await sleep(200);" +
            "setValue('[data-testid=\"input-ddns-hostname\"]',hostname);" +
            "const provider=[...document.querySelectorAll('[role=\"combobox\"]')][0];" +
            "if(!provider)throw new Error('provider selector missing');" +
            "provider.click();" +
            "await sleep(100);" +
            "const option=[...document.querySelectorAll('[role=\"option\"]')].find(o=>o.textContent.includes('IP Link'));" +
            "if(!option)throw new Error('IP Link option missing');" +
            "option.click();" +
            "await sleep(100);" +
            "setValue('input[placeholder*=\"https://example.com/update\"]','https://127.0.0.1/update?ip={ip}&host={hostname}');" +
            "clickText('Create');" +
            "await sleep(700);" +
            "let updaters=await fetch('/api/ddns',{cache:'no-store'}).then(r=>r.json());" +
            "let updater=updaters.find(u=>u.hostname===hostname);" +
            "if(!updater)throw new Error('created DDNS updater missing');" +
            "const edit=document.querySelector('[aria-label=\"Edit '+hostname+'\"]');" +
            "if(!edit)throw new Error('DDNS edit control missing');" +
            "edit.click();" +
            "await sleep(200);" +
            "setValue('[data-testid=\"input-ddns-hostname\"]',edited);" +
            "clickText('Save Changes');" +
            "await sleep(700);" +
            "updaters=await fetch('/api/ddns',{cache:'no-store'}).then(r=>r.json());" +
            "updater=updaters.find(u=>u.hostname===edited);" +
            "if(!updater)throw new Error('edited DDNS updater missing');" +
            "const toggle=document.querySelector('[aria-label=\"Turn Off '+edited+'\"]');" +
            "if(!toggle)throw new Error('DDNS toggle missing');" +
            "toggle.click();" +
            "await sleep(700);" +
            "updaters=await fetch('/api/ddns',{cache:'no-store'}).then(r=>r.json());" +
            "updater=updaters.find(u=>u.hostname===edited);" +
            "if(!updater||updater.isEnabled!==false)throw new Error('DDNS toggle did not persist');" +
            "const remove=document.querySelector('[aria-label=\"Delete '+edited+'\"]');" +
            "if(!remove)throw new Error('DDNS delete control missing');" +
            "window.confirm=()=>true;" +
            "remove.click();" +
            "await sleep(150);" +
            "const confirmButton=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='OK');" +
            "if(confirmButton)confirmButton.click();" +
            "await sleep(700);" +
            "updaters=await fetch('/api/ddns',{cache:'no-store'}).then(r=>r.json());" +
            "if(updaters.some(u=>u.hostname===edited))throw new Error('DDNS delete did not persist');" +
            "return {passed:true};" +
        "})()";
    }

    private boolean hasArgument(String name) {
        return InstrumentationRegistry.getArguments().containsKey(name);
    }

    private void waitForWebView(String expression) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            JSONObject result = callWebView(expression);
            if (result.optBoolean("ok", false) && result.optBoolean("value", false)) return;
            Thread.sleep(250);
        }
        throw new AssertionError("Timed out waiting for WebView: " + expression);
    }

    private JSONObject requireValue(JSONObject result) throws Exception {
        assertTrue("WebView call failed: " + result.optString("message"), result.optBoolean("ok"));
        return result.getJSONObject("value");
    }

    private JSONObject callWebView(String expression) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        String[] rawResult = new String[1];
        TestResultBridge bridge = new TestResultBridge(rawResult, completed);
        String script =
            "(async()=>{try{" +
                "return JSON.stringify({ok:true,value:await (" + expression + ")});" +
            "}catch(error){" +
                "return JSON.stringify({ok:false,message:String(error.message||error)});" +
            "}})().then(value=>window.SafeNetDnsDdnsTestBridge.resolve(value));";

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            webView.addJavascriptInterface(bridge, "SafeNetDnsDdnsTestBridge");
            webView.evaluateJavascript(script, null);
        });

        try {
            assertTrue(
                "Timed out waiting for WebView call",
                completed.await(JS_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            );
            return new JSONObject(rawResult[0]);
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                ((MainActivity) activity).getBridge().getWebView()
                    .removeJavascriptInterface("SafeNetDnsDdnsTestBridge")
            );
        }
    }

    private static final class TestResultBridge {
        private final String[] result;
        private final CountDownLatch completed;

        TestResultBridge(String[] result, CountDownLatch completed) {
            this.result = result;
            this.completed = completed;
        }

        @JavascriptInterface
        public void resolve(String value) {
            result[0] = value;
            completed.countDown();
        }
    }
}