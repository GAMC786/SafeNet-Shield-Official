package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.util.Base64;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebView;

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

import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

@RunWith(AndroidJUnit4.class)
public class RevenueCatBillingInstrumentationTest {
    private static final String PACKAGE_NAME = "com.safenet.dns";
    private static final String PROOF_TAG = "RevenueCatBillingProof";
    private static final long WEBVIEW_TIMEOUT_SECONDS = 30;
    private static final long ENTITLEMENT_TIMEOUT_SECONDS = 180;

    private final Context context =
        InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiDevice device =
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private Activity activity;

    @Before
    public void setUp() throws Exception {
        assertEquals(PACKAGE_NAME, context.getPackageName());
        Intent launchIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        activity = InstrumentationRegistry.getInstrumentation().startActivitySync(launchIntent);
        waitForWebView("Boolean(window.Capacitor && window.Capacitor.Plugins)");
    }

    @After
    public void tearDown() {
        if (activity != null && !activity.isFinishing()) {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(activity::finish);
        }
    }

    @Test
    public void purchaseRestoreAndStatusStayLinked() throws Exception {
        String origin = requiredArgument("clerk-origin");
        String encodedCookies = requiredArgument("clerk-cookie-base64");
        String action = argument("billing-action", "purchase");
        String confirmText = argument("billing-purchase-confirm-text", "Buy");

        setClerkSessionCookies(origin, new String(
            Base64.decode(encodedCookies, Base64.DEFAULT),
            StandardCharsets.UTF_8
        ));
        callWebView("window.location.assign(" + JSONObject.quote(origin + "/billing") + "); true");
        waitForWebView("document.body.innerText.includes('SafeNet Premium')");
        waitForWebView("Boolean(document.querySelector('[data-testid=\"android-billing-panel\"]'))");

        JSONObject preflight = requireValue(callWebView(
            "fetch('/api/billing/preflight',{credentials:'include',cache:'no-store'})" +
                ".then(async response => ({http:response.status,...(await response.json())}))"
        ));
        assertTrue(
            "RevenueCat billing configuration must pass before opening Google Play",
            preflight.optBoolean("ready", false)
        );
        JSONObject preflightChecks = preflight.optJSONObject("checks");
        assertTrue("Google Play app preflight check failed",
            preflightChecks != null && preflightChecks.optBoolean("googlePlayApp", false));
        assertTrue("Google Play product preflight check failed",
            preflightChecks != null && preflightChecks.optBoolean("googlePlayProduct", false));
        assertTrue("Premium entitlement preflight check failed",
            preflightChecks != null && preflightChecks.optBoolean("entitlement", false));
        assertTrue("Monthly offering preflight check failed",
            preflightChecks != null && preflightChecks.optBoolean("offering", false));

        JSONObject offering = requireValue(callWebView(
            "window.Capacitor.Plugins.Purchases.getOfferings().then(result => {" +
                "const current = result.current;" +
                "const monthly = current?.availablePackages?.find(candidate => " +
                    "candidate.identifier === '$rc_monthly' && " +
                    "candidate.product?.identifier === 'premium_monthly:monthly');" +
                "return {currentIdentifier:current?.identifier || null,monthlyAvailable:Boolean(monthly)};" +
            "})"
        ));
        assertEquals("default", offering.optString("currentIdentifier"));
        assertTrue(
            "The active $rc_monthly package is not available for the billing test account",
            offering.optBoolean("monthlyAvailable", false)
        );

        JSONObject identity = requireValue(callWebView(
            "Promise.all([" +
                "document.querySelector('[data-testid=\"billing-account\"]')?.dataset.clerkUserId || null," +
                "window.Capacitor.Plugins.Purchases.getAppUserID()" +
            "]).then(([clerkUserId, revenueCat]) => ({clerkUserId, revenueCatUserId:revenueCat.appUserID}))"
        ));
        assertTrue("Clerk must be available in the billing WebView",
            identity.optString("clerkUserId", "").length() > 0);
        assertTrue(
            "RevenueCat must use the same Clerk user",
            identity.optString("clerkUserId", "").equals(identity.optString("revenueCatUserId", ""))
        );

        if ("purchase".equals(action)) {
            waitForWebView("!document.querySelector('[data-testid=\"billing-purchase\"]')?.disabled");
            requireValue(callWebView(
                "document.querySelector('[data-testid=\"billing-purchase\"]').click(); true"
            ));
            waitForPlayPurchaseDialog();
            UiObject2 confirm = waitForPurchaseConfirmation(confirmText);
            if (confirm == null) {
                throw new AssertionError("Google Play purchase confirmation was not found");
            }
            confirm.click();
            waitForAppPackage();
        }

        requireValue(callWebView(
            "document.querySelector('[data-testid=\"billing-restore\"]').click(); true"
        ));
        JSONObject status = waitForActiveServerStatus();
        assertTrue("RevenueCat entitlement must be active after purchase/restore",
            status.getBoolean("hasEntitlement"));
        assertEquals("active", status.getString("status"));
        Log.i(
            PROOF_TAG,
            "REVENUECAT_BILLING_PROOF result=PASS configuration_preflight=PASS clerk_identity=PASS " +
                "purchase_or_restore=PASS server_status=PASS"
        );
        System.out.println(
            "REVENUECAT_BILLING_PROOF result=PASS configuration_preflight=PASS clerk_identity=PASS " +
                "purchase_or_restore=PASS server_status=PASS"
        );
    }

