package com.safenet.dns;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DnsFirewallTest {
    private static final String SETTINGS = "{\"firewallEnabled\":true}";

    @Test
    public void disabledFirewallAllowsQueries() throws Exception {
        DnsFirewall firewall = DnsFirewall.fromJson(config(
            "{\"type\":\"domain\",\"content\":\"example.com\",\"action\":\"block\",\"isActive\":true}"
        ).replace("\"firewallEnabled\":true", "\"firewallEnabled\":false"));

        assertEquals(
            DnsFirewall.Decision.ALLOW,
            firewall.evaluate(query("example.com"), "10.248.0.2", "10.248.0.1")
        );
    }

    @Test
    public void explicitAllowWinsOverDomainAndKeywordBlocks() throws Exception {
        DnsFirewall firewall = DnsFirewall.fromJson(config(
            "{\"type\":\"domain\",\"content\":\"google.com\",\"action\":\"allow\",\"isActive\":true},"
                + "{\"type\":\"domain\",\"content\":\"google.com\",\"action\":\"block\",\"isActive\":true},"
                + "{\"type\":\"keyword\",\"content\":\"google\",\"action\":\"block\",\"isActive\":true}"
        ));

        assertEquals(
            DnsFirewall.Decision.ALLOW,
            firewall.evaluate(query("accounts.google.com"), "10.248.0.2", "10.248.0.1")
        );
    }

    @Test
    public void inactiveFiltersAndNonMatchingSuffixesDoNotBlock() throws Exception {
        DnsFirewall firewall = DnsFirewall.fromJson(config(
            "{\"type\":\"domain\",\"content\":\"example.com\",\"action\":\"block\",\"isActive\":true},"
                + "{\"type\":\"keyword\",\"content\":\"casino\",\"action\":\"block\",\"isActive\":false}"
        ));

        assertEquals(
            DnsFirewall.Decision.ALLOW,
            firewall.evaluate(query("notexample.com"), "10.248.0.2", "10.248.0.1")
        );
        assertEquals(
            DnsFirewall.Decision.ALLOW,
            firewall.evaluate(query("example.net"), "10.248.0.2", "10.248.0.1")
        );
        assertEquals(
            DnsFirewall.Decision.ALLOW,
            firewall.evaluate(query("casino.example.net"), "10.248.0.2", "10.248.0.1")
        );
        assertEquals(
            DnsFirewall.Decision.BLOCK,
            firewall.evaluate(query("sub.example.com"), "10.248.0.2", "10.248.0.1")
        );
    }

    @Test
    public void highestPriorityAccessRuleWinsBeforeDomainFilters() throws Exception {
        DnsFirewall firewall = DnsFirewall.fromJson(
            "{\"settings\":" + SETTINGS
                + ",\"rules\":["
                + "{\"id\":1,\"sourceInterface\":\"lan\",\"sourceAddress\":\"Any\","
                + "\"destinationInterface\":\"wan\",\"destinationAddress\":\"Any\","
                + "\"service\":\"dns\",\"action\":\"deny\",\"isEnabled\":true,\"priority\":10},"
                + "{\"id\":2,\"sourceInterface\":\"lan\",\"sourceAddress\":\"Any\","
                + "\"destinationInterface\":\"wan\",\"destinationAddress\":\"Any\","
                + "\"service\":\"dns\",\"action\":\"allow\",\"isEnabled\":true,\"priority\":20}"
                + "],\"blocklists\":["
                + "{\"type\":\"domain\",\"content\":\"example.com\",\"action\":\"block\",\"isActive\":true}"
                + "]}"
        );

        assertEquals(
            DnsFirewall.Decision.ALLOW,
            firewall.evaluate(query("example.com"), "10.248.0.2", "10.248.0.1")
        );
    }

    @Test
    public void malformedQueriesFailClosedAndNeverForward() throws Exception {
        DnsFirewall firewall = DnsFirewall.fromJson(config(""));
        byte[] malformed = new byte[] { 0x53, 0x4e, 0, 0, 0, 1 };

        assertEquals(
            DnsFirewall.Decision.BLOCK,
            firewall.evaluate(malformed, "10.248.0.2", "10.248.0.1")
        );
        byte[] response = DnsFirewall.blockedResponse(malformed);
        assertEquals(0x534e, unsignedShort(response, 0));
        assertEquals(5, unsignedShort(response, 2) & 0x000f);
        assertTrue(response.length >= 12);
    }

    @Test
    public void evaluationIncludesThePolicyReasonAndQueriedDomain() throws Exception {
        DnsFirewall firewall = DnsFirewall.fromJson(config(
            "{\"type\":\"domain\",\"content\":\"blocked.example\",\"action\":\"block\",\"isActive\":true}"
        ));

        DnsFirewall.Evaluation blocked = firewall.evaluateWithReason(
            query("www.blocked.example"),
            "10.248.0.2",
            "10.248.0.1"
        );
        assertEquals(DnsFirewall.Decision.BLOCK, blocked.decision);
        assertEquals("domain_blocklist", blocked.reason);
        assertEquals("www.blocked.example", DnsFirewall.queryDomain(query("www.blocked.example")));

        DnsFirewall.Evaluation allowed = firewall.evaluateWithReason(
            query("safe.example"),
            "10.248.0.2",
            "10.248.0.1"
        );
        assertEquals(DnsFirewall.Decision.ALLOW, allowed.decision);
        assertEquals("allowed_by_policy", allowed.reason);
    }

    private static String config(String blocklists) {
        return "{\"settings\":" + SETTINGS + ",\"rules\":[],\"blocklists\":["
            + blocklists + "]}";
    }

    private static byte[] query(String name) {
        String[] labels = name.split("\\.");
        byte[] result = new byte[12 + name.length() + labels.length + 1 + 4];
        result[0] = 0x53;
        result[1] = 0x4e;
        result[2] = 0x01;
        result[3] = 0x00;
        result[4] = 0;
        result[5] = 1;
        int offset = 12;
        for (String label : labels) {
            result[offset++] = (byte) label.length();
            for (int index = 0; index < label.length(); index++) {
                result[offset++] = (byte) label.charAt(index);
            }
        }
        result[offset++] = 0;
        result[offset++] = 0;
        result[offset++] = 1;
        result[offset++] = 0;
        result[offset] = 1;
        return result;
    }

    private static int unsignedShort(byte[] value, int offset) {
        return ((value[offset] & 0xff) << 8) | (value[offset + 1] & 0xff);
    }
}