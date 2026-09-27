package sdns

import (
	"encoding/binary"
	"testing"
)

const firewallTestSnapshot = `{"settings":{"firewallEnabled":true,"preventDnsOverrides":false},"rules":[],"blocklists":[{"type":"domain","content":"blocked.example","action":"block","isActive":true}]}`

func TestFirewallPolicyAllowsSafeQueriesAndBlocksDomainFilters(t *testing.T) {
	policy, err := parseFirewallPolicy(firewallTestSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	if !policy.Allows(dnsQueryForName("safe.example"), "10.0.0.2", "9.9.9.9") {
		t.Fatal("allowed DNS query was rejected")
	}
	if policy.Allows(dnsQueryForName("blocked.example"), "10.0.0.2", "9.9.9.9") {
		t.Fatal("blocked domain was allowed")
	}
}

func TestFirewallPolicyAppliesDNSAccessRulesBeforeDomainFilters(t *testing.T) {
	policy, err := parseFirewallPolicy(`{
		"settings":{"firewallEnabled":true,"preventDnsOverrides":false},
		"rules":[
			{"id":1,"sourceInterface":"lan","destinationInterface":"wan","service":"dns","action":"deny","priority":20},
			{"id":2,"sourceInterface":"any","destinationInterface":"any","service":"dns","action":"allow","priority":10}
		],
		"blocklists":[{"type":"domain","content":"safe.example","action":"allow"}]
	}`)
	if err != nil {
		t.Fatal(err)
	}
	if policy.Allows(dnsQueryForName("safe.example"), "10.0.0.2", "9.9.9.9") {
		t.Fatal("higher-priority DNS access deny rule was ignored")
	}
}

func TestFirewallPolicyPreventDnsOverridesRejectsExternalResolvers(t *testing.T) {
	policy, err := parseFirewallPolicy(`{"settings":{"firewallEnabled":true,"preventDnsOverrides":true},"rules":[],"blocklists":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	if policy.Allows(dnsQueryForName("safe.example"), "10.0.0.2", "8.8.8.8") {
		t.Fatal("external DNS override destination was allowed")
	}
	for _, resolver := range []string{"10.248.0.1", "fd00:534e:5348::1", "198.18.0.1", "fd42:5341:4645::53"} {
		if !policy.Allows(dnsQueryForName("safe.example"), "10.0.0.2", resolver) {
			t.Fatalf("SafeNet resolver %q was rejected", resolver)
		}
	}
}

func TestMalformedFirewallPolicyFailsClosed(t *testing.T) {
	interceptor, err := NewInterceptorWithFirewall(newFakeTunnel(), fakeExchange{}, `{"settings":`)
	if err != nil {
		t.Fatal(err)
	}
	defer interceptor.Close()
	if interceptor.firewall.Load().Allows(dnsQueryForName("safe.example"), "10.0.0.2", "198.18.0.1") {
		t.Fatal("malformed firewall snapshot did not fail closed")
	}
}

func TestExternalUDPPolicyBlocksBeforeTunnelAndAllowsPermittedQueries(t *testing.T) {
	f := newFakeTunnel()
	interceptor, err := NewInterceptorWithFirewall(f, fakeExchange{}, firewallTestSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer interceptor.Close()

	blocked := ipv4UDP(dnsQueryForName("blocked.example"))
	copy(blocked[16:20], []byte{9, 9, 9, 9})
	interceptor.handleOutboundPacket(blocked)
	if len(interceptor.out) != 0 {
		t.Fatal("blocked DNS query reached the WireGuard tunnel")
	}

	allowed := ipv4UDP(dnsQueryForName("safe.example"))
	copy(allowed[16:20], []byte{9, 9, 9, 9})
	interceptor.handleOutboundPacket(allowed)
	got := make([]byte, 1500)
	n, err := interceptor.Read(got, 0)
	if err != nil {
		t.Fatal(err)
	}
	if string(got[:n]) != string(allowed) {
		t.Fatal("allowed DNS query was not passed through unchanged")
	}
}

func TestExternalUDPPreventOverridesAndLivePolicyUpdate(t *testing.T) {
	f := newFakeTunnel()
	interceptor, err := NewInterceptorWithFirewall(f, fakeExchange{}, `{"settings":{"firewallEnabled":true,"preventDnsOverrides":true},"rules":[],"blocklists":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	defer interceptor.Close()

	packet := ipv4UDP(dnsQueryForName("safe.example"))
	copy(packet[16:20], []byte{8, 8, 4, 4})
	interceptor.handleOutboundPacket(packet)
	if len(interceptor.out) != 0 {
		t.Fatal("Prevent DNS Overrides allowed an external UDP resolver")
	}

	if err := interceptor.SetFirewallPolicy(firewallTestSnapshot); err != nil {
		t.Fatal(err)
	}
	copy(packet[16:20], []byte{9, 9, 9, 9})
	packet = ipv4UDP(dnsQueryForName("blocked.example"))
	copy(packet[16:20], []byte{9, 9, 9, 9})
	interceptor.handleOutboundPacket(packet)
	if len(interceptor.out) != 0 {
		t.Fatal("updated domain block was not applied to the active tunnel")
	}
}

func TestExternalTCPPort53FailsClosedWithFirewallEnabled(t *testing.T) {
	f := newFakeTunnel()
	interceptor, err := NewInterceptorWithFirewall(f, fakeExchange{}, firewallTestSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer interceptor.Close()

	packet := ipv4TCP53()
	interceptor.handleOutboundPacket(packet)
	if len(interceptor.out) != 0 {
		t.Fatal("uninspectable external TCP/53 traffic reached the tunnel")
	}
}

func TestExternalIPv6UDPUsesDNSFirewallPolicy(t *testing.T) {
	f := newFakeTunnel()
	interceptor, err := NewInterceptorWithFirewall(f, fakeExchange{}, firewallTestSnapshot)
	if err != nil {
		t.Fatal(err)
	}
	defer interceptor.Close()

	allowed := ipv6UDP(dnsQueryForName("safe.example"))
	interceptor.handleOutboundPacket(allowed)
	got := make([]byte, 1500)
	n, err := interceptor.Read(got, 0)
	if err != nil {
		t.Fatal(err)
	}
	if string(got[:n]) != string(allowed) {
		t.Fatal("allowed IPv6 DNS query was not passed through unchanged")
	}

	blocked := ipv6UDP(dnsQueryForName("blocked.example"))
	interceptor.handleOutboundPacket(blocked)
	if len(interceptor.out) != 0 {
		t.Fatal("blocked IPv6 DNS query reached the WireGuard tunnel")
	}

	override, err := NewInterceptorWithFirewall(newFakeTunnel(), fakeExchange{}, `{"settings":{"firewallEnabled":true,"preventDnsOverrides":true},"rules":[],"blocklists":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	defer override.Close()
	override.handleOutboundPacket(allowed)
	if len(override.out) != 0 {
		t.Fatal("Prevent DNS Overrides allowed an external IPv6 resolver")
	}
}

func dnsQueryForName(name string) []byte {
	labels := splitDNSLabels(name)
	length := 12 + len(name) + len(labels) + 1 + 4
	query := make([]byte, length)
	query[0], query[1] = 0x12, 0x34
	query[2], query[5] = 1, 1
	offset := 12
	for _, label := range labels {
		query[offset] = byte(len(label))
		offset++
		copy(query[offset:], label)
		offset += len(label)
	}
	query[offset] = 0
	offset++
	binary.BigEndian.PutUint16(query[offset:offset+2], 1)
	binary.BigEndian.PutUint16(query[offset+2:offset+4], 1)
	return query
}

func ipv6UDP(payload []byte) []byte {
	packet := make([]byte, 48+len(payload))
	packet[0], packet[6], packet[7] = 0x60, 17, 64
	binary.BigEndian.PutUint16(packet[4:6], uint16(8+len(payload)))
	copy(packet[8:24], []byte{0xfd, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2})
	copy(packet[24:40], []byte{0x20, 0x01, 0x48, 0x60, 0x48, 0x60, 0, 0, 0, 0, 0, 0, 0, 0, 0x88, 0x88})
	binary.BigEndian.PutUint16(packet[40:42], 45000)
	binary.BigEndian.PutUint16(packet[42:44], 53)
	binary.BigEndian.PutUint16(packet[44:46], uint16(8+len(payload)))
	copy(packet[48:], payload)
	return packet
}

func splitDNSLabels(name string) []string {
	var labels []string
	start := 0
	for index := 0; index <= len(name); index++ {
		if index == len(name) || name[index] == '.' {
			labels = append(labels, name[start:index])
			start = index + 1
		}
	}
	return labels
}

func ipv4TCP53() []byte {
	packet := make([]byte, 40)
	packet[0], packet[8], packet[9] = 0x45, 64, 6
	binary.BigEndian.PutUint16(packet[2:4], uint16(len(packet)))
	copy(packet[12:16], []byte{10, 0, 0, 2})
	copy(packet[16:20], []byte{8, 8, 8, 8})
	binary.BigEndian.PutUint16(packet[20:22], 45000)
	binary.BigEndian.PutUint16(packet[22:24], 53)
	packet[32] = 0x50
	packet[33] = 0x02
	return packet
}
