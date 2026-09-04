package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.ParcelFileDescriptor;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.getcapacitor.BridgeWebViewClient;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Release smoke coverage for the PIN gate rendered by the shipped WebView.
 *
 * The API fixture is installed by wrapping Capacitor's own WebView client. It
 * only replaces the PIN endpoints, so this test exercises the production
 * React/query flow while keeping the release lane independent of a shared
 * account, mailbox, or deployed PIN.
 */
@RunWith(AndroidJUnit4.class)
public class SafeNetPinInstrumentationTest {
    private static final String PACKAGE_NAME = "com.safenet.dns";
    private static final long JS_TIMEOUT_SECONDS = 20;

    private final Context context =
        InstrumentationRegistry.getInstrumentation().getTargetContext();
    private Activity activity;
    private final PinSmokeBackend backend = new PinSmokeBackend();

    @Before
    public void setUp() throws Exception {
        assertEquals(PACKAGE_NAME, context.getPackageName());
        context.stopService(new Intent(context, SafeNetVpnService.class));
        clearTargetAppData();
        launchWithPinFixture();
    }

    @After
    public void tearDown() throws Exception {
        if (activity != null && !activity.isFinishing()) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
        }
    }

    @Test
    public void pinGateSurvivesRelaunchAndRecoversAfterLockout() throws Exception {
        assertPinGateVisible();
        recordOutcome("initial_gate");

        forceStopAndRelaunch();
        assertPinGateVisible();
        recordOutcome("relaunch_gate");

        enterPinDigits();
        waitForWebView("document.body.innerText.includes('Access denied')");
        recordOutcome("incorrect_pin");

        for (int attempt = 0; attempt < 4; attempt += 1) {
            enterPinDigits();
            waitForWebView("document.body.innerText.includes('Access denied')");
        }
        // The fifth bad attempt fills the server's failure window. The next
        // request is the first one rejected as a lockout.
        enterPinDigits();
        waitForWebView("document.body.innerText.includes('Too many attempts')");
        recordOutcome("fifth_attempt_lockout");

        requestRecovery();
        resetWithRecovery();
        waitForWebView("document.body.innerText.includes('System Settings')");
        assertTrue(
            "A successful recovery must leave the protected application screen visible",
            callWebView("document.body.innerText.includes('System Settings')")
                .getBoolean("value")
        );
        recordOutcome("recovery_reset");
    }

    private void launchWithPinFixture() throws Exception {
        Intent launchIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        activity = InstrumentationRegistry.getInstrumentation().startActivitySync(launchIntent);

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            ((MainActivity) activity).getBridge().setWebViewClient(
                new PinSmokeWebViewClient(((MainActivity) activity).getBridge(), backend)
            );
            // The first page load may have started before the test client was
            // installed. Reload so every API request is handled by the fixture.
            webView.reload();
        });
        waitForWebView("Boolean(document.querySelector('button[aria-label=\"Enter 1\"]'))");
    }

    private void forceStopAndRelaunch() throws Exception {
        activity = null;
        ParcelFileDescriptor output = InstrumentationRegistry.getInstrumentation()
            .getUiAutomation()
            .executeShellCommand("am force-stop " + PACKAGE_NAME);
        try (ParcelFileDescriptor.AutoCloseInputStream input =
                 new ParcelFileDescriptor.AutoCloseInputStream(output)) {
            while (input.read() != -1) {
                // Wait for am force-stop to complete before relaunching.
            }
        }
        launchWithPinFixture();
    }

    private void assertPinGateVisible() throws Exception {
        JSONObject state = callWebView(
            "(() => {" +
                "const body = document.body.innerText;" +
                "return {" +
                    "gate: body.includes('Secure Access Required')," +
                    "pinControl: Boolean(document.querySelector('button[aria-label=\"Enter 1\"]'))," +
                    "protectedScreen: body.includes('System Settings')" +
                "};" +
            "})()"
        );
        assertTrue("The PIN gate must be visible", state.getBoolean("gate"));
        assertTrue("The PIN keypad must be rendered", state.getBoolean("pinControl"));
        assertTrue(
            "Protected screens must not be visible before PIN verification",
            !state.getBoolean("protectedScreen")
        );
    }

    private void enterPinDigits() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const buttons = Array.from(document.querySelectorAll('button'));" +
                "const digit = buttons.find((button) => button.getAttribute('aria-label') === 'Enter 0');" +
                "if (!digit) return false;" +
                "for (let index = 0; index < 4; index += 1) digit.click();" +
                "return true;" +
            "})()"
        );
        assertTrue("The PIN keypad must accept an entered attempt", result.getBoolean("value"));
    }

    private void requestRecovery() throws Exception {
        JSONObject expanded = callWebView(
            "(() => {" +
                "const button = Array.from(document.querySelectorAll('button')).find((item) => " +
                    "item.textContent.includes('Forgot PIN? Recover by email'));" +
                "if (!button) return false;" +
                "button.click();" +
                "return true;" +
            "})()"
        );
        assertTrue("The PIN recovery control must be rendered", expanded.getBoolean("value"));
        waitForWebView("Boolean(document.querySelector('input[aria-label=\"Recovery email\"]'))");

        setInputValue("Recovery email", "pin-smoke@example.invalid");
        JSONObject requested = callWebView(
            "(() => {" +
                "const button = Array.from(document.querySelectorAll('button')).find((item) => " +
                    "item.textContent.includes('Send recovery code'));" +
                "if (!button) return false;" +
                "button.click();" +
                "return true;" +
            "})()"
        );
        assertTrue("The recovery request control must be rendered", requested.getBoolean("value"));
        waitForWebView("Boolean(document.querySelector('input[aria-label=\"Recovery code\"]'))");
    }

    private void resetWithRecovery() throws Exception {
        // These values are consumed only by the in-test fixture. They are
        // deliberately never included in outcome lines or failure messages.
        setInputValue("Recovery code", "123456");
        setInputValue("New PIN", "5931");
        JSONObject reset = callWebView(
            "(() => {" +
                "const button = Array.from(document.querySelectorAll('button')).find((item) => " +
                    "item.textContent.includes('Reset PIN and unlock'));" +
                "if (!button) return false;" +
                "button.click();" +
                "return true;" +
            "})()"
        );
        assertTrue("The recovery reset control must be rendered", reset.getBoolean("value"));
    }

    private void setInputValue(String ariaLabel, String value) throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const input = document.querySelector('input[aria-label=\"" + jsQuote(ariaLabel) + "\"]');" +
                "if (!input) return false;" +
                "const setter = Object.getOwnPropertyDescriptor(" +
                    "HTMLInputElement.prototype, 'value').set;" +
                "setter.call(input, \"" + jsQuote(value) + "\");" +
                "input.dispatchEvent(new Event('input', {bubbles:true}));" +
                "input.dispatchEvent(new Event('change', {bubbles:true}));" +
                "return true;" +
            "})()"
        );
        assertTrue("The recovery form input must be available: " + ariaLabel,
            result.getBoolean("value"));
    }

    private void recordOutcome(String name) {
        System.out.println("PIN_SMOKE_OUTCOME " + name + "=PASS");
    }

    private void clearTargetAppData() throws Exception {
        ParcelFileDescriptor output = InstrumentationRegistry.getInstrumentation()
            .getUiAutomation()
            .executeShellCommand("pm clear " + PACKAGE_NAME);
        StringBuilder commandOutput = new StringBuilder();
        try (ParcelFileDescriptor.AutoCloseInputStream input =
                 new ParcelFileDescriptor.AutoCloseInputStream(output)) {
            int value;
            while ((value = input.read()) != -1) {
                commandOutput.append((char) value);
            }
        }
        assertTrue(
            "Could not reset target app: " + commandOutput,
            commandOutput.toString().contains("Success")
        );
    }

    private void waitForWebView(String expression) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            try {
                JSONObject result = callWebView(expression);
                if (result.optBoolean("ok", false) && result.optBoolean("value", false)) {
                    return;
                }
            } catch (Exception ignored) {
                // The WebView can be between page loads after a force-stop.
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Timed out waiting for WebView condition");
    }

    private JSONObject callWebView(String expression) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        String[] rawResult = new String[1];
        PinSmokeResultBridge resultBridge = new PinSmokeResultBridge(rawResult, completed);
        String script =
            "(async function() {" +
                "try { return JSON.stringify({ok:true,value:await (" + expression + ")}); }" +
                "catch (error) { return JSON.stringify({ok:false,message:String(error.message||error)}); }" +
            "})()" +
            ".then(function(value) { window.SafeNetPinTestBridge.resolve(value); })" +
            ".catch(function(error) { window.SafeNetPinTestBridge.resolve(" +
                "JSON.stringify({ok:false,message:String(error.message||error)})); })";

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            webView.addJavascriptInterface(resultBridge, "SafeNetPinTestBridge");
            webView.evaluateJavascript(script, null);
        });

        try {
            if (!completed.await(JS_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                throw new AssertionError("Timed out evaluating WebView expression");
            }
            if (rawResult[0] == null) {
                throw new AssertionError("WebView returned no result");
            }
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                ((MainActivity) activity).getBridge().getWebView()
                    .removeJavascriptInterface("SafeNetPinTestBridge")
            );
        }
        return new JSONObject(rawResult[0]);
    }

    private static String jsQuote(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static final class PinSmokeResultBridge {
        private final String[] result;
        private final CountDownLatch completed;

        PinSmokeResultBridge(String[] result, CountDownLatch completed) {
            this.result = result;
            this.completed = completed;
        }

        @android.webkit.JavascriptInterface
        public void resolve(String value) {
            result[0] = value;
            completed.countDown();
        }
    }

    private static final class PinSmokeWebViewClient extends BridgeWebViewClient {
        private final PinSmokeBackend backend;

        PinSmokeWebViewClient(com.getcapacitor.Bridge bridge, PinSmokeBackend backend) {
            super(bridge);
            this.backend = backend;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(
            WebView view,
            WebResourceRequest request
        ) {
            WebResourceResponse fixtureResponse = backend.responseFor(
                request.getUrl(),
                request.getMethod()
            );
            return fixtureResponse != null ? fixtureResponse : super.shouldInterceptRequest(view, request);
        }
    }

    private static final class PinSmokeBackend {
        private int failedAttempts;
        private boolean unlocked;

        synchronized WebResourceResponse responseFor(Uri uri, String method) {
            String path = uri.getPath();
            if (path == null || !path.startsWith("/api/")) {
                return null;
            }
            if ("OPTIONS".equalsIgnoreCase(method)) {
                return response(204, "", "text/plain");
            }

            if ("/api/auth/status".equals(path)) {
                return json(200, unlocked
                    ? "{\"authenticated\":true,\"pinRequired\":true}"
                    : "{\"authenticated\":false,\"pinRequired\":true}");
            }
            if ("/api/settings".equals(path)) {
                return json(200, settingsJson());
            }
            if ("/api/firewall/config".equals(path)) {
                return json(200, "{\"settings\":" + settingsJson() +
                    ",\"rules\":[],\"blocklists\":[]}");
            }
            if ("/api/settings/verify-pin".equals(path)) {
                if (failedAttempts >= 5) {
                    return jsonWithHeaders(429, "{\"message\":\"Too many attempts. Try again later.\"}",
                        Collections.singletonMap("Retry-After", "900"));
                }
                failedAttempts += 1;
                return json(401, "{\"valid\":false,\"message\":\"Invalid PIN\"}");
            }
            if ("/api/settings/pin-recovery/request".equals(path)) {
                return json(200, "{\"sent\":true,\"message\":\"Recovery request accepted.\"}");
            }
            if ("/api/settings/pin-recovery/reset".equals(path)) {
                unlocked = true;
                failedAttempts = 0;
                return json(200, "{\"valid\":true}");
            }
            return json(200, "[]");
        }

        private static String settingsJson() {
            return "{" +
                "\"id\":1," +
                "\"pinRecoveryEmail\":\"pin-smoke@example.invalid\"," +
                "\"pinConfigured\":true," +
                "\"isPinEnabled\":true," +
                "\"aiShieldEnabled\":false," +
                "\"alwaysOnEnabled\":false," +
                "\"deviceAdminEnabled\":false," +
                "\"firewallEnabled\":false," +
                "\"theme\":\"red-gray-blue\"" +
            "}";
        }

        private static WebResourceResponse json(int statusCode, String body) {
            return response(statusCode, body, "application/json", Collections.emptyMap());
        }

        private static WebResourceResponse jsonWithHeaders(
            int statusCode,
            String body,
            Map<String, String> extraHeaders
        ) {
            return response(statusCode, body, "application/json", extraHeaders);
        }

        private static WebResourceResponse response(
            int statusCode,
            String body,
            String mimeType,
            Map<String, String> extraHeaders
        ) {
            Map<String, String> headers = new HashMap<>(extraHeaders);
            // The packaged Capacitor page runs at http://localhost. Include
            // credentials because the production hooks use cookie sessions.
            headers.put("Access-Control-Allow-Origin", "http://localhost");
            headers.put("Access-Control-Allow-Credentials", "true");
            headers.put("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
            headers.put("Access-Control-Allow-Headers", "Content-Type");
            headers.put("Content-Type", mimeType);
            return new WebResourceResponse(
                mimeType,
                "UTF-8",
                statusCode,
                statusCode == 204 ? "No Content" : statusCode >= 400 ? "Fixture response" : "OK",
                headers,
                new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8))
            );
        }
    }
}