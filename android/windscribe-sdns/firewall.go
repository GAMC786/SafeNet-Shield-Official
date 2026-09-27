package sdns

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strings"
)

// FirewallPolicy is an immutable copy of the authenticated Android firewall
// snapshot. Interceptor instances publish replacements atomically.
type FirewallPolicy struct {
	enabled          bool
	preventOverrides bool
	failClosed       bool
	accessRules      []firewallAccessRule
	filters          []firewallFilter
}

type firewallAccessRule struct {
	id                   int
	sourceInterface      string
	sourceAddress        string
	destinationInterface string
	destinationAddress   string
	service              string
	action               string
	enabled              bool
	priority             int
}

type firewallFilter struct {
	kind    string
	content string
	action  string
	active  bool
}

type firewallSnapshot struct {
	Settings struct {
		FirewallEnabled     *bool `json:"firewallEnabled"`
		PreventDNSOverrides *bool `json:"preventDnsOverrides"`
	} `json:"settings"`
	Rules      []json.RawMessage `json:"rules"`
	Blocklists []json.RawMessage `json:"blocklists"`
}

type firewallRuleJSON struct {
	ID                   int    `json:"id"`
	SourceInterface      string `json:"sourceInterface"`
	SourceAddress        string `json:"sourceAddress"`
	DestinationInterface string `json:"destinationInterface"`
	DestinationAddress   string `json:"destinationAddress"`
	Service              string `json:"service"`
	Action               string `json:"action"`
	IsEnabled            *bool  `json:"isEnabled"`
	Priority             *int   `json:"priority"`
}

type firewallFilterJSON struct {
	Type     string `json:"type"`
	Content  string `json:"content"`
	Action   string `json:"action"`
	IsActive *bool  `json:"isActive"`
}

func allowAllFirewallPolicy() *FirewallPolicy {
	return &FirewallPolicy{}
}

func failClosedFirewallPolicy() *FirewallPolicy {
	return &FirewallPolicy{enabled: true, preventOverrides: true, failClosed: true}
}

