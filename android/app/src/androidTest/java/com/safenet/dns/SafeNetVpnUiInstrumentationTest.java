package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.VpnService;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Accessibility checks for the VPN switch rendered by the Android WebView.
 *
 * This deliberately keeps resolver data out of the page so the switch must
 * remain visible, correctly labelled, and safely unavailable when there is no
 * active DNS resolver.
 */
@RunWith(AndroidJUnit4.class)
public class SafeNetVpnUiInstrumentationTest {
    private static final String PACKAGE_NAME = "com.safenet.dns";
    private static final String VPN_SWITCH_LABEL = "Enable DNS Protection VPN";
    private static final long JS_TIMEOUT_SECONDS = 20;
    private static final long UI_TIMEOUT_MILLIS = 20_000;

    private final Context context =
        InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiDevice device =
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private Activity activity;

    @Before
    public void setUp() throws Exception {
        assertEquals(PACKAGE_NAME, context.getPackageName());
        context.stopService(new Intent(context, SafeNetVpnService.class));
        clearTargetAppData();

        Intent launchIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        activity = InstrumentationRegistry.getInstrumentation().startActivitySync(launchIntent);
        waitForCapacitorBridge();
    }

    @After
    public void tearDown() throws Exception {
        if (activity != null && !activity.isFinishing()) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
        }
    }

    @Test
    public void vpnSwitchIsAccessibleAndUnavailableWithoutActiveResolver() throws Exception {
        openDashboardWithoutActiveResolver();
        waitForWebView(
            "Boolean(document.querySelector('[role=\"switch\"][aria-label=\"" +
                VPN_SWITCH_LABEL +
                "\"]'))"
        );

        JSONObject domState = callWebView(
            "(() => {" +
                "const toggle = document.querySelector('[role=\"switch\"][aria-label=\"" +
                    VPN_SWITCH_LABEL +
                    "\"]');" +
                "const beforeClick = toggle.getAttribute('aria-checked');" +
                "const count = document.querySelectorAll('[role=\"switch\"][aria-label=\"" +
                    VPN_SWITCH_LABEL +
                    "\"]').length;" +
                "toggle.focus();" +
                "const focusedAfterProgrammaticFocus = document.activeElement === toggle;" +
                "toggle.click();" +
                "return {" +
                    "count: count," +
                    "label: toggle.getAttribute('aria-label')," +
                    "role: toggle.getAttribute('role')," +
                    "checked: toggle.getAttribute('aria-checked')," +
                    "disabled: toggle.disabled," +
                    "focusable: focusedAfterProgrammaticFocus," +
                    "afterClick: toggle.getAttribute('aria-checked')," +
                    "beforeClick: beforeClick" +
                "};" +
            "})()"
        );

        assertEquals("Dashboard must render exactly one VPN switch", 1, domState.getInt("count"));
        assertEquals(VPN_SWITCH_LABEL, domState.getString("label"));
        assertEquals("switch", domState.getString("role"));
        assertEquals("false", domState.getString("checked"));
        assertTrue("No resolver must disable the VPN switch", domState.getBoolean("disabled"));
        assertFalse(
            "A disabled VPN switch must not receive programmatic focus",
            domState.getBoolean("focusable")
        );
        assertEquals("false", domState.getString("beforeClick"));
        assertEquals(
            "A disabled VPN switch must not change state from a click",
            "false",
            domState.getString("afterClick")
        );

        JSONObject scrollResult = callWebView(
            "(() => {" +
                "document.querySelector('[role=\"switch\"][aria-label=\"" +
                    VPN_SWITCH_LABEL +
                    "\"]').scrollIntoView({block:'center'});" +
                "return true;" +
            "})()"
        );
        assertTrue(
            "Could not bring the VPN switch into the WebView viewport",
            scrollResult.getBoolean("ok")
        );

        UiObject2 accessibleSwitch = device.wait(
            Until.findObject(By.desc(VPN_SWITCH_LABEL)),
            UI_TIMEOUT_MILLIS
        );
        assertNotNull(
            "The Android accessibility tree must expose the VPN switch label",
            accessibleSwitch
        );
        assertEquals(VPN_SWITCH_LABEL, accessibleSwitch.getContentDescription());
        assertTrue("The VPN control must expose switch semantics", accessibleSwitch.isCheckable());
        assertFalse("The VPN switch must initially be unchecked", accessibleSwitch.isChecked());
        assertFalse("The VPN switch must be disabled without a resolver", accessibleSwitch.isEnabled());
        assertFalse("A disabled VPN switch must not be clickable", accessibleSwitch.isClickable());
        assertFalse("A disabled VPN switch must not be focusable", accessibleSwitch.isFocusable());

        device.pressKeyCode(KeyEvent.KEYCODE_TAB);
        assertFalse(
            "Keyboard navigation must not focus the disabled VPN switch",
            accessibleSwitch.isFocused()
        );
    }

    @Test
    public void dashboardCardReflectsNativeVpnLifecycle() throws Exception {
        waitForWebView(dashboardCardExpression("card !== null"));
        waitForWebView(
            dashboardCardExpression(
                "['checking', 'inactive', 'error'].includes(card.getAttribute('data-vpn-state'))"
            )
        );

        clickDashboardEula();
        clickEulaAgreement();
        clickEulaAccept();
        waitForWebView("!Boolean(document.querySelector('[role=\"dialog\"]'))");
        JSONObject started = startVpnWithPermission("plain", "1.1.1.1", "8.8.8.8");
        assertTrue(
            "The Dashboard lifecycle check could not start the native VPN",
            started.getBoolean("ok")
        );
        waitForVpnState(true);
        waitForWebView(dashboardCardExpression(
            "'running' === card.getAttribute('data-vpn-state')"
        ));
        JSONObject runningCard = callWebView(dashboardStatusExpression(
            "state: card.getAttribute('data-vpn-state'), " +
                "text: status?.textContent || ''"
        ));
        assertEquals("running", runningCard.getString("state"));
        assertTrue(
            "The Dashboard must report active DNS protection while the native VPN runs",
            runningCard.getString("text").contains("DNS protection is running")
        );

        JSONObject stopped = callVpn("window.Capacitor.Plugins.SafeNetVpn.stop()");
        assertTrue("The native VPN stop call failed", stopped.getBoolean("ok"));
        waitForVpnState(false);
        waitForWebView(dashboardCardExpression(
            "['inactive', 'error'].includes(card.getAttribute('data-vpn-state'))"
        ));
        JSONObject stoppedCard = callWebView(dashboardStatusExpression(
            "state: card.getAttribute('data-vpn-state'), " +
                "text: status?.textContent || ''"
        ));
        String stoppedText = stoppedCard.getString("text");
        assertTrue(
            "The Dashboard must report an inactive or error state after stopping the native VPN",
            "inactive".equals(stoppedCard.getString("state")) ||
                "error".equals(stoppedCard.getString("state"))
        );
        assertFalse(
            "The Dashboard must not retain the running status after stopping the native VPN",
            stoppedText.contains("DNS protection is running")
        );
    }

    @Test
    public void vpnSwitchReflectsRunningServiceAndReturnsToUncheckedWhenStopped() throws Exception {
        openDashboardWithActiveResolver();
        waitForWebView(vpnSwitchExpression("toggle !== null && !toggle.disabled"));

        clickVpnSwitch();
        waitForWebView("Boolean(document.querySelector('[role=\"dialog\"]'))");
        clickEulaAgreement();
        clickEulaAccept();

        if (VpnService.prepare(context) != null) {
            grantVpnPermissionDialog();
        }
        waitForVpnState(true);
        waitForWebView(vpnSwitchExpression("toggle.getAttribute('aria-checked') === 'true'"));

        UiObject2 accessibleSwitch = findAccessibleVpnSwitch();
        assertEquals(VPN_SWITCH_LABEL, accessibleSwitch.getContentDescription());
        assertTrue("The running VPN must expose switch semantics", accessibleSwitch.isCheckable());
        assertTrue("The VPN switch must be checked while protection is running",
            accessibleSwitch.isChecked());
        assertTrue("The running VPN switch must be enabled", accessibleSwitch.isEnabled());

        clickVpnSwitch();
        waitForVpnState(false);
        waitForWebView(vpnSwitchExpression("toggle.getAttribute('aria-checked') === 'false'"));

        accessibleSwitch = findAccessibleVpnSwitch();
        assertEquals(
            "Stopping protection must not remove the VPN switch accessible name",
            VPN_SWITCH_LABEL,
            accessibleSwitch.getContentDescription()
        );
        assertTrue("The stopped VPN must retain switch semantics", accessibleSwitch.isCheckable());
        assertFalse("The VPN switch must be unchecked after protection stops",
            accessibleSwitch.isChecked());
    }

    @Test
    public void vpnSwitchRecoversWhenNativeServiceIsStoppedExternally() throws Exception {
        openDashboardWithActiveResolver();
        waitForWebView(vpnSwitchExpression("toggle !== null && !toggle.disabled"));

        clickVpnSwitch();
        waitForWebView("Boolean(document.querySelector('[role=\"dialog\"]'))");
        clickEulaAgreement();
        clickEulaAccept();

        if (VpnService.prepare(context) != null) {
            grantVpnPermissionDialog();
        }
        waitForVpnState(true);
        waitForWebView(vpnSwitchExpression("toggle.getAttribute('aria-checked') === 'true'"));

        context.stopService(new Intent(context, SafeNetVpnService.class));

        waitForVpnState(false);
        waitForWebView(vpnSwitchExpression("toggle.getAttribute('aria-checked') === 'false'"));
        JSONObject stoppedState = callWebView(
            "(() => {" +
                "const toggle = document.querySelector('[role=\"switch\"][aria-label=\"" +
                    VPN_SWITCH_LABEL +
                    "\"]');" +
                "const text = document.body.innerText;" +
                "return {" +
                    "label: toggle?.getAttribute('aria-label')," +
                    "checked: toggle?.getAttribute('aria-checked')," +
                    "stopped: text.includes('DNS protection stopped')," +
                    "actionable: text.includes('Turn the switch on to reconnect DNS protection.')" +
                "};" +
            "})()"
        );

        assertEquals(VPN_SWITCH_LABEL, stoppedState.getString("label"));
        assertEquals("false", stoppedState.getString("checked"));
        assertTrue("Settings must explain that externally stopped protection needs attention",
            stoppedState.getBoolean("stopped"));
        assertTrue("Settings must tell users how to recover stopped protection",
            stoppedState.getBoolean("actionable"));

        UiObject2 accessibleSwitch = findAccessibleVpnSwitch();
        assertEquals(VPN_SWITCH_LABEL, accessibleSwitch.getContentDescription());
        assertTrue("The stopped VPN must retain switch semantics", accessibleSwitch.isCheckable());
        assertFalse("The switch must be unchecked after Android stops the service",
            accessibleSwitch.isChecked());
        assertTrue("The switch must remain enabled so users can restart protection",
            accessibleSwitch.isEnabled());
    }

    @Test
    public void vpnSwitchRecoversWhenAndroidRevokesVpnAccess() throws Exception {
        openDashboardWithActiveResolver();
        waitForWebView(vpnSwitchExpression("toggle !== null && !toggle.disabled"));

        clickVpnSwitch();
        waitForWebView("Boolean(document.querySelector('[role=\"dialog\"]'))");
        clickEulaAgreement();
        clickEulaAccept();

        if (VpnService.prepare(context) != null) {
            grantVpnPermissionDialog();
        }
        waitForVpnState(true);
        waitForWebView(vpnSwitchExpression("toggle.getAttribute('aria-checked') === 'true'"));

        SafeNetVpnService.invokeOnRevokeForTesting();

        JSONObject revokedState = waitForRevokedVpnStatus();
        assertFalse("The bridge must report the VPN stopped after Android revokes access",
            revokedState.getBoolean("running"));
        assertEquals(
            "Android revoked VPN access. Turn the switch on to reconnect.",
            revokedState.getString("error")
        );
        waitForWebView(vpnSwitchExpression("toggle.getAttribute('aria-checked') === 'false'"));

        JSONObject domState = callWebView(
            "(() => {" +
                "const toggle = document.querySelector('[role=\"switch\"][aria-label=\"" +
                    VPN_SWITCH_LABEL +
                    "\"]');" +
                "return {" +
                    "label: toggle?.getAttribute('aria-label')," +
                    "checked: toggle?.getAttribute('aria-checked')," +
                    "enabled: toggle && !toggle.disabled," +
                    "revoked: document.body.innerText.includes('Android revoked VPN access')," +
                    "actionable: document.body.innerText.includes(" +
                        "'Turn the switch on to reconnect DNS protection.')" +
                "};" +
            "})()"
        );

        assertEquals(VPN_SWITCH_LABEL, domState.getString("label"));
        assertEquals("false", domState.getString("checked"));
        assertTrue("The revoked VPN switch must remain enabled for recovery",
            domState.getBoolean("enabled"));
        assertTrue("Settings must display the Android VPN revocation error",
            domState.getBoolean("revoked"));
        assertTrue("Settings must tell users how to recover revoked protection",
            domState.getBoolean("actionable"));

        UiObject2 accessibleSwitch = findAccessibleVpnSwitch();
        assertEquals(VPN_SWITCH_LABEL, accessibleSwitch.getContentDescription());
        assertTrue("The revoked VPN must retain switch semantics", accessibleSwitch.isCheckable());
        assertFalse("The switch must be unchecked after Android revokes access",
            accessibleSwitch.isChecked());
        assertTrue("The switch must remain enabled so users can restart protection",
            accessibleSwitch.isEnabled());
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

    private void openDashboardWithoutActiveResolver() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const originalFetch = window.fetch;" +
                "window.fetch = function(input, init) {" +
                    "const url = typeof input === 'string' ? input : ((input && input.url) || '');" +
                    "if (url.includes('/api/dns')) {" +
                        "return Promise.resolve(new Response('[]', {" +
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
        assertTrue("Could not navigate to the Dashboard in the WebView", result.getBoolean("ok"));
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
        assertTrue("Could not navigate to the Dashboard with an active resolver", result.getBoolean("ok"));
    }

    private String vpnSwitchExpression(String condition) {
        return "(() => {" +
            "const toggle = document.querySelector('[role=\"switch\"][aria-label=\"" +
                VPN_SWITCH_LABEL +
                "\"]');" +
            "return toggle !== null && (" + condition + ");" +
        "})()";
    }

    private String dashboardCardExpression(String condition) {
        return "(() => {" +
            "const card = document.querySelector('[data-testid=\"dashboard-vpn-card\"]');" +
            "return " + condition + ";" +
        "})()";
    }

    private String dashboardStatusExpression(String fields) {
        return "(() => {" +
            "const card = document.querySelector('[data-testid=\"dashboard-vpn-card\"]');" +
            "const status = card?.querySelector('[data-testid=\"dashboard-vpn-status\"]');" +
            "return {" + fields + "};" +
        "})()";
    }

    private void clickDashboardEula() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const button = Array.from(document.querySelectorAll('button')).find((item) => " +
                    "item.textContent.includes('View DNS VPN EULA'));" +
                "if (!button) return false;" +
                "button.click();" +
                "return true;" +
            "})()"
        );
        assertTrue(
            "The Dashboard must expose the shared DNS VPN EULA action",
            result.getBoolean("ok") && result.getBoolean("value")
        );
        waitForWebView(
            "Boolean(document.querySelector('[role=\"dialog\"]')?.textContent.includes(" +
                "'SafeNet DNS VPN End User License Agreement'))"
        );
    }

    private void clickVpnSwitch() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const toggle = document.querySelector('[role=\"switch\"][aria-label=\"" +
                    VPN_SWITCH_LABEL +
                    "\"]');" +
                "if (!toggle) return false;" +
                "toggle.click();" +
                "return true;" +
            "})()"
        );
        assertTrue(
            "Could not click the VPN switch in the WebView",
            result.getBoolean("ok") && result.getBoolean("value")
        );
    }

    private void clickEulaAgreement() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const agreement = document.querySelector('#safenet-vpn-eula-agreement');" +
                "if (!agreement) return false;" +
                "agreement.click();" +
                "return true;" +
            "})()"
        );
        assertTrue("The DNS VPN EULA agreement checkbox was not rendered",
            result.getBoolean("value"));
        waitForWebView(
            "document.querySelector('#safenet-vpn-eula-agreement')?.getAttribute('aria-checked') === " +
                "'true'"
        );
    }

    private void clickEulaAccept() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "const dialog = document.querySelector('[role=\"dialog\"]');" +
                "if (!dialog) return false;" +
                "const button = Array.from(dialog.querySelectorAll('button')).find((item) => " +
                    "item.textContent.includes('Accept and continue'));" +
                "if (!button) return false;" +
                "button.click();" +
                "return true;" +
            "})()"
        );
        assertTrue("The DNS VPN EULA accept button was not rendered",
            result.getBoolean("value"));
    }

    private UiObject2 findAccessibleVpnSwitch() {
        UiObject2 accessibleSwitch = device.wait(
            Until.findObject(By.desc(VPN_SWITCH_LABEL)),
            UI_TIMEOUT_MILLIS
        );
        assertNotNull(
            "The Android accessibility tree must expose the VPN switch label",
            accessibleSwitch
        );
        return accessibleSwitch;
    }

    private void waitForVpnState(boolean expected) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            JSONObject result = callWebView(
                "window.Capacitor.Plugins.SafeNetVpn.getStatus()"
            );
            JSONObject value = result.optJSONObject("value");
            if (result.optBoolean("ok", false) &&
                value != null &&
                expected == value.optBoolean("running", false)) {
                return;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Native SafeNetVpn service did not become running=" + expected);
    }

    private JSONObject waitForRevokedVpnStatus() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            JSONObject result = callWebView(
                "window.Capacitor.Plugins.SafeNetVpn.getStatus()"
            );
            JSONObject value = result.optJSONObject("value");
            if (result.optBoolean("ok", false) &&
                value != null &&
                !value.optBoolean("running", true) &&
                "Android revoked VPN access. Turn the switch on to reconnect."
                    .equals(value.optString("error"))) {
                return value;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Native SafeNetVpn service did not report Android VPN revocation");
    }

    private void grantVpnPermissionDialog() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            UiObject2 allow = device.findObject(
                By.text(Pattern.compile("(?i)(allow|ok|connect|i trust this application)"))
            );
            if (allow != null && allow.isEnabled()) {
                allow.click();
                return;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Android VPN permission dialog did not appear");
    }

    private void waitForCapacitorBridge() throws Exception {
        waitForWebView(
            "Boolean(window.Capacitor && window.Capacitor.Plugins && " +
                "window.Capacitor.Plugins.SafeNetVpn)"
        );
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

    private JSONObject callVpn(String expression) throws Exception {
        return callVpn(expression, false);
    }

    private JSONObject callVpn(String expression, boolean handlePermission) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        String[] rawResult = new String[1];
        TestResultBridge resultBridge = new TestResultBridge(rawResult, completed);
        String script =
            "(async function() {" +
                "try { return JSON.stringify({ok:true,value:await (" + expression + ")}); }" +
                "catch (error) { return JSON.stringify({ok:false,message:String(error.message||error)," +
                    "code:error.code||''}); }" +
            "})()" +
            ".then(function(value) { window.SafeNetVpnUiTestBridge.resolve(value); })" +
            ".catch(function(error) { window.SafeNetVpnUiTestBridge.resolve(" +
                "JSON.stringify({ok:false,message:String(error.message||error),code:error.code||''})); })";

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            webView.addJavascriptInterface(resultBridge, "SafeNetVpnUiTestBridge");
            webView.evaluateJavascript(script, null);
        });

        try {
            if (handlePermission && VpnService.prepare(context) != null) {
                grantVpnPermissionDialog();
            }
            if (!completed.await(JS_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                throw new AssertionError("Timed out waiting for SafeNetVpn bridge call: " + expression);
            }
            if (rawResult[0] == null) {
                throw new AssertionError("SafeNetVpn bridge returned no result");
            }
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                ((MainActivity) activity).getBridge().getWebView()
                    .removeJavascriptInterface("SafeNetVpnUiTestBridge")
            );
        }
        return new JSONObject(rawResult[0]);
    }

    private JSONObject startVpnWithPermission(String type, String primary, String secondary)
        throws Exception {
        JSONObject result = callVpn(
            "window.Capacitor.Plugins.SafeNetVpn.start(" +
                "{\"type\":\"" + jsQuote(type) + "\",\"primaryAddress\":\"" +
                jsQuote(primary) + "\",\"secondaryAddress\":\"" + jsQuote(secondary) + "\"})",
            true
        );
        assertTrue(
            "VPN start failed code=" + result.optString("code") +
                " message=" + result.optString("message"),
            result.optBoolean("ok", false)
        );
        return result;
    }

    private String jsQuote(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
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
            ".then(function(value) { window.SafeNetVpnUiTestBridge.resolve(value); })" +
            ".catch(function(error) { window.SafeNetVpnUiTestBridge.resolve(" +
                "JSON.stringify({ok:false,message:String(error.message||error)})); })";

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            webView.addJavascriptInterface(resultBridge, "SafeNetVpnUiTestBridge");
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
                    .removeJavascriptInterface("SafeNetVpnUiTestBridge")
            );
        }
        return new JSONObject(rawResult[0]);
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