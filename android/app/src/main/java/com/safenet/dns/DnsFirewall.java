package com.safenet.dns;

import java.net.InetAddress;
import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Evaluates the server's firewall snapshot against DNS question names.
 *
 * The snapshot is deliberately kept as a small, immutable object. The VPN
 * loop can replace the reference atomically while a packet is being handled,
 * so a refresh never leaves it with a partially updated rule set.
 */
public final class DnsFirewall {
    public enum Decision {
        ALLOW,
        BLOCK
    }

    public static final class Evaluation {
        public final Decision decision;
        public final String reason;

        private Evaluation(Decision decision, String reason) {
            this.decision = decision;
            this.reason = reason;
        }
    }

    private static final String ANY = "any";
    private static final String DNS = "dns";
    private static final String ALL = "all";

    private final boolean enabled;
    private final List<AccessRule> accessRules;
    private final List<Filter> filters;
    private final boolean failClosed;

    private DnsFirewall(
        boolean enabled,
        List<AccessRule> accessRules,
        List<Filter> filters,
        boolean failClosed
    ) {
        this.enabled = enabled;
        this.accessRules = Collections.unmodifiableList(new ArrayList<>(accessRules));
        this.filters = Collections.unmodifiableList(new ArrayList<>(filters));
        this.failClosed = failClosed;
    }

    public static DnsFirewall allowAll() {
        return new DnsFirewall(false, Collections.emptyList(), Collections.emptyList(), false);
    }

    public static DnsFirewall failClosed() {
        return new DnsFirewall(true, Collections.emptyList(), Collections.emptyList(), true);
    }

    boolean isEnabled() {
        return enabled;
    }

    public static DnsFirewall fromJson(String serialized) throws JSONException {
        JSONObject root = new JSONObject(serialized);
        JSONObject settings = root.optJSONObject("settings");
        JSONArray rulesJson = root.optJSONArray("rules");
        JSONArray filtersJson = root.optJSONArray("blocklists");
        if (settings == null || rulesJson == null || filtersJson == null ||
            !settings.has("firewallEnabled")) {
            throw new JSONException("The firewall snapshot is incomplete.");
        }
        if (!(settings.opt("firewallEnabled") instanceof Boolean)) {
            throw new JSONException("The firewall enabled setting is invalid.");
        }

        List<AccessRule> rules = new ArrayList<>();
        for (int index = 0; index < rulesJson.length(); index++) {
            JSONObject rule = rulesJson.optJSONObject(index);
            if (rule == null) {
                throw new JSONException("The firewall snapshot contains an invalid access rule.");
            }
            String action = requiredString(rule, "action").toLowerCase(Locale.US);
            if (!action.equals("allow") && !action.equals("deny")) {
                throw new JSONException("The firewall snapshot contains an unknown access rule action.");
            }
            rules.add(new AccessRule(
                rule.optInt("id", 0),
                requiredString(rule, "sourceInterface"),
                rule.optString("sourceAddress", "Any"),
                requiredString(rule, "destinationInterface"),
                rule.optString("destinationAddress", "Any"),
                requiredString(rule, "service"),
                action,
                rule.optBoolean("isEnabled", true),
                rule.optInt("priority", 100)
            ));
        }
        rules.sort(Comparator
            .comparingInt((AccessRule rule) -> rule.priority).reversed()
            .thenComparingInt(rule -> rule.id));

        List<Filter> filters = new ArrayList<>();
        for (int index = 0; index < filtersJson.length(); index++) {
            JSONObject filter = filtersJson.optJSONObject(index);
            if (filter == null) {
                throw new JSONException("The firewall snapshot contains an invalid filter.");
            }
            String type = requiredString(filter, "type").toLowerCase(Locale.US);
            if (!type.equals("domain") && !type.equals("keyword")) {
                throw new JSONException("The firewall snapshot contains an unknown filter type.");
            }
            String action = filter.optString("action", "block").toLowerCase(Locale.US);
            if (!action.equals("allow") && !action.equals("block")) {
                throw new JSONException("The firewall snapshot contains an unknown filter action.");
            }
            if (type.equals("keyword") && !action.equals("block")) {
                throw new JSONException("Keyword filters can only block DNS requests.");
            }
            String content = requiredString(filter, "content");
            filters.add(new Filter(
                type,
                content,
                action,
                filter.optBoolean("isActive", true)
            ));
        }

        return new DnsFirewall(
            settings.optBoolean("firewallEnabled", false),
            rules,
            filters,
            false
        );
    }

