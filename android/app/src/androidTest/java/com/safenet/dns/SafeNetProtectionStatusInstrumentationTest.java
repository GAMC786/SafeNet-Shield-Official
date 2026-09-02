package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SafeNetProtectionStatusInstrumentationTest {
    @Test
    public void stateMachineFailsClosedWhenOwnershipCannotBeVerified() {
        assertEquals(
            SafeNetProtectionStatus.STATE_PROTECTED,
            SafeNetProtectionStatus.resolveState(true, true, false, true)
        );
        assertEquals(
            SafeNetProtectionStatus.STATE_VPN_REPLACED,
            SafeNetProtectionStatus.resolveState(true, false, true, true)
        );
        assertEquals(
            SafeNetProtectionStatus.STATE_DNS_BYPASS_POSSIBLE,
            SafeNetProtectionStatus.resolveState(true, false, false, true)
        );
        assertEquals(
            SafeNetProtectionStatus.STATE_PROTECTION_UNAVAILABLE,
            SafeNetProtectionStatus.resolveState(false, false, false, false)
        );
    }

    @Test
    public void revokedVpnIsReportedAsReplaced() {
        assertEquals(
            SafeNetProtectionStatus.STATE_VPN_REPLACED,
            SafeNetProtectionStatus.resolveState(true, false, false, true, true)
        );
    }

    @Test
    public void statusAlwaysExplainsPrivateProxyAndDnsLimitations() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        JSONObject status = SafeNetProtectionStatus.get(context);

        assertEquals(
            SafeNetProtectionStatus.STATE_PROXY_UNINSPECTABLE,
            status.getString("proxyState")
        );
        assertTrue(status.getString("proxyMessage").toLowerCase().contains("cannot"));
        assertTrue(status.getJSONArray("limitations").length() >= 3);
        assertTrue(status.getLong("timestamp") > 0);
    }
}