func parseFirewallPolicy(serialized string) (*FirewallPolicy, error) {
	var snapshot firewallSnapshot
	if err := json.Unmarshal([]byte(serialized), &snapshot); err != nil {
		return nil, fmt.Errorf("invalid firewall snapshot: %w", err)
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(serialized), &root); err != nil {
		return nil, fmt.Errorf("invalid firewall snapshot: %w", err)
	}
	if _, ok := root["settings"]; !ok || snapshot.Settings.FirewallEnabled == nil ||
		snapshot.Settings.PreventDNSOverrides == nil {
		return nil, errors.New("firewall snapshot settings are incomplete")
	}
	if _, ok := root["rules"]; !ok {
		return nil, errors.New("firewall snapshot rules are missing")
	}
	if _, ok := root["blocklists"]; !ok {
		return nil, errors.New("firewall snapshot blocklists are missing")
	}
	if len(snapshot.Rules) == 0 && !isJSONArray(root["rules"]) {
		return nil, errors.New("firewall snapshot rules are invalid")
	}
	if len(snapshot.Blocklists) == 0 && !isJSONArray(root["blocklists"]) {
		return nil, errors.New("firewall snapshot blocklists are invalid")
	}
	var settingValues map[string]json.RawMessage
	if err := json.Unmarshal(root["settings"], &settingValues); err != nil {
		return nil, errors.New("firewall snapshot settings are invalid")
	}
	if raw, ok := settingValues["tailscaleNonDnsFirewallEnabled"]; ok {
		var enabled bool
		if err := json.Unmarshal(raw, &enabled); err != nil {
			return nil, errors.New("firewall snapshot non-DNS setting is invalid")
		}
	}

	policy := &FirewallPolicy{
		enabled:          *snapshot.Settings.FirewallEnabled,
		preventOverrides: *snapshot.Settings.PreventDNSOverrides,
	}
	for index, raw := range snapshot.Rules {
		var rule firewallRuleJSON
		if err := json.Unmarshal(raw, &rule); err != nil ||
			strings.TrimSpace(rule.SourceInterface) == "" ||
			strings.TrimSpace(rule.DestinationInterface) == "" ||
			strings.TrimSpace(rule.Service) == "" ||
			strings.TrimSpace(rule.Action) == "" {
			return nil, fmt.Errorf("firewall access rule %d is invalid", index)
		}
		rule.Action = strings.ToLower(strings.TrimSpace(rule.Action))
		if rule.Action != "allow" && rule.Action != "deny" {
			return nil, fmt.Errorf("firewall access rule %d has an unknown action", index)
		}
		enabled := true
		if rule.IsEnabled != nil {
			enabled = *rule.IsEnabled
		}
		priority := 100
		if rule.Priority != nil {
			priority = *rule.Priority
		}
		sourceAddress := rule.SourceAddress
		if strings.TrimSpace(sourceAddress) == "" {
			sourceAddress = "Any"
		}
		destinationAddress := rule.DestinationAddress
		if strings.TrimSpace(destinationAddress) == "" {
			destinationAddress = "Any"
		}
		policy.accessRules = append(policy.accessRules, firewallAccessRule{
			id:                   rule.ID,
			sourceInterface:      strings.ToLower(strings.TrimSpace(rule.SourceInterface)),
			sourceAddress:        sourceAddress,
			destinationInterface: strings.ToLower(strings.TrimSpace(rule.DestinationInterface)),
			destinationAddress:   destinationAddress,
			service:              strings.ToLower(strings.TrimSpace(rule.Service)),
			action:               rule.Action,
			enabled:              enabled,
			priority:             priority,
		})
	}
	sort.SliceStable(policy.accessRules, func(i, j int) bool {
		if policy.accessRules[i].priority == policy.accessRules[j].priority {
			return policy.accessRules[i].id < policy.accessRules[j].id
		}
		return policy.accessRules[i].priority > policy.accessRules[j].priority
	})

	for index, raw := range snapshot.Blocklists {
		var filter firewallFilterJSON
		if err := json.Unmarshal(raw, &filter); err != nil ||
			strings.TrimSpace(filter.Type) == "" || strings.TrimSpace(filter.Content) == "" {
			return nil, fmt.Errorf("firewall filter %d is invalid", index)
		}
		filter.Type = strings.ToLower(strings.TrimSpace(filter.Type))
		if filter.Type != "domain" && filter.Type != "keyword" {
			return nil, fmt.Errorf("firewall filter %d has an unknown type", index)
		}
		action := strings.ToLower(strings.TrimSpace(filter.Action))
		if action == "" {
			action = "block"
		}
		if action != "allow" && action != "block" {
			return nil, fmt.Errorf("firewall filter %d has an unknown action", index)
		}
		if filter.Type == "keyword" && action != "block" {
			return nil, fmt.Errorf("firewall keyword filter %d cannot allow", index)
		}
		active := true
		if filter.IsActive != nil {
			active = *filter.IsActive
		}
		policy.filters = append(policy.filters, firewallFilter{
			kind: filter.Type, content: strings.TrimSpace(filter.Content), action: action, active: active,
		})
	}
	return policy, nil
}

func isJSONArray(raw json.RawMessage) bool {
	value := strings.TrimSpace(string(raw))
	return strings.HasPrefix(value, "[") && strings.HasSuffix(value, "]")
}

// Allows reports whether a complete DNS query may be sent to its destination.
// Malformed policy is represented by failClosedFirewallPolicy and never allows.
func (p *FirewallPolicy) Allows(query []byte, sourceAddress, destinationAddress string) bool {
	if p == nil || !p.enabled {
		return true
	}
	if p.failClosed {
		return false
	}
	names, err := dnsQuestionNames(query)
	if err != nil {
		return false
	}
	if p.preventOverrides && !isSafeNetResolver(destinationAddress) {
		return false
	}
	for _, rule := range p.accessRules {
		if !rule.matches(sourceAddress, destinationAddress) {
			continue
		}
		return rule.action == "allow"
	}
	for _, name := range names {
		if p.matchesDomain(name, "allow") {
			return true
		}
	}
	for _, name := range names {
		if p.matchesDomain(name, "block") || p.matchesKeyword(name) {
			return false
		}
	}
	return true
}