    public Decision evaluate(byte[] query, String sourceAddress, String destinationAddress) {
        return evaluateWithReason(query, sourceAddress, destinationAddress).decision;
    }

    public Evaluation evaluateWithReason(
        byte[] query,
        String sourceAddress,
        String destinationAddress
    ) {
        if (!enabled) {
            return new Evaluation(Decision.ALLOW, "firewall_disabled");
        }
        if (failClosed) {
            return new Evaluation(Decision.BLOCK, "firewall_unavailable");
        }

        List<String> names;
        try {
            names = questionNames(query);
        } catch (IllegalArgumentException error) {
            return new Evaluation(Decision.BLOCK, "invalid_dns_query");
        }

        for (AccessRule rule : accessRules) {
            if (rule.matches(sourceAddress, destinationAddress)) {
                return rule.action.equals("allow")
                    ? new Evaluation(Decision.ALLOW, "firewall_rule_allow")
                    : new Evaluation(Decision.BLOCK, "firewall_rule_deny");
            }
        }

        // Explicit domain allows are compatibility exceptions and must win
        // over both domain blocks and broad keyword filters.
        for (String name : names) {
            if (matchesDomain(name, "allow")) {
                return new Evaluation(Decision.ALLOW, "domain_allowlist");
            }
        }
        for (String name : names) {
            if (matchesDomain(name, "block")) {
                return new Evaluation(Decision.BLOCK, "domain_blocklist");
            }
            if (matchesKeyword(name)) {
                return new Evaluation(Decision.BLOCK, "keyword_blocklist");
            }
        }
        return new Evaluation(Decision.ALLOW, "allowed_by_policy");
    }

    public static String queryDomain(byte[] query) {
        try {
            List<String> names = questionNames(query);
            if (!names.isEmpty()) {
                return names.get(0).toLowerCase(Locale.US);
            }
        } catch (IllegalArgumentException ignored) {
            // The caller still records malformed packets with an explicit reason.
        }
        return "invalid";
    }

    /**
     * Builds a valid DNS REFUSED response without contacting the upstream
     * resolver. Only the original question section is retained.
     */
    public static byte[] blockedResponse(byte[] query) {
        if (query == null || query.length < 12) {
            byte[] response = new byte[12];
            if (query != null) {
                System.arraycopy(query, 0, response, 0, Math.min(query.length, 2));
            }
            writeUnsignedShort(response, 2, 0x8005);
            return response;
        }

        int questionEnd;
        try {
            questionEnd = questionEnd(query);
        } catch (IllegalArgumentException error) {
            questionEnd = 12;
        }

        byte[] response = new byte[questionEnd];
        System.arraycopy(query, 0, response, 0, questionEnd);
        int flags = readUnsignedShort(query, 2);
        flags = (flags & 0x7930) | 0x8000 | 0x0005;
        writeUnsignedShort(response, 2, flags);
        writeUnsignedShort(response, 4, questionEnd > 12 ? readUnsignedShort(query, 4) : 0);
        writeUnsignedShort(response, 6, 0);
        writeUnsignedShort(response, 8, 0);
        writeUnsignedShort(response, 10, 0);
        return response;
    }

    private boolean matchesDomain(String queryName, String action) {
        for (Filter filter : filters) {
            if (!filter.active || !filter.type.equals("domain") || !filter.action.equals(action)) {
                continue;
            }
            String pattern = normalizeHost(filter.content);
            if (pattern != null && domainMatches(queryName, pattern)) {
                return true;
            }
        }
        return false;
    }

