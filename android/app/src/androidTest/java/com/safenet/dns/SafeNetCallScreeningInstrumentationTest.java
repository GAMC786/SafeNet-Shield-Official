package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.role.RoleManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.telecom.CallScreeningService.CallResponse;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.TimeUnit;

/**
 * Real-emulator checks for the Android call-screening role, response mapping,
 * and native decision boundary. The smoke script supplies a trusted HTTPS
 * fixture origin for the reputation cases; response and local-block checks
 * remain runnable without the fixture.
 */
@RunWith(AndroidJUnit4.class)
public class SafeNetCallScreeningInstrumentationTest {
    private static final String TAG = "SafeNetCallScreeningSmoke";
    private static final String PACKAGE_NAME = "com.safenet.dns";
    private static final String ROLE_NAME = "android.app.role.CALL_SCREENING";
    private static final String BLOCKED_NUMBER = "+15550000001";
    private static final String ALLOW_NUMBER = "+15550000002";
    private static final String SILENCE_NUMBER = "+15550000003";
    private static final String REPUTATION_BLOCK_NUMBER = "+15550000004";
    private static final String UNAVAILABLE_NUMBER = "+15550000005";
    private static final String MALFORMED_NUMBER = "+15550000006";
    private static final String TIMEOUT_NUMBER = "+15550000007";
    private static final String OFFLINE_BLOCK_NUMBER = "+19057712581";

    private final Context context =
        InstrumentationRegistry.getInstrumentation().getTargetContext();
    private SharedPreferences preferences;

    @Before
    public void setUp() {
        preferences = context.getSharedPreferences(
            SafeNetCallScreeningService.PREFS_NAME,
            Context.MODE_PRIVATE
        );
        preferences.edit().clear().commit();
    }

    @Test
    public void callScreeningRoleCanBeGrantedOnSupportedEmulator() throws Exception {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Log.i(TAG, "CALL_SCREENING_ROLE result=SKIP reason=role_api_unavailable");
            return;
        }

