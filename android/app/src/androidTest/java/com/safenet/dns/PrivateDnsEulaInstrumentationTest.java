package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
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

/**
 * Installed-APK coverage for the SafeNet Private DNS agreement. The test
 * verifies that the agreement appears before Android's Private DNS settings
 * screen is opened and that acceptance is reused.
 */
@RunWith(AndroidJUnit4.class)
public class PrivateDnsEulaInstrumentationTest {
    private static final String EULA_VERSION = "1.0";
    private static final String EULA_STORAGE_KEY = "safenet-private-dns-eula-version";
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
        if (activity != null && !activity.isFinishing()) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
        }
    }

    @Test
    public void agreementPrecedesPrivateDnsSettingsAndAcceptedVersionIsReused() throws Exception {
        openDashboardWithActiveResolver();
        assertTrue(callWebView(
            "localStorage.removeItem('" + EULA_STORAGE_KEY + "'); true"
        ).getBoolean("ok"));

        waitForWebView(
            "(() => {" +
                "const toggle = document.querySelector('[data-testid=\"switch-safe-net-private-dns\"]');" +
                "return Boolean(toggle && toggle.getAttribute('role') === 'switch' && !toggle.disabled && " +
                    "toggle.getAttribute('aria-label') === 'SafeNet Private DNS Disconnected');" +
            "})()"
        );

        clickPrivateDnsToggle();
        waitForWebView(
            "Boolean(document.querySelector('[data-testid=\"dialog-private-dns-eula\"]'))"
        );
        JSONObject dialog = callWebView(
            "document.querySelector('[data-testid=\"dialog-private-dns-eula\"]')?.textContent || ''"
        );
        assertTrue(dialog.optBoolean("ok", false));
        assertTrue(
            "The first activation must show the SafeNet Private DNS agreement",
            dialog.getString("value").contains("SafeNet Private DNS EULA")
        );

        clickButton("button-private-dns-eula-cancel");
        waitForWebView(
            "!Boolean(document.querySelector('[data-testid=\"dialog-private-dns-eula\"]'))"
        );
        assertEquals("null", readEulaVersion());

        clickPrivateDnsToggle();
        waitForWebView(
            "Boolean(document.querySelector('[data-testid=\"dialog-private-dns-eula\"]'))"
        );
        clickButton("button-private-dns-eula-accept");
        // Android owns the settings activity after acceptance. Return to
        // SafeNet before checking the post-consent state.
        InstrumentationRegistry.getInstrumentation().getUiAutomation().performGlobalAction(
            AccessibilityService.GLOBAL_ACTION_BACK
        );
        waitForWebView(
            "!Boolean(document.querySelector('[data-testid=\"dialog-private-dns-eula\"]'))"
        );
        assertEquals(EULA_VERSION, readEulaVersion());

        clickPrivateDnsToggle();
        assertEquals(
            EULA_VERSION,
            readEulaVersion()
        );
    }

    private void openDashboardWithActiveResolver() throws Exception {
        assertTrue(callWebView(
            "(() => {" +
                "const originalFetch = window.fetch;" +
                "window.fetch = function(input, init) {" +
                    "const url = typeof input === 'string' ? input : ((input && input.url) || '');" +
                    "if (url.includes('/api/dns')) {" +
                        "return Promise.resolve(new Response(JSON.stringify([{" +
                            "id: 1," +
                            "name: 'Google Secure DNS'," +
                            "type: 'doh'," +
                            "ipVersion: 'ipv4'," +
                            "primaryAddress: 'https://dns.google/dns-query'," +
                            "secondaryAddress: null," +
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
        ).optBoolean("ok", false));
    }

    private void clickPrivateDnsToggle() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const toggle = document.querySelector('[data-testid=\"switch-safe-net-private-dns\"]');" +
                "if (!toggle || toggle.disabled) return false;" +
                "toggle.click();" +
                "return true;" +
            "})()"
        );
        assertTrue(result.optBoolean("ok", false));
        assertTrue("The SafeNet Private DNS switch could not be clicked", result.getBoolean("value"));
    }

    private void clickButton(String testId) throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const button = document.querySelector('[data-testid=\"" + testId + "\"]');" +
                "if (!button) return false;" +
                "button.click();" +
                "return true;" +
            "})()"
        );
        assertTrue(result.optBoolean("ok", false));
        assertTrue("Missing button " + testId, result.getBoolean("value"));
    }

    private String readEulaVersion() throws Exception {
        JSONObject result = callWebView(
            "localStorage.getItem('" + EULA_STORAGE_KEY + "')"
        );
        assertTrue(result.optBoolean("ok", false));
        return JSONObject.NULL.equals(result.get("value")) ? "null" : String.valueOf(result.get("value"));
    }

    private void waitForWebView(String expression) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            JSONObject result = callWebView(expression);
            if (result.optBoolean("ok", false) && result.optBoolean("value", false)) return;
            Thread.sleep(250);
        }
        throw new AssertionError("Timed out waiting for WebView condition: " + expression);
    }

    private JSONObject requireValue(JSONObject result) throws Exception {
        assertTrue("WebView bridge call failed: " + result.optString("message"), result.optBoolean("ok", false));
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
            ".then(function(value) { window.PrivateDnsEulaTestBridge.resolve(value); })";

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            webView.addJavascriptInterface(resultBridge, "PrivateDnsEulaTestBridge");
            webView.evaluateJavascript(script, null);
        });
        try {
            if (!completed.await(JS_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                throw new AssertionError("Timed out evaluating WebView expression: " + expression);
            }
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                ((MainActivity) activity).getBridge().getWebView()
                    .removeJavascriptInterface("PrivateDnsEulaTestBridge")
            );
        }
        return new JSONObject(rawResult[0]);
    }

    private boolean hasArgument(String key) {
        return InstrumentationRegistry.getArguments().getString(key) != null;
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