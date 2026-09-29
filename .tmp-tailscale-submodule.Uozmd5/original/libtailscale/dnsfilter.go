// Copyright (c) Tailscale Inc & AUTHORS
// SPDX-License-Identifier: BSD-3-Clause

package libtailscale

import (
	"encoding/binary"
	"log"
	"net/netip"

	"github.com/tailscale/wireguard-go/tun"
)

const (
	ipProtocolTCP = 6
	ipProtocolUDP = 17
	dnsPort       = 53
)

type dnsPacketInfo struct {
	source          netip.Addr
	destination     netip.Addr
	sourcePort      uint16
	destinationPort uint16
	query           []byte
	isTCP           bool
	fragmented      bool
	ipVersion       int
}

// filterTailscalePackets applies DNS and non-DNS firewall policy at the TUN
// packet boundary, returning REFUSED replies for blocked, unfragmented UDP queries.
func (d *multiTUN) filterTailscalePackets(dev *tunDevice, slab []byte, packets []tun.ReadPacket, count int) int {
	if count <= 0 {
		return 0
	}
	if count > len(packets) {
		count = len(packets)
	}
	if d.appCtx == nil {
		return count
	}
	kept := 0
	for index := 0; index < count; index++ {
		packet := packets[index]
		if packet.Offset < 0 || packet.Size < 0 ||
			packet.Offset > len(slab) || packet.Size > len(slab)-packet.Offset {
			if d.appCtx.ShouldBlockNonDNSPacket() {
				continue
			}
			packets[kept] = packet
			kept++
			continue
		}
		raw := slab[packet.Offset : packet.Offset+packet.Size]
		info, ok := parseDNSPacket(raw)
		if !ok {
			if d.appCtx.ShouldBlockNonDNSPacket() {
				continue
			}
			packets[kept] = packet
			kept++
			continue
		}

		block := d.appCtx.ShouldBlockDNSPacket(
			info.query,
			info.source.String(),
			info.destination.String(),
			info.isTCP,
			d.isConfiguredDNSServer(info.destination),
			info.fragmented,
		)
		if !block {
			packets[kept] = packet
			kept++
			continue
		}

		if !info.isTCP && !info.fragmented {
			response := d.appCtx.BlockedDNSResponse(info.query)
			if replyPacket := buildDNSReplyPacket(info, response); len(replyPacket) > 0 {
				if err := d.injectPacket(dev, replyPacket); err != nil {
					log.Printf("Tailscale DNS firewall blocked a query but could not inject its REFUSED response: %v", err)
				}
			}
		}
	}
	return kept
}

func parseDNSPacket(packet []byte) (dnsPacketInfo, bool) {
	if len(packet) == 0 {
		return dnsPacketInfo{}, false
	}
	switch packet[0] >> 4 {
	case 4:
		return parseIPv4DNSPacket(packet)
	case 6:
		return parseIPv6DNSPacket(packet)
	default:
		return dnsPacketInfo{}, false
	}
}

func parseIPv4DNSPacket(packet []byte) (dnsPacketInfo, bool) {
	if len(packet) < 20 {
		return dnsPacketInfo{}, false
	}
	headerLen := int(packet[0]&0x0f) * 4
	totalLen := int(binary.BigEndian.Uint16(packet[2:4]))
	if headerLen < 20 || headerLen > len(packet) || totalLen < headerLen || totalLen > len(packet) {
		return dnsPacketInfo{}, false
	}
	protocol := packet[9]
	if protocol != ipProtocolUDP && protocol != ipProtocolTCP {
		return dnsPacketInfo{}, false
	}
	fragmentField := binary.BigEndian.Uint16(packet[6:8])
	fragmentOffset := fragmentField & 0x1fff
	if fragmentOffset != 0 {
		// Non-initial fragments have no transport ports. If an initial DNS
		// fragment is blocked, the remaining fragments cannot form a query.
		return dnsPacketInfo{}, false
	}
	sourceBytes := [4]byte{packet[12], packet[13], packet[14], packet[15]}
	destinationBytes := [4]byte{packet[16], packet[17], packet[18], packet[19]}
	source := netip.AddrFrom4(sourceBytes)
	destination := netip.AddrFrom4(destinationBytes)
	fragmented := fragmentField&0x2000 != 0
	if fragmented && totalLen-headerLen < 4 {
		// A first fragment too short to expose the transport ports could
		// otherwise be reassembled into a DNS packet after this filter passes it.
		return dnsPacketInfo{
			source:      source,
			destination: destination,
			fragmented:  true,
			ipVersion:   4,
		}, true
	}
	return parseTransportPacket(
		packet[:totalLen],
		headerLen,
		protocol,
		source,
		destination,
		fragmented,
		4,
	)
}