        RoleManager roleManager = context.getSystemService(RoleManager.class);
        assertNotNull("Android did not expose RoleManager", roleManager);
        assertTrue("Android did not expose the call-screening role",
            roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING));

        if (!roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
            runShellCommand(
                "cmd role add-role-holder --user 0 " + ROLE_NAME + " " + PACKAGE_NAME
            );
        }

        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (!roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) &&
            System.nanoTime() < deadline) {
            Thread.sleep(250);
        }
        assertTrue("SafeNet did not receive the Android call-screening role",
            roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING));
        Log.i(TAG, "CALL_SCREENING_ROLE result=PASS role=HELD service=REGISTERED");
    }

    @Test
    public void callResponseFlagsMatchEverySupportedAction() {
        assertResponse(
            SafeNetCallScreeningService.buildResponse("allow"),
            false, false, false, false
        );
        assertResponse(
            SafeNetCallScreeningService.buildResponse("silence"),
            false, false, true, false
        );
        assertResponse(
            SafeNetCallScreeningService.buildResponse("block"),
            true, true, false, true
        );
        assertResponse(
            SafeNetCallScreeningService.buildResponse("unexpected"),
            false, false, false, false
        );
        Log.i(TAG,
            "CALL_SCREENING_RESPONSES result=PASS allow=ALLOW silence=SILENCE block=BLOCK " +
                "unknown=ALLOW");
    }

    @Test
    public void localBlockDoesNotDependOnProviderAvailability() {
        preferences.edit()
            // This endpoint is intentionally unusable. A local block must
            // return before the provider is consulted.
            .putString(SafeNetCallScreeningService.PREF_API_ORIGIN, "https://127.0.0.1:1")
            .putStringSet(
                SafeNetCallScreeningService.PREF_BLOCKED_NUMBERS,
                Collections.singleton(BLOCKED_NUMBER)
            )
            .commit();

        assertEquals("block", action(BLOCKED_NUMBER));
        Log.i(TAG, "CALL_SCREENING_LOCAL_BLOCK result=PASS provider=NOT_REQUIRED");
    }

    @Test
    public void localBlockMatchesNumbersRegardlessOfPlusAndFormatting() {
        preferences.edit()
            .putStringSet(
                SafeNetCallScreeningService.PREF_BLOCKED_NUMBERS,
                Collections.singleton("+1 (555) 000-0001")
            )
            .commit();

        assertEquals("block", action("15550000001"));
        assertEquals("block", action("+1-555-000-0001"));
        Log.i(TAG, "CALL_SCREENING_LOCAL_BLOCK_FORMAT result=PASS");
    }

    @Test
    public void withheldOrUnknownCallerBlockingRequiresExplicitOptIn() {
        assertEquals("allow", action(null));

        preferences.edit()
            .putBoolean(SafeNetCallScreeningService.PREF_BLOCK_UNKNOWN_CALLERS, true)
            .commit();
        assertEquals("block", action(null));

        preferences.edit()
            .putBoolean(SafeNetCallScreeningService.PREF_BLOCK_UNKNOWN_CALLERS, false)
            .commit();
        assertEquals("allow", action(null));
        Log.i(TAG, "CALL_SCREENING_UNKNOWN_CALLER_POLICY result=PASS default=ALLOW opted_in=BLOCK");
    }

    @Test
    public void positiveReputationDecisionsAreUsedOfflineUntilTheyExpire() {
        long now = System.currentTimeMillis();
        preferences.edit()
            .putString(SafeNetCallScreeningService.PREF_API_ORIGIN, "https://127.0.0.1:1")
            .commit();
        SafeNetCallScreeningService.cacheReputationDecision(
            preferences,
            REPUTATION_BLOCK_NUMBER,
            "block",
            now
        );
        SafeNetCallScreeningService.cacheReputationDecision(
            preferences,
            SILENCE_NUMBER,
            "silence",
            now
        );
        SafeNetCallScreeningService.cacheReputationDecision(
            preferences,
            ALLOW_NUMBER,
            "allow",
            now
        );

        // The positive cache is checked before network access, keeping repeat
        // callers screened even when the configured service cannot be reached.
        assertEquals(
            "block",
            SafeNetCallScreeningService.cachedReputationAction(
                preferences,
                REPUTATION_BLOCK_NUMBER.substring(1),
                now
            )
        );
        assertEquals("block", action(REPUTATION_BLOCK_NUMBER.substring(1)));
        assertEquals("silence", action(SILENCE_NUMBER));
        assertNull(SafeNetCallScreeningService.cachedReputationAction(
            preferences,
            ALLOW_NUMBER,
            now
        ));
        assertNull(SafeNetCallScreeningService.cachedReputationAction(
            preferences,
            REPUTATION_BLOCK_NUMBER,
            now + SafeNetCallScreeningService.REPUTATION_DECISION_TTL_MS + 1
        ));
        assertEquals("allow", action(REPUTATION_BLOCK_NUMBER));
        Log.i(TAG, "CALL_SCREENING_REPUTATION_CACHE result=PASS positive_only=PASS ttl_hours=24");
    }

    @Test
    public void localToggleTurnsScreeningOffWithoutReleasingTheAndroidRole() {
        preferences.edit()
            .putBoolean(SafeNetCallScreeningService.PREF_ENABLED, false)
            .putStringSet(
                SafeNetCallScreeningService.PREF_BLOCKED_NUMBERS,
                Collections.singleton(BLOCKED_NUMBER)
            )
            .commit();

        assertEquals("allow", action(BLOCKED_NUMBER));

        preferences.edit()
            .putBoolean(SafeNetCallScreeningService.PREF_ENABLED, true)
            .commit();
        assertEquals("block", action(BLOCKED_NUMBER));
        Log.i(TAG, "CALL_SCREENING_TOGGLE result=PASS off=ALLOW on=BLOCK");
    }

    @Test
    public void verifiedOfflineSnapshotScreensCallsWithoutAProvider() {
        preferences.edit()
            .putStringSet(
                SafeNetCallScreeningService.PREF_BLOCKED_NUMBERS,
                Collections.emptySet()
            )
            .commit();

        assertNotNull(
            SafeNetCallScreeningService.loadBundledCallShieldFeed(context, preferences)
        );
        assertEquals("block", action(OFFLINE_BLOCK_NUMBER));
        assertEquals("allow", action(ALLOW_NUMBER));

        preferences.edit()
            .putInt(SafeNetCallScreeningService.PREF_CALLSHIELD_FEED_VERSION, 42)
            .commit();
        assertEquals(
            "allow",
            action(OFFLINE_BLOCK_NUMBER)
        );
        Log.i(TAG, "CALL_SCREENING_OFFLINE_FEED result=PASS verified=BLOCK downgrade=ALLOW");
    }

    @Test
    public void reputationDecisionsAndFallbacksAreFailOpen() throws Exception {
        String origin = argument("call-screening-origin", "");
        if (origin.isEmpty()) {
            Log.i(TAG, "CALL_SCREENING_DECISIONS result=SKIP reason=fixture_not_configured");
            return;
        }

        preferences.edit()
            .putString(SafeNetCallScreeningService.PREF_API_ORIGIN, origin)
            .putStringSet(
                SafeNetCallScreeningService.PREF_BLOCKED_NUMBERS,
                Collections.singleton(BLOCKED_NUMBER)
            )
            .commit();

        assertActionResponse("block", BLOCKED_NUMBER);
        assertActionResponse("allow", ALLOW_NUMBER);
        assertActionResponse("silence", SILENCE_NUMBER);
        assertActionResponse("block", REPUTATION_BLOCK_NUMBER);
        assertActionResponse("allow", UNAVAILABLE_NUMBER);
        assertActionResponse("allow", MALFORMED_NUMBER);
        long timeoutStarted = System.nanoTime();
        assertActionResponse("allow", TIMEOUT_NUMBER);
        long timeoutElapsedMs = TimeUnit.NANOSECONDS.toMillis(
            System.nanoTime() - timeoutStarted
        );
        assertTrue("Reputation timeout was not bounded: " + timeoutElapsedMs + "ms",
            timeoutElapsedMs < 5000);

        Log.i(TAG,
            "CALL_SCREENING_DECISIONS result=PASS local_block=PASS allow=PASS " +
                "silence=PASS reputation_block=PASS unavailable=ALLOW malformed=ALLOW " +
                "timeout=ALLOW timeout_ms<5000");
    }

    private String action(String number) {
        return SafeNetCallScreeningService.decideAction(
            context,
            preferences,
            SafeNetCallScreeningService.normalizeNumber(number)
        );
    }

    private void assertActionResponse(String expectedAction, String number) {
        assertEquals(expectedAction, action(number));
        if ("block".equals(expectedAction)) {
            assertResponse(
                SafeNetCallScreeningService.buildResponse(expectedAction),
                true, true, false, true
            );
        } else if ("silence".equals(expectedAction)) {
            assertResponse(
                SafeNetCallScreeningService.buildResponse(expectedAction),
                false, false, true, false
            );
        } else {
            assertResponse(
                SafeNetCallScreeningService.buildResponse(expectedAction),
                false, false, false, false
            );
        }
    }

    private void assertResponse(
        CallResponse response,
        boolean disallow,
        boolean reject,
        boolean silence,
        boolean skipNotification
    ) {
        assertEquals("disallowCall", disallow, response.getDisallowCall());
        assertEquals("rejectCall", reject, response.getRejectCall());
        assertEquals("silenceCall", silence, response.getSilenceCall());
        assertEquals("skipNotification", skipNotification, response.getSkipNotification());
        assertEquals("skipCallLog", false, response.getSkipCallLog());
    }

    private String argument(String name, String fallback) {
        String value = InstrumentationRegistry.getArguments().getString(name);
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private void runShellCommand(String command) throws IOException {
        ParcelFileDescriptor descriptor = InstrumentationRegistry.getInstrumentation()
            .getUiAutomation()
            .executeShellCommand(command);
        try (ParcelFileDescriptor.AutoCloseInputStream input =
                 new ParcelFileDescriptor.AutoCloseInputStream(descriptor);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[512];
            int length;
            while ((length = input.read(buffer)) != -1) {
                output.write(buffer, 0, length);
            }
            String result = output.toString(StandardCharsets.UTF_8.name());
            if (result.toLowerCase().contains("error")) {
                throw new IOException("Role grant command failed: " + result);
            }
        }
    }
}