    @Test
    public void signedOutBillingRecoversFromClerkStartupStall() throws Exception {
        String origin = requiredArgument("clerk-origin");
        clearClerkSessionCookies();

        String billingUrl = origin + "/billing";
        callWebView("window.location.assign(" + JSONObject.quote(billingUrl) + "); true");
        waitForWebView("Boolean(document.querySelector('[data-testid=\"billing-signed-out\"]'))");
        assertEquals(
            "Signed-out Billing must stay on the Billing route",
            "/billing",
            requireValue(callWebView("({pathname:location.pathname})"))
                .optString("pathname")
        );

        String stalledUrl = billingUrl +
            "?billing_clerk_stall=1&redirect_url=%2Fbilling";
        callWebView("window.location.assign(" + JSONObject.quote(stalledUrl) + "); true");
        waitForWebView("Boolean(document.querySelector('[data-testid=\"billing-clerk-recovery\"]'))");
        assertTrue(
            "Clerk recovery message must explain that the account could not be loaded",
            callWebView(
                "document.querySelector('[data-testid=\"billing-clerk-recovery\"]').innerText" +
                    ".includes('account could not be loaded')"
            ).optBoolean("value", false)
        );

        requireValue(callWebView(
            "document.querySelector('[data-testid=\"billing-clerk-retry\"]').click(); true"
        ));
        waitForWebView("Boolean(document.querySelector('[data-testid=\"billing-signed-out\"]'))");
        JSONObject retryLocation = requireValue(callWebView(
            "({pathname:location.pathname," +
                "stall:new URLSearchParams(location.search).get('billing_clerk_stall')," +
                "redirect:new URLSearchParams(location.search).get('redirect_url')})"
        ));
        assertEquals("Retry must preserve the Billing route", "/billing",
            retryLocation.optString("pathname"));
        assertEquals("Retry must remove the controlled stall flag", JSONObject.NULL,
            retryLocation.opt("stall"));
        assertEquals("Retry must preserve the redirect context", "/billing",
            retryLocation.optString("redirect"));

        requireValue(callWebView(
            "document.querySelector('[data-testid=\"billing-sign-in\"]').click(); true"
        ));
        waitForWebView("location.pathname.endsWith('/sign-in')");
        JSONObject signInLocation = requireValue(callWebView(
            "({pathname:location.pathname," +
                "redirect:new URLSearchParams(location.search).get('redirect_url')})"
        ));
        assertTrue(
            "Billing sign-in prompt must navigate to the sign-in route",
            signInLocation.optString("pathname").endsWith("/sign-in")
        );
        assertEquals("Sign-in must preserve the Billing redirect context", "/billing",
            signInLocation.optString("redirect"));

        Log.i(
            PROOF_TAG,
            "REVENUECAT_BILLING_RECOVERY_PROOF result=PASS signed_out=PASS " +
                "stall_recovery=PASS redirect_context=PASS"
        );
        System.out.println(
            "REVENUECAT_BILLING_RECOVERY_PROOF result=PASS signed_out=PASS " +
                "stall_recovery=PASS redirect_context=PASS"
        );
    }