func parseIPv6DNSPacket(packet []byte) (dnsPacketInfo, bool) {
	if len(packet) < 40 {
		return dnsPacketInfo{}, false
	}
	payloadLen := int(binary.BigEndian.Uint16(packet[4:6]))
	if payloadLen == 0 || payloadLen > len(packet)-40 {
		// Jumbograms are not used by Android's DNS resolver and cannot be
		// safely inspected by this bounded packet parser.
		return dnsPacketInfo{}, false
	}
	packet = packet[:40+payloadLen]
	var sourceBytes, destinationBytes [16]byte
	copy(sourceBytes[:], packet[8:24])
	copy(destinationBytes[:], packet[24:40])
	source := netip.AddrFrom16(sourceBytes)
	destination := netip.AddrFrom16(destinationBytes)

	nextHeader := packet[6]
	offset := 40
	fragmented := false
	for extensionCount := 0; extensionCount < 8; extensionCount++ {
		switch nextHeader {
		case 0, 43, 60, 135, 139, 140: // Hop-by-hop, routing, destination, mobility, HIP, Shim6.
			if offset+2 > len(packet) {
				return dnsPacketInfo{}, false
			}
			length := (int(packet[offset+1]) + 1) * 8
			if length < 8 || offset+length > len(packet) {
				return dnsPacketInfo{}, false
			}
			nextHeader = packet[offset]
			offset += length
		case 44: // Fragment.
			if offset+8 > len(packet) {
				return dnsPacketInfo{}, false
			}
			fragmentField := binary.BigEndian.Uint16(packet[offset+2 : offset+4])
			if fragmentField&0xfff8 != 0 {
				// Non-initial fragments do not carry transport ports.
				return dnsPacketInfo{}, false
			}
			fragmented = fragmentField&1 != 0
			nextHeader = packet[offset]
			offset += 8
		case 51: // Authentication header.
			if offset+2 > len(packet) {
				return dnsPacketInfo{}, false
			}
			length := (int(packet[offset+1]) + 2) * 4
			if length < 8 || offset+length > len(packet) {
				return dnsPacketInfo{}, false
			}
			nextHeader = packet[offset]
			offset += length
		default:
			if fragmented &&
				(nextHeader == ipProtocolUDP || nextHeader == ipProtocolTCP) &&
				offset+4 > len(packet) {
				// Do not pass a truncated first fragment whose ports could be
				// completed into a DNS destination after IP reassembly.
				return dnsPacketInfo{
					source:      source,
					destination: destination,
					fragmented:  true,
					ipVersion:   6,
				}, true
			}
			return parseTransportPacket(packet, offset, nextHeader, source, destination, fragmented, 6)
		}
	}
	return dnsPacketInfo{}, false
}

func parseTransportPacket(
	packet []byte,
	offset int,
	protocol byte,
	source, destination netip.Addr,
	fragmented bool,
	ipVersion int,
) (dnsPacketInfo, bool) {
	if protocol != ipProtocolUDP && protocol != ipProtocolTCP {
		return dnsPacketInfo{}, false
	}
	if offset < 0 || offset+4 > len(packet) {
		return dnsPacketInfo{}, false
	}
	sourcePort := binary.BigEndian.Uint16(packet[offset : offset+2])
	destinationPort := binary.BigEndian.Uint16(packet[offset+2 : offset+4])
	if destinationPort != dnsPort {
		return dnsPacketInfo{}, false
	}
	info := dnsPacketInfo{
		source:          source,
		destination:     destination,
		sourcePort:      sourcePort,
		destinationPort: destinationPort,
		isTCP:           protocol == ipProtocolTCP,
		fragmented:      fragmented,
		ipVersion:       ipVersion,
	}
	if info.isTCP {
		return info, true
	}
	if offset+8 > len(packet) {
		return info, true
	}
	udpLength := int(binary.BigEndian.Uint16(packet[offset+4 : offset+6]))
	if udpLength < 8 || (!fragmented && udpLength > len(packet)-offset) {
		return info, true
	}
	payloadEnd := len(packet)
	if !fragmented {
		payloadEnd = offset + udpLength
	}
	info.query = packet[offset+8 : payloadEnd]
	if len(info.query) >= 4 && info.query[2]&0x80 != 0 {
		// This is a DNS response, not a query.
		return dnsPacketInfo{}, false
	}
	return info, true
}

