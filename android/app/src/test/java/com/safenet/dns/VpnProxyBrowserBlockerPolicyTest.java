package com.safenet.dns;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Collections;
import java.util.Set;

import org.junit.Test;

public class VpnProxyBrowserBlockerPolicyTest {
    private static final String SAFE_NET_PACKAGE = "com.safenet.dns";
    private static final String VPN_PACKAGE = "org.example.vpn";

    @Test
    public void blocksOnlySelectedPackagesWhenEnabledAndAccessibilityIsGranted() {
        Set<String> blockedPackages = Collections.singleton(VPN_PACKAGE);

        assertTrue(VpnProxyBrowserBlockerManager.shouldBlockPackage(
                true,
                true,
                blockedPackages,
                VPN_PACKAGE,
                SAFE_NET_PACKAGE
        ));
        assertFalse(VpnProxyBrowserBlockerManager.shouldBlockPackage(
                false,
                true,
                blockedPackages,
                VPN_PACKAGE,
                SAFE_NET_PACKAGE
        ));
        assertFalse(VpnProxyBrowserBlockerManager.shouldBlockPackage(
                true,
                false,
                blockedPackages,
                VPN_PACKAGE,
                SAFE_NET_PACKAGE
        ));
        assertFalse(VpnProxyBrowserBlockerManager.shouldBlockPackage(
                true,
                true,
                blockedPackages,
                "org.example.other",
                SAFE_NET_PACKAGE
        ));
    }

    @Test
    public void neverBlocksSafeNetItself() {
        assertFalse(VpnProxyBrowserBlockerManager.shouldBlockPackage(
                true,
                true,
                Collections.singleton(SAFE_NET_PACKAGE),
                SAFE_NET_PACKAGE,
                SAFE_NET_PACKAGE
        ));
    }
}