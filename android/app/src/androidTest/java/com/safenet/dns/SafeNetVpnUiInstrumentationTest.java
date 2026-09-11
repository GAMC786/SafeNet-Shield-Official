package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.VpnService;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.util.Log;
import android.util.Base64;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.rules.TestName;

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
    private static final String AI_SHIELD_DEVICE_SMOKE_TAG = "AiShieldDeviceSmoke";
    private static final String VPN_SWITCH_LABEL = "SafeNet VPN On/Off";
    private static final String CLERK_AUTH_TAG = "SafeNetClerkAuth";
    private static final long JS_TIMEOUT_SECONDS = 20;
    private static final long UI_TIMEOUT_MILLIS = 20_000;
    private static final int STARTUP_LOADER_MAX_SAMPLES = 100;

    private final Context context =
        InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiDevice device =
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    @Rule
    public final TestName testName = new TestName();
    private Activity activity;

    @Before
    public void setUp() throws Exception {
        assertEquals(PACKAGE_NAME, context.getPackageName());
        context.stopService(new Intent(context, SafeNetVpnService.class));
        clearTargetAppData();

        Intent launchIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        activity = InstrumentationRegistry.getInstrumentation().startActivitySync(launchIntent);
        if (!"startupLoaderProgressIsMonotonicAndOpaqueUntilHandoff".equals(testName.getMethodName())) {
            waitForCapacitorBridge();
        }
    }

    @After
    public void tearDown() throws Exception {
        if (activity != null && !activity.isFinishing()) {
            if (!"startupLoaderProgressIsMonotonicAndOpaqueUntilHandoff".equals(testName.getMethodName())) {
                try {
                    callWebView("window.Capacitor.Plugins.SafeNetVpn.stopAiShield()");
                } catch (Exception ignored) {
                    // Keep teardown useful when a permission activity or failed
                    // WebView call left the bridge unavailable.
                }
            }
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
    public void startupLoaderProgressIsMonotonicAndOpaqueUntilHandoff() throws Exception {
        JSONObject startup = callWebView(
            "(() => {" +
                "const samples = [];" +
                "let startupCompleteEvents = 0;" +
                "window.addEventListener('safenet:startup-complete', () => startupCompleteEvents++);" +
                "const startedAt = performance.now();" +
                "const readState = () => {" +
                    "const loader = document.getElementById('startup-loader');" +
                    "const fallback = document.getElementById('dashboard-fallback');" +
                    "const soundtrack = Array.from(document.querySelectorAll('button,[role=\"button\"]'))" +
                        ".filter((element) => /soundtrack|volume|music/i.test(" +
                            "(element.getAttribute('aria-label') || '') + ' ' + element.textContent));" +
                    "const style = loader ? getComputedStyle(loader) : null;" +
                    "const fallbackStyle = fallback ? getComputedStyle(fallback) : null;" +
                    "const controlStyles = soundtrack.map((element) => " +
                        "getComputedStyle(element.parentElement || element));" +
                    "const dots = loader ? Array.from(loader.querySelectorAll('.startup-loader-dot')) : [];" +
                    "return {" +
                        "elapsed: Math.round(performance.now() - startedAt)," +
                        "loaderPresent: Boolean(loader)," +
                        "loaderBusy: loader?.getAttribute('aria-busy')," +
                        "value: loader ? Number(loader.getAttribute('aria-valuenow')) : null," +
                        "opacity: style ? Number(style.opacity) : null," +
                        "zIndex: style ? Number(style.zIndex) : null," +
                        "background: style?.backgroundColor," +
                        "fallbackPresent: Boolean(fallback)," +
                        "fallbackVisible: Boolean(fallback && fallbackStyle && " +
                            "fallbackStyle.display !== 'none' && fallbackStyle.visibility !== 'hidden')," +
                        "fallbackZIndex: fallbackStyle ? Number(fallbackStyle.zIndex) || 0 : null," +
                        "soundtrackCount: soundtrack.length," +
                        "soundtrackZIndexes: controlStyles.map((controlStyle) => " +
                            "Number(controlStyle.zIndex) || 0)," +
                         "viewport: {" +
                             "width: window.innerWidth," +
                             "height: window.innerHeight" +
                         "}," +
                         "bounds: {" +
                             "title: elementBounds(loader?.querySelector('.startup-loader-title'))," +
                             "progress: elementBounds(loader?.querySelector('.startup-loader-progress'))," +
                             "percentage: elementBounds(loader?.querySelector('#startup-loader-percentage'))," +
                             "dots: elementBounds(loader?.querySelector('.startup-loader-dots'))" +
                         "}," +
                        "dotCount: dots.length," +
                        "dotAnimations: dots.map((dot) => {" +
                            "const dotStyle = getComputedStyle(dot);" +
                            "return {" +
                                "name: dotStyle.animationName," +
                                "duration: dotStyle.animationDuration," +
                                "iterationCount: dotStyle.animationIterationCount" +
                            "};" +
                        "})" +
                    "};" +
                "};" +
                 "const elementBounds = (element) => {" +
                     "if (!element) return null;" +
                     "const rect = element.getBoundingClientRect();" +
                     "return {" +
                         "left: rect.left," +
                         "top: rect.top," +
                         "right: rect.right," +
                         "bottom: rect.bottom," +
                         "width: rect.width," +
                         "height: rect.height" +
                     "};" +
                 "};" +
                "return new Promise((resolve) => {" +
                    "const finish = (state) => window.setTimeout(() => resolve({" +
                        "samples," +
                        "handoffComplete: startupCompleteEvents > 0," +
                        "rootReady: Boolean(document.querySelector('#root > *'))," +
                        "fallbackRemoved: !document.getElementById('dashboard-fallback')," +
                        "soundtrackPresent: state.soundtrackCount > 0" +
                    "}), 300);" +
                    "const sample = () => {" +
                        "const state = readState();" +
                        "samples.push(state);" +
                        "if (!state.loaderPresent || samples.length >= " +
                            STARTUP_LOADER_MAX_SAMPLES + ") {" +
                            "finish(state);" +
                        "} else {" +
                            "window.setTimeout(sample, 125);" +
                        "}" +
                    "};" +
                    "sample();" +
                "});" +
            "})()"
        );

        assertTrue("Startup loader sampling failed: " + startup.optString("message"),
            startup.optBoolean("ok", false));
        JSONObject handoff = startup.getJSONObject("value");
        JSONArray samples = handoff.getJSONArray("samples");
        assertTrue("Expected multiple startup loader samples", samples.length() >= 3);

        int previousValue = -1;
        boolean sawFallbackUnderLoader = false;
        boolean sawSoundtrackUnderLoader = false;
        boolean sawCompletingLoader = false;
        for (int index = 0; index < samples.length(); index++) {
            JSONObject sample = samples.getJSONObject(index);
            if (!sample.getBoolean("loaderPresent")) {
                continue;
            }

            int value = sample.getInt("value");
            assertTrue("Loader progress must be between 0 and 100: " + sample,
                value >= 0 && value <= 100);
            assertTrue(
                "Loader progress must never move backwards: " + samples,
                value >= previousValue
            );
            previousValue = value;

            assertTrue("Loader must remain opaque during startup: " + sample,
                sample.getDouble("opacity") >= 0.99);
            assertEquals("Loader must use its opaque startup surface",
                "rgb(9, 11, 20)", sample.getString("background"));
            assertTrue("Loader must remain above the fallback: " + sample,
                sample.getInt("zIndex") > sample.optInt("fallbackZIndex", 0));
             assertStartupElementBounds(sample);

            if (sample.getBoolean("fallbackPresent")) {
                assertTrue("Static fallback must remain underneath the loader: " + sample,
                    sample.getBoolean("fallbackVisible"));
                sawFallbackUnderLoader = true;
            }

            if (sample.getInt("soundtrackCount") > 0) {
                JSONArray soundtrackZIndexes = sample.getJSONArray("soundtrackZIndexes");
                for (int controlIndex = 0; controlIndex < soundtrackZIndexes.length(); controlIndex++) {
                    assertTrue("Soundtrack controls must remain underneath the loader: " + sample,
                        sample.getInt("zIndex") > soundtrackZIndexes.getInt(controlIndex));
                }
                sawSoundtrackUnderLoader = true;
            }

            assertEquals("Loader must expose all three red-dot animation elements",
                3, sample.getInt("dotCount"));
            JSONArray animations = sample.getJSONArray("dotAnimations");
            for (int dotIndex = 0; dotIndex < animations.length(); dotIndex++) {
                JSONObject animation = animations.getJSONObject(dotIndex);
                assertEquals("Red dots must use the startup pulse animation",
                    "startup-loader-dot-pulse", animation.getString("name"));
                assertTrue("Red-dot animation must have a duration",
                    !"0s".equals(animation.getString("duration")));
                assertEquals("Red-dot animation must loop during startup",
                    "infinite", animation.getString("iterationCount"));
            }

            if (value >= 100 || "false".equals(sample.optString("loaderBusy"))) {
                sawCompletingLoader = true;
            }
        }

        assertTrue("The loader never reached its completing state", sawCompletingLoader);
        assertTrue("The soundtrack control was not observed underneath the loader",
            sawSoundtrackUnderLoader);
        assertTrue("The static fallback must be observed underneath the loader",
            sawFallbackUnderLoader);
        assertTrue("The app must be ready before the loader is removed",
            handoff.getBoolean("rootReady"));
        assertTrue("The loader handoff event must complete before the test finishes",
            handoff.getBoolean("handoffComplete"));
        assertTrue("The static fallback must be removed during the completed handoff",
            handoff.getBoolean("fallbackRemoved"));
        assertTrue("The soundtrack control must survive the loader handoff",
            handoff.getBoolean("soundtrackPresent"));
    }

    private void assertStartupElementBounds(JSONObject sample) throws Exception {
        JSONObject viewport = sample.getJSONObject("viewport");
        double viewportWidth = viewport.getDouble("width");
        double viewportHeight = viewport.getDouble("height");
        JSONObject bounds = sample.getJSONObject("bounds");

        for (String elementName : new String[] {"title", "percentage", "progress", "dots"}) {
            JSONObject rect = bounds.optJSONObject(elementName);
            assertNotNull(
                "Startup " + elementName + " must be present while the loader is visible: " + sample,
                rect
            );
            assertTrue(
                "Startup " + elementName + " must have visible width: " + sample,
                rect.getDouble("width") > 0
            );
            assertTrue(
                "Startup " + elementName + " must have visible height: " + sample,
                rect.getDouble("height") > 0
            );
            assertTrue(
                "Startup " + elementName + " must not extend past the left edge: " + sample,
                rect.getDouble("left") >= 0
            );
            assertTrue(
                "Startup " + elementName + " must not extend past the top edge: " + sample,
                rect.getDouble("top") >= 0
            );
            assertTrue(
                "Startup " + elementName + " must not extend past the right edge: " + sample,
                rect.getDouble("right") <= viewportWidth
            );
            assertTrue(
                "Startup " + elementName + " must not extend past the bottom edge: " + sample,
                rect.getDouble("bottom") <= viewportHeight
            );
        }
    }

    @Test
    public void startupLoaderWaitsForDelayedSecureConfiguration() throws Exception {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView webView = ((MainActivity) activity).getBridge().getWebView();
            webView.loadUrl("https://localhost/?safenet-startup-test=delayed-config");
        });
        waitForWebView(
            "document.readyState === 'complete' && " +
                "Boolean(document.getElementById('startup-loader'))"
        );

        JSONObject startup = callWebView(
            "(() => {" +
                "const samples = [];" +
                "let startupCompleteEvents = 0;" +
                "window.addEventListener('safenet:startup-complete', () => startupCompleteEvents++);" +
                "const startedAt = performance.now();" +
                "const readState = () => {" +
                    "const loader = document.getElementById('startup-loader');" +
                    "const style = loader ? getComputedStyle(loader) : null;" +
                    "return {" +
                        "elapsed: Math.round(performance.now() - startedAt)," +
                        "loaderPresent: Boolean(loader)," +
                        "loaderBusy: loader?.getAttribute('aria-busy')," +
                        "value: loader ? Number(loader.getAttribute('aria-valuenow')) : null," +
                        "opacity: style ? Number(style.opacity) : null," +
                        "background: style?.backgroundColor," +
                        "startupError: document.body.textContent.includes('could not start')" +
                    "};" +
                "};" +
                "return new Promise((resolve) => {" +
                    "const finish = (state) => window.setTimeout(() => resolve({" +
                        "samples," +
                        "handoffComplete: startupCompleteEvents > 0," +
                        "rootReady: Boolean(document.querySelector('#root > *'))," +
                        "fallbackRemoved: !document.getElementById('dashboard-fallback')," +
                        "startupError: state.startupError" +
                    "}), 300);" +
                    "const sample = () => {" +
                        "const state = readState();" +
                        "samples.push(state);" +
                        "if (!state.loaderPresent || samples.length >= " +
                            STARTUP_LOADER_MAX_SAMPLES + ") {" +
                            "finish(state);" +
                        "} else {" +
                            "window.setTimeout(sample, 125);" +
                        "}" +
                    "};" +
                    "sample();" +
                "});" +
            "})()"
        );

        assertTrue("Delayed startup loader sampling failed: " + startup.optString("message"),
            startup.optBoolean("ok", false));
        JSONObject handoff = startup.getJSONObject("value");
        JSONArray samples = handoff.getJSONArray("samples");
        assertTrue("Expected delayed startup to produce multiple samples", samples.length() >= 3);

        int previousValue = -1;
        boolean sawOpaqueLoaderAtFullProgress = false;
        for (int index = 0; index < samples.length(); index++) {
            JSONObject sample = samples.getJSONObject(index);
            if (!sample.getBoolean("loaderPresent")) {
                continue;
            }

            int value = sample.getInt("value");
            assertTrue("Delayed loader progress must be between 0 and 100: " + sample,
                value >= 0 && value <= 100);
            assertTrue("Delayed loader progress must never move backwards: " + samples,
                value >= previousValue);
            previousValue = value;
            assertTrue("Delayed loader must remain opaque during startup: " + sample,
                sample.getDouble("opacity") >= 0.99);
            assertEquals("Delayed loader must use its opaque startup surface",
                "rgb(9, 11, 20)", sample.getString("background"));

            if (value == 100 && "true".equals(sample.optString("loaderBusy"))) {
                sawOpaqueLoaderAtFullProgress = true;
            }
        }

        assertTrue(
            "The loader was not kept opaque while waiting for delayed secure configuration",
            sawOpaqueLoaderAtFullProgress
        );
        assertTrue("The delayed startup must finish with the app mounted",
            handoff.getBoolean("rootReady"));
        assertFalse("Delayed secure configuration must not render the startup error",
            handoff.getBoolean("startupError"));
        assertTrue("The delayed startup handoff event must complete",
            handoff.getBoolean("handoffComplete"));
        assertTrue("The static fallback must be removed after delayed handoff",
            handoff.getBoolean("fallbackRemoved"));
    }

    @Test
    public void packagedSpeedTestAndSoundtrackSurviveAndroidPolicies() throws Exception {
        waitForWebView(
            "document.getElementById('startup-loader') === null && " +
                "document.readyState === 'complete'"
        );

        JSONObject navigation = callWebView(
            "(() => {" +
                "const link = Array.from(document.querySelectorAll('a')).find((item) => " +
                    "item.textContent.includes('Speed Test'));" +
                "if (!link) return false;" +
                "link.click();" +
                "return true;" +
            "})()"
        );
        assertTrue("The packaged app must expose the Speed Test navigation item",
            navigation.optBoolean("value", false));

        waitForWebView(
            "Boolean(document.querySelector('iframe[data-testid=\"openspeedtest-frame\"]')) && " +
                "document.body.innerText.includes('Live connection test')"
        );
        waitForWebView(
            "(() => {" +
                "const frame = document.querySelector('iframe[data-testid=\"openspeedtest-frame\"]');" +
                "return Boolean(frame) && frame.offsetHeight >= 560 && " +
                    "document.body.innerText.includes('Ready');" +
            "})()"
        );

        JSONObject testPanel = callWebView(
            "(() => {" +
                "const frame = document.querySelector('iframe[data-testid=\"openspeedtest-frame\"]');" +
                "const fallback = Array.from(document.querySelectorAll('a')).find((item) => " +
                    "item.textContent.includes('Open full test'));" +
                "return {" +
                    "framePresent: Boolean(frame)," +
                    "frameLoaded: document.body.innerText.includes('Ready')," +
                    "frameVisible: Boolean(frame && frame.offsetHeight >= 560 && " +
                        "frame.offsetWidth > 0)," +
                    "frameSrc: frame?.getAttribute('src') || ''," +
                    "fallbackPresent: Boolean(fallback)," +
                    "fallbackHref: fallback?.getAttribute('href') || ''," +
                    "fallbackTarget: fallback?.getAttribute('target') || ''" +
                "};" +
            "})()"
        );
        assertTrue("The OpenSpeedTest iframe must be present", testPanel.getBoolean("framePresent"));
        assertTrue("The OpenSpeedTest iframe must report a completed load",
            testPanel.getBoolean("frameLoaded"));
        assertTrue("The OpenSpeedTest iframe must have a visible Android viewport",
            testPanel.getBoolean("frameVisible"));
        assertEquals(
            "https://openspeedtest.com/speedtest?darkmode=1",
            testPanel.getString("frameSrc")
        );
        assertTrue("The Speed Test screen must expose its full-page fallback",
            testPanel.getBoolean("fallbackPresent"));
        assertEquals(
            "https://openspeedtest.com/speedtest?darkmode=1",
            testPanel.getString("fallbackHref")
        );
        assertEquals("_blank", testPanel.getString("fallbackTarget"));

        JSONObject preparedAudio = callWebView(
            "(() => {" +
                "const audio = document.getElementById('safenet-soundtrack-audio');" +
                "if (!(audio instanceof HTMLAudioElement)) return false;" +
                "audio.muted = false;" +
                "audio.pause();" +
                "audio.currentTime = 0;" +
                "return true;" +
            "})()"
        );
        assertTrue("The packaged app must keep its startup soundtrack element",
            preparedAudio.optBoolean("value", false));

        // This tap exercises the same Android user-interaction path that
        // releases WebView media playback when autoplay is restricted.
        device.click(device.getDisplayWidth() / 2, Math.max(80, device.getDisplayHeight() / 5));
        waitForWebView(
            "(() => {" +
                "const audio = document.getElementById('safenet-soundtrack-audio');" +
                "return audio instanceof HTMLAudioElement && !audio.paused && !audio.muted && " +
                    "audio.currentTime > 0;" +
            "})()"
        );

        JSONObject soundtrack = callWebView(
            "(() => {" +
                "const audio = document.getElementById('safenet-soundtrack-audio');" +
                "return {" +
                    "present: audio instanceof HTMLAudioElement," +
                    "playing: Boolean(audio && !audio.paused && !audio.muted)," +
                    "loop: Boolean(audio?.loop)," +
                    "startupLoaderPresent: Boolean(document.getElementById('startup-loader'))," +
                    "currentTime: audio?.currentTime || 0" +
                "};" +
            "})()"
        );
        assertTrue("The startup soundtrack must be playing after the Android tap",
            soundtrack.getBoolean("playing"));
        assertTrue("The startup soundtrack must remain looped",
            soundtrack.getBoolean("loop"));
        assertFalse("The startup soundtrack must not leave the startup shell visible",
            soundtrack.getBoolean("startupLoaderPresent"));
        assertTrue("The startup soundtrack must advance past its initial position",
            soundtrack.getDouble("currentTime") > 0);
        Log.i(
            "SafeNetMediaSmoke",
            "MEDIA_SMOKE result=PASS speedtest_frame=PASS full_page_fallback=PASS " +
                "soundtrack=PLAYING after_android_tap=PASS"
        );
    }

    @Test
    public void clerkSignInStartsFreshAndRetainsClerkSession() throws Exception {
        if (hasInstrumentationArgument("preserve-auth-session")) {
            waitForWebView("document.body.innerText.includes('Command Center')");
            JSONObject retainedState = callWebView(
                "(() => {" +
                    "const body = document.body.innerText;" +
                    "return {" +
                        "dashboard: body.includes('Command Center')," +
                        "legacyAccessCode: /access code|pin protection|pin recovery/i.test(body)" +
                    "};" +
                "})()"
            );
            assertTrue("The preserved Clerk session must reopen the dashboard",
                retainedState.getBoolean("dashboard"));
            assertFalse("The preserved Clerk session must not expose legacy access-code UI",
                retainedState.getBoolean("legacyAccessCode"));
            return;
        }

        waitForWebView(
            "document.readyState === 'complete' && " +
                "/sign in to access safenet dns/i.test(document.body.innerText)"
        );
        JSONObject initialState = callWebView(
            "(() => {" +
                "const body = document.body.innerText;" +
                "return {" +
                    "signIn: /sign in to access safenet dns/i.test(body)," +
                    "googleSignIn: /sign in with google/i.test(body)," +
                    "legacyAccessCode: /access code|pin protection|pin recovery/i.test(body)," +
                    "path: window.location.pathname" +
                "};" +
            "})()"
        );
        assertTrue("A fresh Android WebView must start on Clerk sign-in",
            initialState.getBoolean("signIn"));
        assertFalse("Fresh Clerk sign-in must not expose legacy access-code UI",
            initialState.getBoolean("legacyAccessCode"));

        String clerkOrigin = instrumentationArguments().getString("clerk-origin");
        String clerkCookiePayload = instrumentationArguments().getString("clerk-cookie-base64");
        assertNotNull("Android Clerk smoke requires a public Clerk session origin", clerkOrigin);
        assertNotNull("Android Clerk smoke requires a Clerk storage-state session",
            clerkCookiePayload);
        assertTrue("Android Clerk smoke received an empty Clerk session",
            clerkCookiePayload.length() > 0);
        String clerkCookie = new String(
            Base64.decode(clerkCookiePayload, Base64.DEFAULT),
            java.nio.charset.StandardCharsets.UTF_8
        );

        setClerkSessionCookies(clerkOrigin, clerkCookie);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            ((MainActivity) activity).getBridge().getWebView().reload()
        );
        waitForWebView("document.body.innerText.includes('Command Center')");

        JSONObject authenticatedState = callWebView(
            "(async () => {" +
                "const body = document.body.innerText;" +
                "const response = await fetch(" +
                    JSONObject.quote(clerkOrigin + "/api/auth/status") +
                    ", {cache: 'no-store', credentials: 'include'});" +
                "const auth = await response.json();" +
                "return {" +
                    "dashboard: body.includes('Command Center')," +
                    "authenticated: response.ok && auth.authenticated === true," +
                    "legacyAccessCode: /access code|pin protection|pin recovery/i.test(body)," +
                    "cookiePresent: Boolean(document.cookie)" +
                "};" +
            "})()"
        );
        assertTrue("The Clerk session must open the protected dashboard",
            authenticatedState.getBoolean("dashboard"));
        assertTrue("The backend must recognize the injected Clerk session",
            authenticatedState.getBoolean("authenticated"));
        assertFalse("The protected dashboard must not expose legacy access-code UI",
            authenticatedState.getBoolean("legacyAccessCode"));

        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            ((MainActivity) activity).getBridge().getWebView().reload()
        );
        waitForWebView("document.body.innerText.includes('Command Center')");
        JSONObject retainedState = callWebView(
            "(() => {" +
                "const body = document.body.innerText;" +
                "return {" +
                    "dashboard: body.includes('Command Center')," +
                    "legacyAccessCode: /access code|pin protection|pin recovery/i.test(body)" +
                "};" +
            "})()"
        );
        assertTrue("The packaged WebView must retain the Clerk session after reload",
            retainedState.getBoolean("dashboard"));
        assertFalse("The retained Clerk session must not fall back to local access-code UI",
            retainedState.getBoolean("legacyAccessCode"));
        Log.i(
            CLERK_AUTH_TAG,
            "CLERK_AUTH_SMOKE result=PASS initial=SIGN_IN session=CLERK " +
                "dashboard=PASS retained_after_reload=PASS legacy_access_code=ABSENT"
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

    @Test
    public void aiShieldCameraConsentInfersAndPauseReleasesCapture() throws Exception {
        assertTrue(
            "The attached Android target must expose a camera for AI Shield device evidence",
            context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        );

        ConsentAction cameraConsent = context.checkSelfPermission(
            android.Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
            ? null
            : this::grantCameraPermissionDialog;
        JSONObject started = callWebViewWithConsent(
            "window.Capacitor.Plugins.SafeNetVpn.startAiShieldCamera()",
            cameraConsent
        );
        JSONObject startedStatus = requireWebViewValue(started);
        assertEquals("camera", startedStatus.getString("source"));
        assertTrue("Camera consent must start AI Shield monitoring",
            startedStatus.getBoolean("monitoring"));

        JSONObject inference = waitForAiShieldInference("camera");
        assertAiShieldInference(inference, "camera");

        rotateDevice();
        JSONObject rotated = waitForAiShieldStatus(
            "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()",
            status -> "camera".equals(status.optString("source"))
                && status.optBoolean("monitoring", false)
        );
        assertTrue("Camera monitoring must remain active through rotation",
            rotated.getBoolean("monitoring"));
        assertAiShieldInference(waitForAiShieldInference("camera"), "camera");

        recreateActivity();
        JSONObject recreated = waitForAiShieldStatus(
            "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()",
            status -> AiShieldClassifier.STATE_CAPTURE_UNAVAILABLE.equals(
                    status.optString("state")
                ) && !status.optBoolean("monitoring", true)
        );
        assertEquals("none", recreated.getString("source"));
        assertFalse("Activity recreation must not retain a stale safe verdict",
            AiShieldClassifier.STATE_SAFE.equals(recreated.getString("state")));
        assertFalse("An idle recreated manager must not retain frame confidence",
            recreated.has("confidence") && !recreated.isNull("confidence"));

        JSONObject restarted = requireWebViewValue(callWebViewWithConsent(
            "window.Capacitor.Plugins.SafeNetVpn.startAiShieldCamera()",
            null
        ));
        assertEquals("camera", restarted.getString("source"));
        assertTrue("Camera capture must be restartable after activity recreation",
            restarted.getBoolean("monitoring"));
        assertAiShieldInference(waitForAiShieldInference("camera"), "camera");

        device.pressHome();
        Thread.sleep(1000);
        relaunchActivity();

        JSONObject paused = waitForAiShieldStatus(
            "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()",
            status -> !status.optBoolean("monitoring", true)
        );
        assertFalse("Pausing the Android app must stop camera monitoring",
            paused.getBoolean("monitoring"));
        assertNotEquals("A paused capture must not report a safe verdict",
            AiShieldClassifier.STATE_SAFE, paused.getString("state"));

        JSONObject stopped = requireWebViewValue(callWebView(
            "window.Capacitor.Plugins.SafeNetVpn.stopAiShield()"
        ));
        assertFalse("Stopping AI Shield must release camera monitoring",
            stopped.getBoolean("monitoring"));
        assertNotEquals("A stopped capture must not retain a safe verdict",
            AiShieldClassifier.STATE_SAFE, stopped.getString("state"));
    }

    @Test
    public void aiShieldScreenConsentInfersAndProjectionRevocationFailsClosed() throws Exception {
        JSONObject started = callWebViewWithConsent(
            "window.Capacitor.Plugins.SafeNetVpn.startAiShieldScreen()",
            this::grantMediaProjectionDialog
        );
        JSONObject startedStatus = requireWebViewValue(started);
        assertEquals("screen", startedStatus.getString("source"));
        assertTrue("MediaProjection consent must start AI Shield monitoring",
            startedStatus.getBoolean("monitoring"));

        JSONObject inference = waitForAiShieldInference("screen");
        assertAiShieldInference(inference, "screen");

        rotateDevice();
        JSONObject rotated = waitForAiShieldStatus(
            "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()",
            status -> "screen".equals(status.optString("source"))
                && status.optBoolean("monitoring", false)
        );
        assertTrue("Screen monitoring must remain active through rotation",
            rotated.getBoolean("monitoring"));
        assertAiShieldInference(waitForAiShieldInference("screen"), "screen");

        String revokeOutput = executeShellCommand("cmd media_projection stop " + PACKAGE_NAME);
        String normalizedRevokeOutput = revokeOutput.toLowerCase();
        assertFalse(
            "The Android target must support revoking the active MediaProjection: " + revokeOutput,
            normalizedRevokeOutput.contains("unknown") ||
                normalizedRevokeOutput.contains("error")
        );

        JSONObject revoked = waitForAiShieldStatus(
            "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()",
            status -> AiShieldClassifier.STATE_CAPTURE_UNAVAILABLE.equals(status.optString("state"))
                && !status.optBoolean("monitoring", true)
        );
        assertEquals("screen", revoked.getString("source"));
        assertEquals(AiShieldClassifier.STATE_CAPTURE_UNAVAILABLE, revoked.getString("state"));
        assertFalse("A revoked projection must never report a safe verdict",
            AiShieldClassifier.STATE_SAFE.equals(revoked.getString("state")));
        assertFalse("A revoked projection must not retain frame confidence",
            revoked.has("confidence") && !revoked.isNull("confidence"));

        recreateActivity();
        JSONObject recreated = waitForAiShieldStatus(
            "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()",
            status -> AiShieldClassifier.STATE_CAPTURE_UNAVAILABLE.equals(
                    status.optString("state")
                ) && !status.optBoolean("monitoring", true)
        );
        assertFalse("Activity recreation after projection revocation must not restore a safe verdict",
            AiShieldClassifier.STATE_SAFE.equals(recreated.getString("state")));
        assertFalse("A recreated revoked projection must not expose frame confidence",
            recreated.has("confidence") && !recreated.isNull("confidence"));
    }

    @Test
    public void aiShieldScreenConsentCancellationSurvivesActivityRecreation() throws Exception {
        startScreenConsentWithoutWaiting();
        waitForMediaProjectionDialog();

        recreateActivity();
        cancelMediaProjectionDialog();

        JSONObject canceled = waitForAiShieldStatus(
            "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()",
            status -> "screen".equals(status.optString("source"))
                && AiShieldClassifier.STATE_CAPTURE_UNAVAILABLE.equals(
                    status.optString("state")
                )
                && !status.optBoolean("monitoring", true)
        );
        assertEquals(
            "Screen-capture consent was canceled; no screen pixels were analyzed.",
            canceled.getString("message")
        );
        assertFalse("Canceled consent must not leave screen monitoring active",
            canceled.getBoolean("monitoring"));

        JSONObject restarted = requireWebViewValue(callWebViewWithConsent(
            "window.Capacitor.Plugins.SafeNetVpn.startAiShieldScreen()",
            this::grantMediaProjectionDialog
        ));
        assertTrue("A canceled consent callback must not block a later request",
            restarted.getBoolean("monitoring"));
        assertAiShieldInference(waitForAiShieldInference("screen"), "screen");
    }

    @Test
    public void aiShieldCanceledScreenReplacementFailsClosedAndCanRestart() throws Exception {
        assertTrue(
            "The attached Android target must expose a camera for AI Shield device evidence",
            context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        );

        ConsentAction cameraConsent = context.checkSelfPermission(
            android.Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
            ? null
            : this::grantCameraPermissionDialog;
        JSONObject cameraStarted = requireWebViewValue(callWebViewWithConsent(
            "window.Capacitor.Plugins.SafeNetVpn.startAiShieldCamera()",
            cameraConsent
        ));
        assertEquals("camera", cameraStarted.getString("source"));
        assertTrue("The initial camera source must be active", cameraStarted.getBoolean("monitoring"));
        assertAiShieldInference(waitForAiShieldInference("camera"), "camera");

        startScreenConsentWithoutWaiting();
        waitForMediaProjectionDialog();
        cancelMediaProjectionDialog();

        JSONObject canceled = waitForAiShieldStatus(
            "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()",
            status -> "screen".equals(status.optString("source"))
                && AiShieldClassifier.STATE_CAPTURE_UNAVAILABLE.equals(
                    status.optString("state")
                )
                && !status.optBoolean("monitoring", true)
        );
        assertEquals(
            "Screen-capture consent was canceled; no screen pixels were analyzed.",
            canceled.getString("message")
        );
        assertFalse("Canceled replacement must not leave monitoring active",
            canceled.getBoolean("monitoring"));
        assertFalse("Canceled replacement must not retain the camera verdict",
            canceled.has("confidence") && !canceled.isNull("confidence"));
        assertNotEquals("Canceled replacement must not report a safe verdict",
            AiShieldClassifier.STATE_SAFE, canceled.getString("state"));

        JSONObject restarted = requireWebViewValue(callWebViewWithConsent(
            "window.Capacitor.Plugins.SafeNetVpn.startAiShieldScreen()",
            this::grantMediaProjectionDialog
        ));
        assertEquals("screen", restarted.getString("source"));
        assertTrue("A later screen selection must restart monitoring",
            restarted.getBoolean("monitoring"));
        assertAiShieldInference(waitForAiShieldInference("screen"), "screen");
    }

    @Test
    public void aiShieldScreenConsentApprovalSurvivesActivityRecreation() throws Exception {
        startScreenConsentWithoutWaiting();
        waitForMediaProjectionDialog();

        recreateActivity();
        grantMediaProjectionDialog();

        JSONObject started = waitForAiShieldStatus(
            "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()",
            status -> "screen".equals(status.optString("source"))
                && status.optBoolean("monitoring", false)
        );
        assertTrue("Approved consent must resolve into active screen monitoring",
            started.getBoolean("monitoring"));
        assertAiShieldInference(waitForAiShieldInference("screen"), "screen");

        JSONObject stable = waitForAiShieldStatus(
            "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()",
            status -> "screen".equals(status.optString("source"))
                && status.optBoolean("monitoring", false)
        );
        assertTrue("A recreated approval must not leave stale monitoring transitions",
            stable.getBoolean("monitoring"));
    }

    @Test
    public void aiShieldRapidCameraToScreenSwitchKeepsNewProjectionActive() throws Exception {
        logAiShieldDeviceEvent("test_begin", "camera_to_screen");
        assertTrue(
            "The attached Android target must expose a camera for AI Shield device evidence",
            context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        );

        ConsentAction cameraConsent = context.checkSelfPermission(
            android.Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
            ? null
            : this::grantCameraPermissionDialog;
        JSONObject cameraStarted = requireWebViewValue(callWebViewWithConsent(
            "window.Capacitor.Plugins.SafeNetVpn.startAiShieldCamera()",
            cameraConsent
        ));
        assertEquals("camera", cameraStarted.getString("source"));
        assertTrue(cameraStarted.getBoolean("monitoring"));

        JSONObject screenStarted = requireWebViewValue(callWebViewWithConsent(
            "window.Capacitor.Plugins.SafeNetVpn.startAiShieldScreen()",
            this::grantMediaProjectionDialog
        ));
        assertEquals("screen", screenStarted.getString("source"));
        assertTrue("Starting screen monitoring must replace the camera capture",
            screenStarted.getBoolean("monitoring"));

        assertAiShieldSourceRemainsActive("screen");
        assertAiShieldInference(waitForAiShieldInference("screen"), "screen");
        logAiShieldDeviceEvent("test_pass", "camera_to_screen");
    }

    @Test
    public void aiShieldRapidScreenToCameraSwitchKeepsNewCameraActive() throws Exception {
        logAiShieldDeviceEvent("test_begin", "screen_to_camera");
        assertTrue(
            "The attached Android target must expose a camera for AI Shield device evidence",
            context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        );

        JSONObject screenStarted = requireWebViewValue(callWebViewWithConsent(
            "window.Capacitor.Plugins.SafeNetVpn.startAiShieldScreen()",
            this::grantMediaProjectionDialog
        ));
        assertEquals("screen", screenStarted.getString("source"));
        assertTrue(screenStarted.getBoolean("monitoring"));

        ConsentAction cameraConsent = context.checkSelfPermission(
            android.Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
            ? null
            : this::grantCameraPermissionDialog;
        JSONObject cameraStarted = requireWebViewValue(callWebViewWithConsent(
            "window.Capacitor.Plugins.SafeNetVpn.startAiShieldCamera()",
            cameraConsent
        ));
        assertEquals("camera", cameraStarted.getString("source"));
        assertTrue("Starting camera monitoring must replace the projection",
            cameraStarted.getBoolean("monitoring"));

        assertAiShieldSourceRemainsActive("camera");
        assertAiShieldInference(waitForAiShieldInference("camera"), "camera");
        logAiShieldDeviceEvent("test_pass", "screen_to_camera");
    }

    @Test
    public void aiShieldRepeatedSourceSwitchesKeepLatestCaptureActive() throws Exception {
        assertTrue(
            "The attached Android target must expose a camera for AI Shield device evidence",
            context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        );

        ConsentAction cameraConsent = context.checkSelfPermission(
            android.Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
            ? null
            : this::grantCameraPermissionDialog;

        startAndVerifyAiShieldSource("camera", cameraConsent);
        startAndVerifyAiShieldSource("screen", this::grantMediaProjectionDialog);
        startAndVerifyAiShieldSource("camera", cameraConsent);
        startAndVerifyAiShieldSource("screen", this::grantMediaProjectionDialog);
        startAndVerifyAiShieldSource("camera", cameraConsent);
        startAndVerifyAiShieldSource("screen", this::grantMediaProjectionDialog);

        JSONObject stopped = requireWebViewValue(callWebView(
            "window.Capacitor.Plugins.SafeNetVpn.stopAiShield()"
        ));
        assertFalse("Stopping repeated AI Shield captures must release the active source",
            stopped.getBoolean("monitoring"));
        assertEquals("none", stopped.getString("source"));
        assertEquals(
            "A stopped AI Shield capture must return to the idle capture state",
            AiShieldClassifier.STATE_CAPTURE_UNAVAILABLE,
            stopped.getString("state")
        );
    }

    @Test
    public void aiShieldSettingsShowsUnavailableForMissingOrInvalidModelMetadata() throws Exception {
        String missingMetadataStatus = modelUnavailableStatusPayload((String) null);
        String invalidMetadataStatus = modelUnavailableStatusPayload("{\"modelVersion\":\"wrong\"}");

        JSONObject installed = callWebView(
            "(() => {" +
                "const plugin = window.Capacitor.Plugins.SafeNetVpn;" +
                "const missing = JSON.parse(\"" + jsQuote(missingMetadataStatus) + "\");" +
                "const invalid = JSON.parse(\"" + jsQuote(invalidMetadataStatus) + "\");" +
                "plugin.getAiShieldStatus = () => Promise.resolve(missing);" +
                "plugin.startAiShieldCamera = () => Promise.resolve(missing);" +
                "plugin.startAiShieldScreen = () => Promise.resolve(missing);" +
                "plugin.stopAiShield = () => Promise.resolve(missing);" +
                "plugin.addListener = (_name, listener) => {" +
                    "window.__safeNetAiShieldTestListener = listener;" +
                    "return Promise.resolve({remove: () => Promise.resolve()});" +
                "};" +
                "history.pushState({}, '', '/settings');" +
                "window.dispatchEvent(new PopStateEvent('popstate'));" +
                "window.__safeNetAiShieldInvalidStatus = invalid;" +
                "return true;" +
            "})()"
        );
        assertTrue("Could not navigate to Settings in the WebView", installed.getBoolean("ok"));

        waitForWebView(
            "(() => {" +
                "const result = document.querySelector('[data-testid=\"ai-shield-result\"]');" +
                "return Boolean(window.__safeNetAiShieldTestListener && result && " +
                    "result.getAttribute('data-state') === 'model_unavailable' && " +
                    "result.textContent.includes('Engine unavailable'));" +
            "})()"
        );

        JSONObject initialState = aiShieldSettingsDomState();
        assertEquals(AiShieldClassifier.STATE_MODEL_UNAVAILABLE, initialState.getString("state"));
        assertTrue("Settings must visibly report an unavailable AI Shield engine",
            initialState.getBoolean("engineUnavailable"));
        assertFalse("Missing model metadata must not render a safe verdict",
            initialState.getBoolean("safeVerdict"));
        assertFalse("Missing model metadata must not expose confidence",
            initialState.getBoolean("hasConfidence"));

        JSONObject clicked = callWebView(
            "(() => {" +
                "const toggle = document.querySelector('[data-testid=\"switch-ai-camera\"]');" +
                "if (!toggle) { return {ok: false}; }" +
                "toggle.click();" +
                "return {ok: true};" +
            "})()"
        );
        assertTrue("The unavailable AI Shield card must expose its camera control",
            clicked.getBoolean("ok"));
        waitForWebView(
            "document.querySelector('[data-testid=\"ai-shield-result\"]')?.getAttribute('data-state') === " +
                "'model_unavailable'"
        );
        JSONObject afterStartAttempt = aiShieldSettingsDomState();
        assertFalse("Starting an unavailable model must not render a safe verdict",
            afterStartAttempt.getBoolean("safeVerdict"));

        JSONObject attemptedStart = requireWebViewValue(callWebView(
            "window.Capacitor.Plugins.SafeNetVpn.startAiShieldCamera()"
        ));
        assertEquals(AiShieldClassifier.STATE_MODEL_UNAVAILABLE,
            attemptedStart.getString("state"));
        assertFalse("An unavailable model must not produce a safe start result",
            AiShieldClassifier.STATE_SAFE.equals(attemptedStart.getString("state")));

        JSONObject updated = callWebView(
            "(() => {" +
                "const invalid = window.__safeNetAiShieldInvalidStatus;" +
                "window.__safeNetAiShieldTestListener(invalid);" +
                "return true;" +
            "})()"
        );
        assertTrue("The invalid metadata status fixture must be emitted",
            updated.getBoolean("ok"));

        waitForWebView(
            "(() => {" +
                "const result = document.querySelector('[data-testid=\"ai-shield-result\"]');" +
                "return Boolean(result && result.getAttribute('data-state') === 'model_unavailable' && " +
                    "result.textContent.includes('failed validation'));" +
            "})()"
        );
        JSONObject invalidDomState = aiShieldSettingsDomState();
        assertEquals("model_unavailable", invalidDomState.getString("state"));
        assertTrue("Invalid model metadata must keep the Engine unavailable label visible",
            invalidDomState.getBoolean("engineUnavailable"));
        assertFalse("Invalid model metadata must not render a safe verdict",
            invalidDomState.getBoolean("safeVerdict"));
        assertTrue("Invalid model metadata must retain its unavailable diagnostic",
            invalidDomState.getBoolean("validationFailure"));
    }

    private String modelUnavailableStatusPayload(String metadata) throws Exception {
        AiShieldClassifier classifier = new AiShieldClassifier(metadata);
        AiShieldClassifier.Analysis result = classifier.analyze(null, "none");
        assertEquals(AiShieldClassifier.STATE_MODEL_UNAVAILABLE, result.state);
        assertFalse(AiShieldClassifier.STATE_SAFE.equals(result.state));
        return result.toJson().toString();
    }

    private JSONObject aiShieldSettingsDomState() throws Exception {
        return requireWebViewValue(callWebView(
            "(() => {" +
                "const result = document.querySelector('[data-testid=\"ai-shield-result\"]');" +
                "const text = result ? result.textContent || '' : '';" +
                "return {" +
                    "state: result?.getAttribute('data-state')," +
                    "engineUnavailable: text.includes('Engine unavailable')," +
                    "safeVerdict: text.includes('Safe signal')," +
                    "hasConfidence: !text.includes('Confidence —')," +
                    "validationFailure: text.includes('failed validation')" +
                "};" +
            "})()"
        ));
    }

    private void clearTargetAppData() throws Exception {
        if (hasInstrumentationArgument("preserve-auth-session")) {
            return;
        }
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

    private void grantCameraPermissionDialog() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            UiObject2 allow = device.findObject(
                By.text(Pattern.compile("(?i)(while using the app|only this time|allow)"))
            );
            if (allow != null && allow.isEnabled()) {
                logAiShieldDeviceEvent("camera_permission_dialog_shown", "camera");
                allow.click();
                logAiShieldDeviceEvent("camera_permission_granted", "camera");
                return;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Android camera permission dialog did not appear");
    }

    private void grantMediaProjectionDialog() throws Exception {
        UiObject2 start = waitForMediaProjectionDialog();
        logAiShieldDeviceEvent("media_projection_consent_dialog_shown", "screen");
        start.click();
        logAiShieldDeviceEvent("media_projection_consent_granted", "screen");
    }

    private UiObject2 waitForMediaProjectionDialog() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            UiObject2 start = device.findObject(
                By.text(Pattern.compile("(?i)(start now|start recording)"))
            );
            if (start != null && start.isEnabled()) {
                return start;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Android MediaProjection consent dialog did not appear");
    }

    private void cancelMediaProjectionDialog() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            UiObject2 cancel = device.findObject(
                By.text(Pattern.compile("(?i)(cancel|deny|don't allow|not now)"))
            );
            if (cancel != null && cancel.isEnabled()) {
                cancel.click();
                return;
            }
            if (device.findObject(
                    By.text(Pattern.compile("(?i)(start now|start recording)"))
                ) == null) {
                device.pressBack();
                return;
            }
            Thread.sleep(250);
        }
        throw new AssertionError("Android MediaProjection consent dialog did not cancel");
    }

    private void startScreenConsentWithoutWaiting() throws Exception {
        JSONObject result = callWebView(
            "(() => {" +
                "window.Capacitor.Plugins.SafeNetVpn.startAiShieldScreen().catch(() => {});" +
                "return true;" +
            "})()"
        );
        assertTrue("Could not start the pending MediaProjection consent request",
            result.getBoolean("value"));
    }

    private void relaunchActivity() throws Exception {
        Intent launchIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        activity = InstrumentationRegistry.getInstrumentation().startActivitySync(launchIntent);
        waitForCapacitorBridge();
    }

    private void recreateActivity() throws Exception {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> activity.recreate());
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        relaunchActivity();
    }

    private void rotateDevice() throws Exception {
        device.setOrientationLeft();
        Thread.sleep(1000);
        device.setOrientationNatural();
        Thread.sleep(1000);
    }

    private void waitForCapacitorBridge() throws Exception {
        waitForWebView(
            "Boolean(window.Capacitor && window.Capacitor.Plugins && " +
                "window.Capacitor.Plugins.SafeNetVpn)"
        );
    }

    private Bundle instrumentationArguments() {
        return InstrumentationRegistry.getArguments();
    }

    private boolean hasInstrumentationArgument(String name) {
        return instrumentationArguments().containsKey(name);
    }

    private void setClerkSessionCookies(String origin, String cookieLines) throws Exception {
        String[] cookies = cookieLines.split("\\n");
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            for (String cookie : cookies) {
                String trimmedCookie = cookie.trim();
                if (!trimmedCookie.isEmpty()) {
                    cookieManager.setCookie(origin, trimmedCookie);
                }
            }
            cookieManager.flush();
        });
        Thread.sleep(500);
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
        return callWebViewWithConsent(expression, null);
    }

    private JSONObject callWebViewWithConsent(
        String expression,
        ConsentAction consentAction
    ) throws Exception {
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
            if (consentAction != null) {
                consentAction.grant();
            }
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

    private JSONObject requireWebViewValue(JSONObject result) throws Exception {
        assertTrue("SafeNetVpn bridge call failed: " + result.optString("message"),
            result.optBoolean("ok", false));
        return result.getJSONObject("value");
    }

    private JSONObject waitForAiShieldInference(String expectedSource) throws Exception {
        return waitForAiShieldStatus(
            "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()",
            status -> expectedSource.equals(status.optString("source"))
                && status.optBoolean("monitoring", false)
                && (
                    AiShieldClassifier.STATE_SAFE.equals(status.optString("state")) ||
                    AiShieldClassifier.STATE_NUDITY_DETECTED.equals(status.optString("state")) ||
                    AiShieldClassifier.STATE_UNCERTAIN.equals(status.optString("state"))
                )
        );
    }

    private void assertAiShieldInference(JSONObject result, String expectedSource) throws Exception {
        assertEquals(expectedSource, result.getString("source"));
        assertTrue(
            "AI Shield must expose a local inference state, not a capture failure: " + result,
            AiShieldClassifier.STATE_SAFE.equals(result.getString("state")) ||
                AiShieldClassifier.STATE_NUDITY_DETECTED.equals(result.getString("state")) ||
                AiShieldClassifier.STATE_UNCERTAIN.equals(result.getString("state"))
        );
        assertTrue("A local inference result must include confidence",
            result.has("confidence") && !result.isNull("confidence"));
    }

    private void assertAiShieldSourceRemainsActive(String expectedSource) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while (System.nanoTime() < deadline) {
            JSONObject status = requireWebViewValue(callWebView(
                "window.Capacitor.Plugins.SafeNetVpn.getAiShieldStatus()"
            ));
            assertEquals(
                "A callback from the previous AI Shield source changed the active source",
                expectedSource,
                status.getString("source")
            );
            assertTrue(
                "A callback from the previous AI Shield source stopped the new capture",
                status.getBoolean("monitoring")
            );
            Thread.sleep(250);
        }
        logAiShieldDeviceEvent("source_stable", expectedSource);
    }

    private JSONObject startAndVerifyAiShieldSource(
        String expectedSource,
        ConsentAction consentAction
    ) throws Exception {
        String startExpression = "camera".equals(expectedSource)
            ? "window.Capacitor.Plugins.SafeNetVpn.startAiShieldCamera()"
            : "window.Capacitor.Plugins.SafeNetVpn.startAiShieldScreen()";
        JSONObject started = requireWebViewValue(callWebViewWithConsent(
            startExpression,
            consentAction
        ));
        assertEquals(expectedSource, started.getString("source"));
        assertTrue(
            "Selecting " + expectedSource + " must leave AI Shield monitoring active",
            started.getBoolean("monitoring")
        );

        assertAiShieldInference(waitForAiShieldInference(expectedSource), expectedSource);
        assertAiShieldSourceRemainsActive(expectedSource);
        return started;
    }

    private void logAiShieldDeviceEvent(String event, String source) {
        Log.i(
            AI_SHIELD_DEVICE_SMOKE_TAG,
            "AI_SHIELD_DEVICE_EVENT event=" + event
                + " source=" + source
                + " test=" + testName.getMethodName()
        );
    }

    private JSONObject waitForAiShieldStatus(
        String expression,
        AiShieldStatusPredicate predicate
    ) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(JS_TIMEOUT_SECONDS);
        JSONObject latest = null;
        while (System.nanoTime() < deadline) {
            JSONObject result = callWebView(expression);
            if (result.optBoolean("ok", false)) {
                latest = result.optJSONObject("value");
                if (latest != null && predicate.matches(latest)) {
                    return latest;
                }
            }
            Thread.sleep(250);
        }
        throw new AssertionError("AI Shield status did not reach the expected state: " + latest);
    }

    private String executeShellCommand(String command) throws Exception {
        ParcelFileDescriptor output = InstrumentationRegistry.getInstrumentation()
            .getUiAutomation()
            .executeShellCommand(command);
        StringBuilder result = new StringBuilder();
        try (ParcelFileDescriptor.AutoCloseInputStream input =
                 new ParcelFileDescriptor.AutoCloseInputStream(output)) {
            int value;
            while ((value = input.read()) != -1) {
                result.append((char) value);
            }
        }
        return result.toString();
    }

    private interface ConsentAction {
        void grant() throws Exception;
    }

    private interface AiShieldStatusPredicate {
        boolean matches(JSONObject status) throws Exception;
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