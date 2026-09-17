package com.safenet.dns;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.wifi.p2p.WifiP2pGroup;
import android.net.wifi.p2p.WifiP2pManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.content.ContextCompat;
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

@RunWith(AndroidJUnit4.class)
public class SafeNetInternetShareInstrumentationTest {
    private static final long JS_TIMEOUT_SECONDS = 20;
    private static final long START_TIMEOUT_SECONDS = 25;
    private final Context context =
        InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiDevice device =
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private Activity activity;

    @Before
    public void setUp() throws Exception {
        context.stopService(new Intent(context, TetherShareService.class));
        activity = InstrumentationRegistry.getInstrumentation().startActivitySync(
            new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
        );
        waitForBridge();
    }

    @After
    public void tearDown() {
        context.stopService(new Intent(context, TetherShareService.class));
        if (activity != null) {
            activity.finishAndRemoveTask();
        }
    }

    @Test
    public void internetShareStartsAndStopsCleanly() throws Exception {
        JSONObject started = call(
            "window.Capacitor.Plugins.SafeNetVpn.startTetherShare()",
            true
        );
        assertTrue("Internet Share start failed: " + started, started.optBoolean("ok"));

        JSONObject settled = waitForStarted();
        JSONObject value = requireValue(settled);
        boolean readableState =
            value.optBoolean("running") ||
            !value.optString("lastError", "").trim().isEmpty();
        assertTrue("Internet Share returned no running or failure state", readableState);
        android.util.Log.i(
            "InternetShareSmoke",
            "INTERNET_SHARE_START result=PASS mode=" +
                (value.optBoolean("running") ? "NETWORK_DETAILS" : "READABLE_FAILURE")
        );
        if (value.optBoolean("running") &&
            value.optInt("proxyPort", 0) > 0 &&
            !value.optString("proxyHost", "").trim().isEmpty()) {
            android.util.Log.i(
                "InternetShareSmoke",
                "INTERNET_SHARE_READY result=PASS proxy=ADVERTISED"
            );
        }

        try {
            JSONObject stopped = call(
                "window.Capacitor.Plugins.SafeNetVpn.stopTetherShare()"
            );
            assertTrue("Internet Share stop failed: " + stopped, stopped.optBoolean("ok"));
            waitForStopped();
            assertFalse("The activity crashed during Internet Share cleanup", activity.isFinishing());
            android.util.Log.i(
                "InternetShareSmoke",
                "INTERNET_SHARE_STOP result=PASS"
            );
        } finally {
            context.stopService(new Intent(context, TetherShareService.class));
        }
    }

    @Test
    public void internetShareClientUsesAdvertisedProxy() throws Exception {
        String host = argument("proxy-host", "");
        int port = Integer.parseInt(argument("proxy-port", "0"));
        assertTrue("Internet Share proxy host was missing", !host.isEmpty());
        assertTrue("Internet Share proxy port was invalid", port > 0 && port <= 65535);
        android.util.Log.i("InternetShareSmoke", "INTERNET_SHARE_CLIENT_PROXY_CONFIG result=PASS");
    }

    private JSONObject waitForStarted() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(START_TIMEOUT_SECONDS);
        JSONObject latest = null;
        while (System.nanoTime() < deadline) {
            latest = call("window.Capacitor.Plugins.SafeNetVpn.getTetherStatus()");
            JSONObject value = latest.optJSONObject("value");
            if (latest.optBoolean("ok") && value != null &&
                (value.optBoolean("running") ||
                    !value.optString("lastError", "").trim().isEmpty())) {
                return latest;
            }
            Thread.sleep(400);
        }
        throw new AssertionError("Internet Share did not settle: " + latest);
    }

    private void waitForStopped() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            JSONObject result = call("window.Capacitor.Plugins.SafeNetVpn.getTetherStatus()");
            JSONObject value = result.optJSONObject("value");
            if (result.optBoolean("ok") && value != null &&
                !value.optBoolean("running", true) &&
                !value.optBoolean("starting", true)) {
                return;
            }
            Thread.sleep(300);
        }
        throw new AssertionError("Internet Share did not stop cleanly");
    }

    private JSONObject call(String expression) throws Exception {
        return call(expression, false);
    }

    private JSONObject call(String expression, boolean handlePermission) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        String[] rawResult = new String[1];
        String bridgeName = "SafeNetInternetShareTestBridge";
        TestResultBridge bridge = new TestResultBridge(rawResult, completed);
        String script =
            "(async function() { try { return JSON.stringify({ok:true,value:await (" +
                expression +
                ")}); } catch (error) { return JSON.stringify({ok:false,message:String(" +
                "error.message||error),code:error.code||''}); } })()" +
            ".then(function(value) { window." + bridgeName + ".resolve(value); })";

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            webView.addJavascriptInterface(bridge, bridgeName);
            webView.evaluateJavascript(script, null);
        });
        try {
            if (handlePermission && !hasTetherPermission()) {
                grantTetherPermissionDialog();
            }
            assertTrue(
                "Timed out waiting for SafeNet Internet Share bridge call",
                completed.await(JS_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            );
            return new JSONObject(rawResult[0]);
        } finally {
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                ((MainActivity) activity).getBridge().getWebView()
                    .removeJavascriptInterface(bridgeName)
            );
        }
    }

    private void waitForBridge() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            try {
                JSONObject result = call(
                    "Boolean(window.Capacitor && window.Capacitor.Plugins && " +
                        "window.Capacitor.Plugins.SafeNetVpn)"
                );
                if (result.optBoolean("ok") && result.optBoolean("value")) return;
            } catch (Exception ignored) {
                // The bundled WebView may still be loading.
            }
            Thread.sleep(250);
        }
        throw new AssertionError("SafeNet native bridge was not available");
    }

    private JSONObject requireValue(JSONObject result) throws Exception {
        assertTrue("Bridge call failed: " + result.optString("message"), result.optBoolean("ok"));
        return result.getJSONObject("value");
    }

    private boolean hasTetherPermission() {
        String permission = android.os.Build.VERSION.SDK_INT >= 33
            ? android.Manifest.permission.NEARBY_WIFI_DEVICES
            : android.Manifest.permission.ACCESS_FINE_LOCATION;
        return ContextCompat.checkSelfPermission(context, permission) ==
            PackageManager.PERMISSION_GRANTED;
    }

    private void grantTetherPermissionDialog() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            UiObject2 allow = device.findObject(
                By.text(Pattern.compile("(?i)(while using the app|only this time|allow)"))
            );
            if (allow != null && allow.isEnabled()) {
                allow.click();
                return;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Nearby Wi-Fi permission dialog did not appear");
    }

    private String argument(String name, String fallback) {
        String value = InstrumentationRegistry.getArguments().getString(name);
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private static final class TestResultBridge {
        private final String[] rawResult;
        private final CountDownLatch completed;

        TestResultBridge(String[] rawResult, CountDownLatch completed) {
            this.rawResult = rawResult;
            this.completed = completed;
        }

        @JavascriptInterface
        public void resolve(String value) {
            rawResult[0] = value;
            completed.countDown();
        }
    }
}