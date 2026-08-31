package com.safenet.dns;

import android.app.Activity;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Assert;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Verifies the native EULA gate through the same Capacitor bridge used by the
 * packaged web application. This intentionally starts no VPN and therefore
 * does not open the Android permission dialog.
 */
@RunWith(AndroidJUnit4.class)
public class SafeNetVpnEulaTest {
    private static final String PACKAGE_NAME = "com.safenet.dns";
    private static final String VPN_PREFERENCES = "safenet_vpn";
    private static final String EULA_PREFERENCE = "accepted_eula_version";

    @Test
    public void startingWithoutEulaIsRejected() throws Exception {
        InstrumentationRegistry instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent intent = instrumentation.getTargetContext().getPackageManager()
            .getLaunchIntentForPackage(PACKAGE_NAME);
        Assert.assertNotNull("SafeNet DNS launch intent is missing", intent);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        Activity activity = instrumentation.startActivitySync(intent);
        activity.getSharedPreferences(VPN_PREFERENCES, Activity.MODE_PRIVATE)
            .edit()
            .remove(EULA_PREFERENCE)
            .commit();

        WebView webView = waitForWebView(activity);
        waitForCapacitorVpnPlugin(webView);
        String result = evaluate(
            webView,
            "window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SafeNetVpn"
                + " ? window.Capacitor.Plugins.SafeNetVpn.start({type:'plain', primaryAddress:'1.1.1.1'})"
                + ".then(function(value){return JSON.stringify({ok:true,value:value});})"
                + ".catch(function(error){return JSON.stringify({ok:false,message:error.message,code:error.code});})"
                + " : Promise.resolve(JSON.stringify({ok:false,message:'Capacitor VPN plugin is unavailable'}))"
        );

        Assert.assertTrue("Expected EULA_REQUIRED rejection, got: " + result,
            result.contains("EULA_REQUIRED") && result.contains("false"));
        activity.finish();
    }

    private static WebView waitForWebView(Activity activity) throws InterruptedException {
        AtomicReference<WebView> found = new AtomicReference<>();
        for (int attempt = 0; attempt < 60; attempt++) {
            CountDownLatch latch = new CountDownLatch(1);
            activity.runOnUiThread(() -> {
                found.set(findWebView(activity.getWindow().getDecorView()));
                latch.countDown();
            });
            Assert.assertTrue("Timed out waiting for the app WebView",
                latch.await(1, TimeUnit.SECONDS));
            if (found.get() != null) {
                return found.get();
            }
            SystemClock.sleep(250);
        }
        Assert.fail("SafeNet DNS WebView was not created");
        return null;
    }

    private static void waitForCapacitorVpnPlugin(WebView webView) throws Exception {
        for (int attempt = 0; attempt < 60; attempt++) {
            String available = evaluate(
                webView,
                "Boolean(window.Capacitor && window.Capacitor.Plugins"
                    + " && window.Capacitor.Plugins.SafeNetVpn)"
            );
            if ("true".equals(available)) {
                return;
            }
            SystemClock.sleep(250);
        }
        Assert.fail("Capacitor VPN plugin was not registered");
    }

    private static String evaluate(WebView webView, String expression) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        webView.post(() -> webView.evaluateJavascript(
            "(async function(){return await (" + expression + ");})()",
            value -> {
                result.set(value == null ? "" : value);
                latch.countDown();
            }
        ));
        Assert.assertTrue("Timed out waiting for Capacitor bridge response",
            latch.await(15, TimeUnit.SECONDS));
        return result.get();
    }

    private static WebView findWebView(View view) {
        if (view instanceof WebView) {
            return (WebView) view;
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index++) {
                WebView found = findWebView(group.getChildAt(index));
                if (found != null) {
                    return found;
                }
            }
        }
        return null;
    }
}