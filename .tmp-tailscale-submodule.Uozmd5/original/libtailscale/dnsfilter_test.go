// Copyright (c) Tailscale Inc & AUTHORS
// SPDX-License-Identifier: BSD-3-Clause

package libtailscale

import (
	"encoding/binary"
	"net/netip"
	"testing"

	"github.com/tailscale/wireguard-go/tun"
)

func TestParseIPv4AndIPv6DNSQueries(t *testing.T) {
	query := testDNSQuery("blocked.example")
	tests := []struct {
		name   string
		packet []byte
		src    netip.Addr
		dst    netip.Addr
	}{
		{
			name:   "IPv4",
			packet: testIPv4DNSPacket(query, false, false, ipProtocolUDP),
			src:    netip.MustParseAddr("10.0.0.2"),
			dst:    netip.MustParseAddr("100.100.100.100"),
		},
		{
			name:   "IPv6",
			packet: testIPv6DNSPacket(query, false, false),
			src:    netip.MustParseAddr("2001:db8::2"),
			dst:    netip.MustParseAddr("fd00::53"),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := parseDNSPacket(tt.packet)
			if !ok {
				t.Fatal("parseDNSPacket did not recognize DNS query")
			}
			if got.source != tt.src || got.destination != tt.dst {
				t.Fatalf("addresses = %s -> %s, want %s -> %s", got.source, got.destination, tt.src, tt.dst)
			}
			if got.sourcePort != 53000 || got.destinationPort != dnsPort {
				t.Fatalf("ports = %d -> %d, want 53000 -> 53", got.sourcePort, got.destinationPort)
			}
			if got.isTCP || got.fragmented {
				t.Fatalf("unexpected query flags: tcp=%v fragmented=%v", got.isTCP, got.fragmented)
			}
			if string(got.query) != string(query) {
				t.Fatalf("query = %x, want %x", got.query, query)
			}
		})
	}
}

func TestParseTCPAndFragmentedDNS(t *testing.T) {
	query := testDNSQuery("blocked.example")
	tcp := testIPv4DNSPacket(nil, false, false, ipProtocolTCP)
	tcpInfo, ok := parseDNSPacket(tcp)
	if !ok || !tcpInfo.isTCP {
		t.Fatal("TCP DNS packet was not recognized")
	}

	fragment := testIPv4DNSPacket(query, true, false, ipProtocolUDP)
	fragmentInfo, ok := parseDNSPacket(fragment)
	if !ok || !fragmentInfo.fragmented {
		t.Fatal("first DNS fragment was not recognized")
	}
	if buildDNSReplyPacket(fragmentInfo, testRefusedResponse()) != nil {
		t.Fatal("fragmented DNS query must not receive a synthetic UDP reply")
	}

	shortFirstFragment := testIPv4ShortFirstFragment()
	shortInfo, ok := parseDNSPacket(shortFirstFragment)
	if !ok || !shortInfo.fragmented {
		t.Fatal("truncated first fragment could hide destination port 53")
	}

	nonInitial := testIPv4NonInitialFragment()
	if _, ok := parseDNSPacket(nonInitial); ok {
		t.Fatal("non-initial fragment unexpectedly exposed DNS transport ports")
	}
}

func TestBlockedUDPQueryGetsValidReversedDNSRefusedPacket(t *testing.T) {
	query := testDNSQuery("blocked.example")
	info, ok := parseDNSPacket(testIPv4DNSPacket(query, false, false, ipProtocolUDP))
	if !ok {
		t.Fatal("parseDNSPacket did not recognize DNS query")
	}
	response := testRefusedResponse()
	if binary.BigEndian.Uint16(response[2:4])&0x000f != 5 {
		t.Fatalf("DNS response code = %d, want REFUSED (5)", binary.BigEndian.Uint16(response[2:4])&0x000f)
	}
	packet := buildDNSReplyPacket(info, response)
	if len(packet) == 0 {
		t.Fatal("buildDNSReplyPacket returned no packet")
	}
	replySource := netip.AddrFrom4([4]byte{packet[12], packet[13], packet[14], packet[15]})
	replyDestination := netip.AddrFrom4([4]byte{packet[16], packet[17], packet[18], packet[19]})
	if replySource != info.destination || replyDestination != info.source {
		t.Fatalf("reply addresses = %s -> %s, want %s -> %s", replySource, replyDestination, info.destination, info.source)
	}
	if gotSourcePort := binary.BigEndian.Uint16(packet[20:22]); gotSourcePort != dnsPort {
		t.Fatalf("reply source port = %d, want 53", gotSourcePort)
	}
	if gotDestinationPort := binary.BigEndian.Uint16(packet[22:24]); gotDestinationPort != info.sourcePort {
		t.Fatalf("reply destination port = %d, want %d", gotDestinationPort, info.sourcePort)
	}
	if checksum(packet[:20]) != 0 {
		t.Fatal("IPv4 header checksum is invalid")
	}
	if checksumIPv4UDP(packet[12:16], packet[16:20], packet[20:]) != 0 {
		t.Fatal("UDP checksum is invalid")
	}
}

