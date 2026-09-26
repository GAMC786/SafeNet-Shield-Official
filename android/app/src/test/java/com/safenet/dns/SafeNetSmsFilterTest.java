package com.safenet.dns;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class SafeNetSmsFilterTest {
    @Test
    public void incomingFilterNeedsDefaultSmsRoleAndReceivePermission() {
        assertTrue(SafeNetSmsFilter.canEnableFiltering(true, true));
        assertFalse(SafeNetSmsFilter.canEnableFiltering(false, true));
        assertFalse(SafeNetSmsFilter.canEnableFiltering(true, false));
    }

    @Test
    public void effectiveFilterStateRequiresSavedToggleRoleAndReceivePermission() {
        assertTrue(SafeNetSmsFilter.isEffectivelyEnabled(true, true, true));
        assertFalse(SafeNetSmsFilter.isEffectivelyEnabled(false, true, true));
        assertFalse(SafeNetSmsFilter.isEffectivelyEnabled(true, false, true));
        assertFalse(SafeNetSmsFilter.isEffectivelyEnabled(true, true, false));
    }

    @Test
    public void filteringIsDisabledUntilUserEnablesIt() {
        SafeNetSmsFilter.Result result = SafeNetSmsFilter.classifyText(
            "+1 555 123 4567",
            "Click to win a cash prize",
            false,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList()
        );

        assertFalse(result.blocked);
    }

    @Test
    public void obviousJunkPhraseIsQuarantinedWhenFilteringIsEnabled() {
        SafeNetSmsFilter.Result result = SafeNetSmsFilter.classifyText(
            "+1 555 123 4567",
            "Congratulations winner, click to win!",
            true,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList()
        );

        assertTrue(result.blocked);
    }

    @Test
    public void allowedSenderBypassesBuiltInAndCustomRules() {
        SafeNetSmsFilter.Result result = SafeNetSmsFilter.classifyText(
            "+1 (555) 123-4567",
            "Click to win your free money",
            true,
            Arrays.asList("free money"),
            Collections.emptyList(),
            Arrays.asList("+15551234567")
        );

        assertFalse(result.blocked);
    }

    @Test
    public void regexRulesMatchButRejectGroupingAndRepeatedQuantifiers() {
        SafeNetSmsFilter.Result result = SafeNetSmsFilter.classifyText(
            "BANK",
            "Your account needs urgent review",
            true,
            Collections.emptyList(),
            Arrays.asList("urgent\\s+review"),
            Collections.emptyList()
        );

        assertTrue(result.blocked);
        assertFalse(SafeNetSmsFilter.isSafeRegex("(a+)+$"));
        assertFalse(SafeNetSmsFilter.isSafeRegex("(a|aa)+$"));
        assertFalse(SafeNetSmsFilter.isSafeRegex("a*a*"));
        assertFalse(SafeNetSmsFilter.isSafeRegex("(?=urgent).*"));
    }
}