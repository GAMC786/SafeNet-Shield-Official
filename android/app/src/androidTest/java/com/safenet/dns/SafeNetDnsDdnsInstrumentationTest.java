package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@RunWith(AndroidJUnit4.class)
public class SafeNetDnsDdnsInstrumentationTest {
    private static final long JS_TIMEOUT_SECONDS = 25;
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