func TestBlockedIPv6QueryGetsValidUDPReply(t *testing.T) {
	query := testDNSQuery("blocked.example")
	info, ok := parseDNSPacket(testIPv6DNSPacket(query, false, false))
	if !ok {
		t.Fatal("parseDNSPacket did not recognize IPv6 DNS query")
	}
	packet := buildDNSReplyPacket(info, testRefusedResponse())
	if len(packet) == 0 {
		t.Fatal("buildDNSReplyPacket returned no packet")
	}
	if packet[0]>>4 != 6 {
		t.Fatalf("reply IP version = %d, want 6", packet[0]>>4)
	}
	if checksumIPv6UDP(packet[8:24], packet[24:40], packet[40:]) != 0 {
		t.Fatal("IPv6 UDP checksum is invalid")
	}
}

func TestDNSResponsesAreNotTreatedAsQueries(t *testing.T) {
	response := testDNSQuery("safe.example")
	response[2] |= 0x80
	if _, ok := parseDNSPacket(testIPv4DNSPacket(response, false, false, ipProtocolUDP)); ok {
		t.Fatal("DNS response was recognized as an outbound query")
	}
}

func TestTUNFirewallKeepsDNSSeparateFromNonDNSPolicy(t *testing.T) {
	query := testDNSQuery("safe.example")
	tests := []struct {
		name            string
		packet          []byte
		blockDNS        bool
		blockNonDNS     bool
		wantPacketsKept int
	}{
		{
			name:            "non-DNS passes when disabled",
			packet:          testIPv4NonDNSPacket(),
			wantPacketsKept: 1,
		},
		{
			name:            "non-DNS is dropped when enabled",
			packet:          testIPv4NonDNSPacket(),
			blockNonDNS:     true,
			wantPacketsKept: 0,
		},
		{
			name:            "DNS is not blocked by non-DNS policy",
			packet:          testIPv4DNSPacket(query, false, false, ipProtocolUDP),
			blockNonDNS:     true,
			wantPacketsKept: 1,
		},
		{
			name:            "DNS policy still blocks port 53",
			packet:          testIPv4DNSPacket(query, false, false, ipProtocolUDP),
			blockDNS:        true,
			wantPacketsKept: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			appCtx := dnsFilterPolicyStub{blockDNS: tt.blockDNS, blockNonDNS: tt.blockNonDNS}
			device := &multiTUN{appCtx: appCtx}
			slab := append([]byte(nil), tt.packet...)
			packets := []tun.ReadPacket{{Offset: 0, Size: len(slab)}}
			got := device.filterTailscalePackets(&tunDevice{}, slab, packets, len(packets))
			if got != tt.wantPacketsKept {
				t.Fatalf("kept packets = %d, want %d", got, tt.wantPacketsKept)
			}
		})
	}
}

type dnsFilterPolicyStub struct {
	blockDNS    bool
	blockNonDNS bool
}

func (s dnsFilterPolicyStub) ShouldBlockDNSPacket([]byte, string, string, bool, bool, bool) bool {
	return s.blockDNS
}

func (dnsFilterPolicyStub) BlockedDNSResponse([]byte) []byte {
	return testRefusedResponse()
}

func (s dnsFilterPolicyStub) ShouldBlockNonDNSPacket() bool {
	return s.blockNonDNS
}

func testRefusedResponse() []byte {
	response := make([]byte, 12)
	binary.BigEndian.PutUint16(response[:2], 0x534e)
	binary.BigEndian.PutUint16(response[2:4], 0x8005)
	return response
}