func buildDNSReplyPacket(info dnsPacketInfo, dnsResponse []byte) []byte {
	if info.isTCP || info.fragmented || len(dnsResponse) == 0 {
		return nil
	}
	udpLen := 8 + len(dnsResponse)
	packet := make([]byte, 0)
	var source, destination []byte
	switch info.ipVersion {
	case 4:
		if !info.source.Is4() || !info.destination.Is4() || 20+udpLen > 0xffff {
			return nil
		}
		packet = make([]byte, 20+udpLen)
		packet[0] = 0x45
		binary.BigEndian.PutUint16(packet[2:4], uint16(len(packet)))
		packet[8] = 64
		packet[9] = ipProtocolUDP
		sourceAddr := info.destination.As4()
		destinationAddr := info.source.As4()
		copy(packet[12:16], sourceAddr[:])
		copy(packet[16:20], destinationAddr[:])
		source, destination = packet[12:16], packet[16:20]
	case 6:
		if !info.source.Is6() || !info.destination.Is6() || udpLen > 0xffff {
			return nil
		}
		packet = make([]byte, 40+udpLen)
		packet[0] = 0x60
		binary.BigEndian.PutUint16(packet[4:6], uint16(udpLen))
		packet[6] = ipProtocolUDP
		packet[7] = 64
		sourceAddr := info.destination.As16()
		destinationAddr := info.source.As16()
		copy(packet[8:24], sourceAddr[:])
		copy(packet[24:40], destinationAddr[:])
		source, destination = packet[8:24], packet[24:40]
	default:
		return nil
	}
	udpOffset := len(packet) - udpLen
	binary.BigEndian.PutUint16(packet[udpOffset:udpOffset+2], info.destinationPort)
	binary.BigEndian.PutUint16(packet[udpOffset+2:udpOffset+4], info.sourcePort)
	binary.BigEndian.PutUint16(packet[udpOffset+4:udpOffset+6], uint16(udpLen))
	copy(packet[udpOffset+8:], dnsResponse)
	udp := packet[udpOffset:]
	if info.ipVersion == 4 {
		binary.BigEndian.PutUint16(udp[6:8], udpChecksumIPv4(source, destination, udp))
		binary.BigEndian.PutUint16(packet[10:12], checksum(packet[:20]))
	} else {
		binary.BigEndian.PutUint16(udp[6:8], udpChecksumIPv6(source, destination, udp))
	}
	return packet
}

func checksum(data []byte) uint16 {
	var sum uint32
	for len(data) >= 2 {
		sum += uint32(binary.BigEndian.Uint16(data[:2]))
		data = data[2:]
	}
	if len(data) == 1 {
		sum += uint32(data[0]) << 8
	}
	for sum>>16 != 0 {
		sum = (sum & 0xffff) + (sum >> 16)
	}
	return ^uint16(sum)
}

func udpChecksumIPv4(source, destination, udp []byte) uint16 {
	pseudo := make([]byte, 12+len(udp))
	copy(pseudo[0:4], source)
	copy(pseudo[4:8], destination)
	pseudo[9] = ipProtocolUDP
	binary.BigEndian.PutUint16(pseudo[10:12], uint16(len(udp)))
	copy(pseudo[12:], udp)
	value := checksum(pseudo)
	if value == 0 {
		return 0xffff
	}
	return value
}

func udpChecksumIPv6(source, destination, udp []byte) uint16 {
	pseudo := make([]byte, 40+len(udp))
	copy(pseudo[0:16], source)
	copy(pseudo[16:32], destination)
	binary.BigEndian.PutUint32(pseudo[32:36], uint32(len(udp)))
	pseudo[39] = ipProtocolUDP
	copy(pseudo[40:], udp)
	value := checksum(pseudo)
	if value == 0 {
		return 0xffff
	}
	return value
}