    private boolean matchesKeyword(String queryName) {
        String normalizedName = queryName.toLowerCase(Locale.US);
        for (Filter filter : filters) {
            if (filter.active && filter.type.equals("keyword") &&
                normalizedName.contains(filter.content.toLowerCase(Locale.US))) {
                return true;
            }
        }
        return false;
    }

    private static boolean domainMatches(String queryName, String pattern) {
        String normalizedName = normalizeHost(queryName);
        return normalizedName != null &&
            (normalizedName.equals(pattern) || normalizedName.endsWith("." + pattern));
    }

    private static List<String> questionNames(byte[] query) {
        if (query == null || query.length < 12) {
            throw new IllegalArgumentException("DNS query header is incomplete.");
        }
        int questionCount = readUnsignedShort(query, 4);
        if (questionCount <= 0 || questionCount > 64) {
            throw new IllegalArgumentException("DNS query question count is invalid.");
        }

        List<String> names = new ArrayList<>();
        int offset = 12;
        for (int index = 0; index < questionCount; index++) {
            NameResult result = readName(query, offset);
            names.add(result.name);
            offset = result.endOffset;
            if (offset + 4 > query.length) {
                throw new IllegalArgumentException("DNS question is incomplete.");
            }
            offset += 4;
        }
        return names;
    }

    private static int questionEnd(byte[] query) {
        questionNames(query);
        int offset = 12;
        int questionCount = readUnsignedShort(query, 4);
        for (int index = 0; index < questionCount; index++) {
            NameResult result = readName(query, offset);
            offset = result.endOffset + 4;
        }
        return offset;
    }

    private static NameResult readName(byte[] query, int offset) {
        if (offset < 0 || offset >= query.length) {
            throw new IllegalArgumentException("DNS name is outside the query.");
        }
        StringBuilder name = new StringBuilder();
        int cursor = offset;
        Set<Integer> visited = new HashSet<>();
        while (true) {
            if (cursor >= query.length || !visited.add(cursor)) {
                throw new IllegalArgumentException("DNS name is malformed.");
            }
            int length = query[cursor++] & 0xff;
            if (length == 0) {
                return new NameResult(name.toString(), cursor);
            }
            if ((length & 0xc0) != 0 || length > 63 || cursor + length > query.length) {
                // Compression is not expected in a client query. Rejecting it
                // prevents a malformed packet from bypassing the filter.
                throw new IllegalArgumentException("Compressed or invalid DNS name.");
            }
            if (name.length() > 0) {
                name.append('.');
            }
            name.append(new String(query, cursor, length, java.nio.charset.StandardCharsets.US_ASCII));
            cursor += length;
        }
    }

    private static String requiredString(JSONObject object, String key) throws JSONException {
        String value = object.optString(key, "").trim();
        if (value.isEmpty()) {
            throw new JSONException("The firewall snapshot contains an empty " + key + ".");
        }
        return value;
    }

    static String normalizeHost(String value) {
        if (value == null) {
            return null;
        }
        String candidate = value.trim().toLowerCase(Locale.US);
        if (candidate.isEmpty()) {
            return null;
        }
        try {
            if (candidate.contains("://")) {
                candidate = URI.create(candidate).getHost();
            } else {
                candidate = candidate.replaceFirst("^//", "");
                int separator = candidate.indexOf('/');
                if (separator >= 0) {
                    candidate = candidate.substring(0, separator);
                }
                separator = candidate.indexOf('?');
                if (separator >= 0) {
                    candidate = candidate.substring(0, separator);
                }
                separator = candidate.indexOf('#');
                if (separator >= 0) {
                    candidate = candidate.substring(0, separator);
                }
            }
        } catch (IllegalArgumentException error) {
            return null;
        }
        if (candidate == null) {
            return null;
        }
        candidate = candidate.replaceFirst("^\\*\\.", "").replaceFirst("^\\.+", "");
        while (candidate.endsWith(".")) {
            candidate = candidate.substring(0, candidate.length() - 1);
        }
        return candidate.isEmpty() || candidate.contains(" ") ? null : candidate;
    }