func testDNSQuery(name string) []byte {
	query := make([]byte, 12)
	binary.BigEndian.PutUint16(query[:2], 0x534e)
	binary.BigEndian.PutUint16(query[2:4], 0x0100)
	binary.BigEndian.PutUint16(query[4:6], 1)
	for _, label := range splitDNSLabels(name) {
		query = append(query, byte(len(label)))
		query = append(query, label...)
	}
	query = append(query, 0, 0, 1, 0, 1)
	return query
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

func testIPv4DNSPacket(query []byte, fragmented, response bool, protocol byte) []byte {
	transportLen := 8 + len(query)
	if protocol == ipProtocolTCP {
		transportLen = 20
	}
	packet := make([]byte, 20+transportLen)
	packet[0] = 0x45
	binary.BigEndian.PutUint16(packet[2:4], uint16(len(packet)))
	if fragmented {
		binary.BigEndian.PutUint16(packet[6:8], 0x2000)
	}
	packet[8] = 64
	packet[9] = protocol
	copy(packet[12:16], netip.MustParseAddr("10.0.0.2").AsSlice())
	copy(packet[16:20], netip.MustParseAddr("100.100.100.100").AsSlice())
	if protocol == ipProtocolTCP {
		binary.BigEndian.PutUint16(packet[20:22], 53000)
		binary.BigEndian.PutUint16(packet[22:24], dnsPort)
		packet[32] = 0x50
		packet[33] = 0x02 // SYN
		return packet
	}
	binary.BigEndian.PutUint16(packet[20:22], 53000)
	binary.BigEndian.PutUint16(packet[22:24], dnsPort)
	binary.BigEndian.PutUint16(packet[24:26], uint16(8+len(query)))
	if len(query) > 0 {
		copy(packet[28:], query)
	}
	if response && len(query) >= 4 {
		packet[30] |= 0x80
	}
	return packet
}

func testIPv6DNSPacket(query []byte, fragmented, response bool) []byte {
	extLen := 0
	if fragmented {
		extLen = 8
	}
	packet := make([]byte, 40+extLen+8+len(query))
	packet[0] = 0x60
	binary.BigEndian.PutUint16(packet[4:6], uint16(len(packet)-40))
	if fragmented {
		packet[6] = 44
		packet[40] = ipProtocolUDP
		packet[41] = 0
		packet[42] = 0
		packet[43] = 1
	} else {
		packet[6] = ipProtocolUDP
	}
	packet[7] = 64
	copy(packet[8:24], netip.MustParseAddr("2001:db8::2").AsSlice())
	copy(packet[24:40], netip.MustParseAddr("fd00::53").AsSlice())
	udpOffset := 40 + extLen
	binary.BigEndian.PutUint16(packet[udpOffset:udpOffset+2], 53000)
	binary.BigEndian.PutUint16(packet[udpOffset+2:udpOffset+4], dnsPort)
	binary.BigEndian.PutUint16(packet[udpOffset+4:udpOffset+6], uint16(8+len(query)))
	copy(packet[udpOffset+8:], query)
	if response && len(query) >= 4 {
		packet[udpOffset+10] |= 0x80
	}
	return packet
}

func testIPv4NonInitialFragment() []byte {
	packet := make([]byte, 28)
	packet[0] = 0x45
	binary.BigEndian.PutUint16(packet[2:4], uint16(len(packet)))
	binary.BigEndian.PutUint16(packet[6:8], 1)
	packet[9] = ipProtocolUDP
	copy(packet[12:16], netip.MustParseAddr("10.0.0.2").AsSlice())
	copy(packet[16:20], netip.MustParseAddr("100.100.100.100").AsSlice())
	return packet
}

func testIPv4NonDNSPacket() []byte {
	packet := make([]byte, 28)
	packet[0] = 0x45
	binary.BigEndian.PutUint16(packet[2:4], uint16(len(packet)))
	packet[8] = 64
	packet[9] = ipProtocolUDP
	copy(packet[12:16], netip.MustParseAddr("10.0.0.2").AsSlice())
	copy(packet[16:20], netip.MustParseAddr("100.100.100.100").AsSlice())
	binary.BigEndian.PutUint16(packet[20:22], 53000)
	binary.BigEndian.PutUint16(packet[22:24], 443)
	binary.BigEndian.PutUint16(packet[24:26], 8)
	return packet
}

func testIPv4ShortFirstFragment() []byte {
	packet := make([]byte, 22)
	packet[0] = 0x45
	binary.BigEndian.PutUint16(packet[2:4], uint16(len(packet)))
	binary.BigEndian.PutUint16(packet[6:8], 0x2000)
	packet[9] = ipProtocolUDP
	copy(packet[12:16], netip.MustParseAddr("10.0.0.2").AsSlice())
	copy(packet[16:20], netip.MustParseAddr("100.100.100.100").AsSlice())
	return packet
}

func checksumIPv4UDP(source, destination, udp []byte) uint16 {
	pseudo := make([]byte, 12+len(udp))
	copy(pseudo[:4], source)
	copy(pseudo[4:8], destination)
	pseudo[9] = ipProtocolUDP
	binary.BigEndian.PutUint16(pseudo[10:12], uint16(len(udp)))
	copy(pseudo[12:], udp)
	return checksum(pseudo)
}

func checksumIPv6UDP(source, destination, udp []byte) uint16 {
	pseudo := make([]byte, 40+len(udp))
	copy(pseudo[:16], source)
	copy(pseudo[16:32], destination)
	binary.BigEndian.PutUint32(pseudo[32:36], uint32(len(udp)))
	pseudo[39] = ipProtocolUDP
	copy(pseudo[40:], udp)
	return checksum(pseudo)
}
