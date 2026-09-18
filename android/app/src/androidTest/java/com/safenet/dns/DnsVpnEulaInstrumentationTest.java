package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.VpnService;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Installed-APK coverage for the DNS VPN agreement and Android VPN consent
 * ordering. The test deliberately drives the dashboard through the packaged
 * WebView and observes the native consent dialog with UiAutomator.
 */
@RunWith(AndroidJUnit4.class)
public class DnsVpnEulaInstrumentationTest {
    private static final String EULA_VERSION = "1.0";
    private static final String EULA_STORAGE_KEY = "safenet-dns-vpn-eula-version";
    private static final long JS_TIMEOUT_SECONDS = 25;

    private final Context context =
        InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiDevice device =
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
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
    public void tearDown() throws Exception {
        try {
            callWebView(
                "window.Capacitor?.Plugins?.SafeNetVpn?.stopDnsProtection?.().catch(() => {})"
            );
        } catch (Exception ignored) {
            // Preserve the original assertion when the consent activity is still closing.
        }
        if (activity != null && !activity.isFinishing()) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
        }
    }

    @Test
    public void agreementPrecedesAndroidConsentAndAcceptedVersionIsReused() throws Exception {
        openDashboardWithActiveResolver();
        resetAgreementAndVpnState();
        waitForWebView(
            "(() => {" +
                "const toggle = document.querySelector('[data-testid=\"switch-android-dns-vpn\"]');" +
                "return Boolean(toggle && toggle.getAttribute('role') === 'switch' && !toggle.disabled && " +
                    "toggle.getAttribute('aria-label') === 'Android DNS VPN Off' && " +
                    "toggle.getAttribute('aria-checked') === 'false');" +
            "})()"
        );
        assertTrue(
            "Android must still require VPN consent before the first activation",
            VpnService.prepare(context) != null
        );

        clickVpnControl();
        waitForAgreementDialog();
        assertFalse(
            "The Android VPN consent dialog must not appear before the agreement",
            hasVpnConsentAction()
        );

        clickAgreementCancel();
        waitForAgreementClosed();
        assertEquals(
            "Cancelling the agreement must not record acceptance",
            "null",
            readEulaVersion()
        );
        assertFalse(
            "Cancelling the agreement must leave DNS VPN stopped",
            nativeDnsVpnRunning()
        );
        assertTrue(
            "Cancelling the agreement must not grant Android VPN access",
            VpnService.prepare(context) != null
        );

        clickVpnControl();
        waitForAgreementDialog();
        clickAgreementAccept();
        waitForAgreementClosed();
        assertEquals(
            "Agreement acceptance must persist the current version",
            EULA_VERSION,
            readEulaVersion()
        );

        UiObject2 firstConsent = waitForVpnConsentAction();
        assertTrue(
            "The Android consent prompt must still be pending after agreement acceptance",
            VpnService.prepare(context) != null
        );
        cancelVpnConsent(firstConsent);
        waitForWebView("!Boolean(document.querySelector('[data-testid=\"dialog-dns-vpn-eula\"]'))");
        assertFalse(
            "Cancelling Android consent must leave DNS VPN stopped",
            nativeDnsVpnRunning()
        );
        waitForVpnButtonReady();

        // The accepted version must bypass the in-app agreement on a later activation.
        clickVpnControl();
        UiObject2 secondConsent = waitForVpnConsentAction();
        JSONObject laterActivation = callWebView(
            "Boolean(document.querySelector('[data-testid=\"dialog-dns-vpn-eula\"]'))"
        );
        assertFalse(
            "A later activation must not repeat the accepted agreement version",
            laterActivation.getBoolean("value")
        );
        cancelVpnConsent(secondConsent);

        Log.i(
            "SafeNetAndroidReleaseSmoke",
            "DNS_VPN_EULA_ORDER result=PASS first_tap=EULA cancel=PASS " +
                "accept_before_android_consent=PASS android_cancel=PASS " +
                "accepted_version_reused=PASS"
        );
    }

    private void openDashboardWithActiveResolver() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const originalFetch = window.fetch;" +
                "window.fetch = function(input, init) {" +
                    "const url = typeof input === 'string' ? input : ((input && input.url) || '');" +
                    "if (url.includes('/api/dns')) {" +
                        "return Promise.resolve(new Response(JSON.stringify([{" +
                            "id: 1," +
                            "name: 'SafeNet Test Resolver'," +
                            "type: 'plain'," +
                            "ipVersion: 'ipv4'," +
                            "primaryAddress: '1.1.1.1'," +
                            "secondaryAddress: '8.8.8.8'," +
                            "isActive: true" +
                        "}]), {" +
                            "status: 200," +
                            "headers: {'Content-Type': 'application/json'}" +
                        "}));" +
                    "}" +
                    "return originalFetch.call(this, input, init);" +
                "};" +
                "history.pushState({}, '', '/');" +
                "window.dispatchEvent(new PopStateEvent('popstate'));" +
                "return true;" +
            "})()"
        );
        assertTrue("Could not open the Dashboard with an active resolver",
            result.optBoolean("value", false));
    }

    private void resetAgreementAndVpnState() throws Exception {
        requireWebViewValue(callWebView(
            "(async () => {" +
                "localStorage.removeItem('" + EULA_STORAGE_KEY + "');" +
                "try { await window.Capacitor.Plugins.SafeNetVpn.stopDnsProtection(); } " +
                "catch (_) {}" +
                "return true;" +
            "})()"
        ));
    }

    private void clickVpnControl() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const toggle = document.querySelector('[data-testid=\"switch-android-dns-vpn\"]');" +
                "if (!toggle || toggle.disabled || toggle.getAttribute('role') !== 'switch') return false;" +
                "toggle.click();" +
                "return true;" +
            "})()"
        );
        assertTrue("The packaged APK DNS VPN control could not be clicked",
            result.optBoolean("value", false));
    }

    private void waitForVpnButtonReady() throws Exception {
        waitForWebView(
            "(() => {" +
                "const toggle = document.querySelector('[data-testid=\"switch-android-dns-vpn\"]');" +
                "return Boolean(toggle && toggle.getAttribute('role') === 'switch' && !toggle.disabled && " +
                    "toggle.getAttribute('aria-label') === 'Android DNS VPN Off' && " +
                    "toggle.getAttribute('aria-checked') === 'false');" +
            "})()"
        );
    }

    private void clickAgreementCancel() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const button = document.querySelector('[data-testid=\"button-dns-vpn-eula-cancel\"]');" +
                "if (!button) return false;" +
                "button.click();" +
                "return true;" +
            "})()"
        );
        assertTrue("The DNS VPN agreement cancel action was not rendered",
            result.optBoolean("value", false));
    }

    private void clickAgreementAccept() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const button = document.querySelector('[data-testid=\"button-dns-vpn-eula-accept\"]');" +
                "if (!button) return false;" +
                "button.click();" +
                "return true;" +
            "})()"
        );
        assertTrue("The DNS VPN agreement accept action was not rendered",
            result.optBoolean("value", false));
    }

    private void waitForAgreementDialog() throws Exception {
        waitForWebView(
            "Boolean(document.querySelector('[data-testid=\"dialog-dns-vpn-eula\"]'))"
        );
        JSONObject dialog = callWebView(
            "document.querySelector('[data-testid=\"dialog-dns-vpn-eula\"]')?.textContent || ''"
        );
        assertTrue(
            "The first activation must show the SafeNet DNS VPN agreement",
            dialog.getString("value").contains("SafeNet DNS VPN agreement")
        );
    }

    private void waitForAgreementClosed() throws Exception {
        waitForWebView(
            "!Boolean(document.querySelector('[data-testid=\"dialog-dns-vpn-eula\"]'))"
        );
    }

    private UiObject2 waitForVpnConsentAction() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            UiObject2 action = device.findObject(
                By.text(Pattern.compile("(?i)(allow|ok|connect|i trust this application)"))
            );
            if (action != null && action.isEnabled()) {
                return action;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Android VPN consent dialog did not appear");
    }

    private boolean hasVpnConsentAction() {
        UiObject2 action = device.findObject(
            By.text(Pattern.compile("(?i)(allow|ok|connect|i trust this application)"))
        );
        return action != null && action.isEnabled();
    }

    private void cancelVpnConsent(UiObject2 consentAction) throws Exception {
        UiObject2 cancel = device.findObject(
            By.text(Pattern.compile("(?i)(cancel|deny|don't allow|not now)"))
        );
        if (cancel != null && cancel.isEnabled()) {
            cancel.click();
            return;
        }
        consentAction.getVisibleCenter();
        device.pressBack();
    }

    private String readEulaVersion() throws Exception {
        JSONObject result = callWebView(
            "window.localStorage.getItem('" + EULA_STORAGE_KEY + "')"
        );
        Object value = result.get("value");
        return JSONObject.NULL.equals(value) ? "null" : String.valueOf(value);
    }

    private boolean nativeDnsVpnRunning() throws Exception {
        JSONObject result = callWebView(
            "window.Capacitor.Plugins.SafeNetVpn.getDnsProtectionStatus()"
        );
        if (!result.optBoolean("ok", false)) {
            return false;
        }
        return result.optJSONObject("value") != null &&
            result.getJSONObject("value").optBoolean("running", false);
    }

    private void waitForWebView(String expression) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            JSONObject result = callWebView(expression);
            if (result.optBoolean("ok", false) && result.optBoolean("value", false)) {
                return;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Timed out waiting for WebView condition: " + expression);
    }

    private JSONObject requireWebViewValue(JSONObject result) throws Exception {
        assertTrue("WebView bridge call failed: " + result.optString("message"),
            result.optBoolean("ok", false));
        return result.getJSONObject("value");
    }

    private JSONObject callWebView(String expression) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        String[] rawResult = new String[1];
        TestResultBridge resultBridge = new TestResultBridge(rawResult, completed);
        String script =
            "(async function() {" +
                "try { return JSON.stringify({ok:true,value:await (" + expression + ")}); }" +
                "catch (error) { return JSON.stringify({ok:false,message:String(error.message||error)}); }" +
            "})()" +
            ".then(function(value) { window.DnsVpnEulaTestBridge.resolve(value); })" +
            ".catch(function(error) { window.DnsVpnEulaTestBridge.resolve(" +
                "JSON.stringify({ok:false,message:String(error.message||error)})); })";

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            webView.addJavascriptInterface(resultBridge, "DnsVpnEulaTestBridge");
            webView.evaluateJavascript(script, null);
        });

        try {
            if (!completed.await(JS_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                throw new AssertionError("Timed out evaluating WebView expression: " + expression);
            }
            if (rawResult[0] == null) {
                throw new AssertionError("WebView returned no result: " + expression);
            }
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                ((MainActivity) activity).getBridge().getWebView()
                    .removeJavascriptInterface("DnsVpnEulaTestBridge")
            );
        }
        return new JSONObject(rawResult[0]);
    }

    private boolean hasArgument(String name) {
        Bundle arguments = InstrumentationRegistry.getArguments();
        return arguments.containsKey(name);
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