    private static boolean addressMatches(String configured, String actual) {
        if (configured == null || configured.trim().isEmpty() ||
            configured.trim().equalsIgnoreCase("any")) {
            return true;
        }
        if (actual == null || actual.trim().isEmpty()) {
            return false;
        }
        String value = configured.trim();
        try {
            int slash = value.indexOf('/');
            InetAddress configuredAddress = InetAddress.getByName(slash >= 0
                ? value.substring(0, slash)
                : value);
            InetAddress actualAddress = InetAddress.getByName(actual);
            byte[] configuredBytes = configuredAddress.getAddress();
            byte[] actualBytes = actualAddress.getAddress();
            if (configuredBytes.length != actualBytes.length) {
                return false;
            }
            int prefix = slash >= 0
                ? Integer.parseInt(value.substring(slash + 1))
                : configuredBytes.length * 8;
            if (prefix < 0 || prefix > configuredBytes.length * 8) {
                return false;
            }
            int fullBytes = prefix / 8;
            int remainingBits = prefix % 8;
            for (int index = 0; index < fullBytes; index++) {
                if (configuredBytes[index] != actualBytes[index]) {
                    return false;
                }
            }
            return remainingBits == 0 ||
                (configuredBytes[fullBytes] & (0xff << (8 - remainingBits))) ==
                    (actualBytes[fullBytes] & (0xff << (8 - remainingBits)));
        } catch (Exception error) {
            return false;
        }
    }

    private static int readUnsignedShort(byte[] value, int offset) {
        return ((value[offset] & 0xff) << 8) | (value[offset + 1] & 0xff);
    }

    private static void writeUnsignedShort(byte[] value, int offset, int number) {
        value[offset] = (byte) ((number >>> 8) & 0xff);
        value[offset + 1] = (byte) (number & 0xff);
    }

    private static final class NameResult {
        private final String name;
        private final int endOffset;

        private NameResult(String name, int endOffset) {
            this.name = name;
            this.endOffset = endOffset;
        }
    }

    private static final class Filter {
        private final String type;
        private final String content;
        private final String action;
        private final boolean active;

        private Filter(String type, String content, String action, boolean active) {
            this.type = type;
            this.content = content;
            this.action = action;
            this.active = active;
        }
    }

    private static final class AccessRule {
        private final int id;
        private final String sourceInterface;
        private final String sourceAddress;
        private final String destinationInterface;
        private final String destinationAddress;
        private final String service;
        private final String action;
        private final boolean enabled;
        private final int priority;

        private AccessRule(
            int id,
            String sourceInterface,
            String sourceAddress,
            String destinationInterface,
            String destinationAddress,
            String service,
            String action,
            boolean enabled,
            int priority
        ) {
            this.id = id;
            this.sourceInterface = sourceInterface.toLowerCase(Locale.US);
            this.sourceAddress = sourceAddress;
            this.destinationInterface = destinationInterface.toLowerCase(Locale.US);
            this.destinationAddress = destinationAddress;
            this.service = service.toLowerCase(Locale.US);
            this.action = action.toLowerCase(Locale.US);
            this.enabled = enabled;
            this.priority = priority;
        }

        private boolean matches(String source, String destination) {
            if (!enabled || (!service.equals(DNS) && !service.equals(ALL))) {
                return false;
            }
            boolean sourceInterfaceMatches = sourceInterface.equals(ANY) || sourceInterface.equals("lan");
            boolean destinationInterfaceMatches =
                destinationInterface.equals(ANY) || destinationInterface.equals("wan");
            return sourceInterfaceMatches &&
                destinationInterfaceMatches &&
                addressMatches(sourceAddress, source) &&
                addressMatches(destinationAddress, destination);
        }
    }
}