// BlocksUninspectableDNS is deliberately fail-closed. Direct TCP/53 is not
// proxy-terminated, and fragmented queries cannot be inspected completely.
func (p *FirewallPolicy) BlocksUninspectableDNS() bool {
	return p == nil || p.enabled || p.failClosed
}

func isSafeNetResolver(address string) bool {
	host := strings.ToLower(strings.TrimSpace(address))
	return host == "10.248.0.1" || host == "fd00:534e:5348::1" ||
		host == "198.18.0.1" || host == "fd42:5341:4645::53"
}

func (r firewallAccessRule) matches(source, destination string) bool {
	if !r.enabled || (r.service != "dns" && r.service != "all") {
		return false
	}
	sourceInterfaceMatches := r.sourceInterface == "any" || r.sourceInterface == "lan"
	destinationInterfaceMatches := r.destinationInterface == "any" || r.destinationInterface == "wan"
	return sourceInterfaceMatches && destinationInterfaceMatches &&
		addressMatches(r.sourceAddress, source) && addressMatches(r.destinationAddress, destination)
}

func addressMatches(configured, actual string) bool {
	configured = strings.TrimSpace(configured)
	if configured == "" || strings.EqualFold(configured, "any") {
		return true
	}
	actualIP := net.ParseIP(strings.TrimSuffix(actual, zoneSuffix(actual)))
	if actualIP == nil {
		return false
	}
	if strings.Contains(configured, "/") {
		_, network, err := net.ParseCIDR(configured)
		return err == nil && network.Contains(actualIP)
	}
	configuredIP := net.ParseIP(configured)
	return configuredIP != nil && configuredIP.Equal(actualIP)
}

func zoneSuffix(address string) string {
	if index := strings.LastIndexByte(address, '%'); index >= 0 {
		return address[index:]
	}
	return ""
}

func (p *FirewallPolicy) matchesDomain(name, action string) bool {
	for _, filter := range p.filters {
		if !filter.active || filter.kind != "domain" || filter.action != action {
			continue
		}
		pattern := normalizeFirewallHost(filter.content)
		if pattern != "" && (name == pattern || strings.HasSuffix(name, "."+pattern)) {
			return true
		}
	}
	return false
}

func (p *FirewallPolicy) matchesKeyword(name string) bool {
	for _, filter := range p.filters {
		if filter.active && filter.kind == "keyword" &&
			strings.Contains(name, strings.ToLower(filter.content)) {
			return true
		}
	}
	return false
}

func normalizeFirewallHost(value string) string {
	host := strings.ToLower(strings.TrimSpace(value))
	if strings.Contains(host, "://") {
		parsed, err := url.Parse(host)
		if err != nil {
			return ""
		}
		host = parsed.Hostname()
	} else {
		host = strings.TrimPrefix(host, "//")
		if index := strings.IndexAny(host, "/?#"); index >= 0 {
			host = host[:index]
		}
	}
	host = strings.TrimPrefix(host, "*.")
	host = strings.TrimLeft(host, ".")
	host = strings.TrimRight(host, ".")
	if host == "" || strings.ContainsAny(host, " \t\r\n") {
		return ""
	}
	return host
}

func dnsQuestionNames(query []byte) ([]string, error) {
	if len(query) < 12 {
		return nil, errors.New("DNS header is incomplete")
	}
	count := int(query[4])<<8 | int(query[5])
	if count == 0 || count > 64 {
		return nil, errors.New("DNS question count is invalid")
	}
	offset := 12
	names := make([]string, 0, count)
	for range count {
		if offset >= len(query) {
			return nil, errors.New("DNS question name is incomplete")
		}
		var labels []string
		for {
			if offset >= len(query) {
				return nil, errors.New("DNS name is incomplete")
			}
			length := int(query[offset])
			offset++
			if length == 0 {
				break
			}
			if length&0xc0 != 0 || length > 63 || offset+length > len(query) {
				return nil, errors.New("compressed or invalid DNS name")
			}
			labels = append(labels, strings.ToLower(string(query[offset:offset+length])))
			offset += length
		}
		if offset+4 > len(query) {
			return nil, errors.New("DNS question is incomplete")
		}
		offset += 4
		names = append(names, strings.Join(labels, "."))
	}
	return names, nil
}