    private JSONObject waitForActiveServerStatus() throws Exception {
        long deadline = System.nanoTime() +
            TimeUnit.SECONDS.toNanos(ENTITLEMENT_TIMEOUT_SECONDS);
        JSONObject lastStatus = null;
        while (System.nanoTime() < deadline) {
            JSONObject result = callWebView(
                "fetch('/api/billing/status',{credentials:'include',cache:'no-store'})" +
                    ".then(async response => ({http:response.status,body:await response.json()}))"
            );
            if (result.optBoolean("ok", false)) {
                JSONObject value = result.optJSONObject("value");
                if (value != null) {
                    lastStatus = value.optJSONObject("body");
                    if (lastStatus != null &&
                        lastStatus.optBoolean("linked", false) &&
                        lastStatus.optBoolean("hasEntitlement", false) &&
                        "active".equals(lastStatus.optString("status"))) {
                        return lastStatus;
                    }
                }
            }
            Thread.sleep(3000);
        }
        throw new AssertionError("Authenticated billing status never became active: " + lastStatus);
    }

    private void waitForPlayPurchaseDialog() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WEBVIEW_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            if ("com.android.vending".equals(device.getCurrentPackageName())) {
                return;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Google Play purchase dialog did not open");
    }

    private UiObject2 waitForPurchaseConfirmation(String configuredText) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WEBVIEW_TIMEOUT_SECONDS);
        Pattern configured = Pattern.compile("(?i)^" + Pattern.quote(configuredText) + "$");
        Pattern fallback = Pattern.compile("(?i)^(buy|subscribe|purchase|confirm)$");
        while (System.nanoTime() < deadline) {
            UiObject2 confirm = device.findObject(By.text(configured));
            if (confirm == null) {
                confirm = device.findObject(By.text(fallback));
            }
            if (confirm != null && confirm.isEnabled()) {
                return confirm;
            }
            Thread.sleep(250);
        }
        return null;
    }

    private void waitForAppPackage() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WEBVIEW_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            if (PACKAGE_NAME.equals(device.getCurrentPackageName())) {
                return;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Android app did not regain focus after Google Play purchase");
    }

    private void setClerkSessionCookies(String origin, String cookieLines) throws Exception {
        String[] cookies = cookieLines.split("\\n");
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            for (String cookie : cookies) {
                if (!cookie.trim().isEmpty()) {
                    cookieManager.setCookie(origin, cookie.trim());
                }
            }
            cookieManager.flush();
        });
        Thread.sleep(500);
        callWebView("location.reload(); true");
        waitForWebView(
            "document.body.innerText.includes('Command Center') || " +
                "document.body.innerText.includes('SafeNet Premium')"
        );
    }

    private void clearClerkSessionCookies() throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.removeAllCookies(value -> completed.countDown());
            cookieManager.flush();
        });
        if (!completed.await(WEBVIEW_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new AssertionError("Timed out clearing Clerk session cookies");
        }
        Thread.sleep(500);
    }

    private String requiredArgument(String name) {
        String value = InstrumentationRegistry.getArguments().getString(name);
        if (value == null || value.trim().isEmpty()) {
            throw new AssertionError("Missing instrumentation argument: " + name);
        }
        return value;
    }

    private String argument(String name, String fallback) {
        String value = InstrumentationRegistry.getArguments().getString(name);
        return value == null || value.trim().isEmpty() ? fallback : value;
    }

    private void waitForWebView(String expression) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WEBVIEW_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            JSONObject result = callWebView(expression);
            if (result.optBoolean("ok", false) && result.optBoolean("value", false)) {
                return;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Timed out waiting for WebView condition: " + expression);
    }

    private JSONObject requireValue(JSONObject result) throws Exception {
        assertTrue("WebView bridge call failed: " + result.optString("message"),
            result.optBoolean("ok", false));
        return result.optJSONObject("value");
    }

    private JSONObject callWebView(String expression) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        String[] rawResult = new String[1];
        Object bridge = new Object() {
            @android.webkit.JavascriptInterface
            public void resolve(String value) {
                rawResult[0] = value;
                completed.countDown();
            }
        };
        String script =
            "(async function() { try { return JSON.stringify({ok:true,value:await (" + expression +
                ")}); } catch (error) { return JSON.stringify({ok:false,message:String(error)}); } })()" +
            ".then(value => window.SafeNetBillingTestBridge.resolve(value))";
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            webView.addJavascriptInterface(bridge, "SafeNetBillingTestBridge");
            webView.evaluateJavascript(script, null);
        });
        if (!completed.await(WEBVIEW_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw new AssertionError("Timed out evaluating WebView expression: " + expression);
        }
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            ((MainActivity) activity).getBridge().getWebView()
                .removeJavascriptInterface("SafeNetBillingTestBridge")
        );
        return new JSONObject(rawResult[0]);
    }
}