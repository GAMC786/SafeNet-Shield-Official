package sdns

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"testing"
	"time"

	"golang.zx2c4.com/wireguard/tun"
	"gvisor.dev/gvisor/pkg/buffer"
	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/header"
	"gvisor.dev/gvisor/pkg/tcpip/link/channel"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv4"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv6"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
	"gvisor.dev/gvisor/pkg/tcpip/transport/tcp"
	"gvisor.dev/gvisor/pkg/tcpip/transport/udp"
)

type fakeTunnel struct {
	in     chan []byte
	writes chan []byte
	closed chan struct{}
	events chan tun.Event
}

func (f *fakeTunnel) Read(b []byte, off int) (int, error) {
	select {
	case p := <-f.in:
		copy(b[off:], p)
		return len(p), nil
	case <-f.closed:
		return 0, io.EOF
	}
}
func (f *fakeTunnel) Write(p []byte, off int) (int, error) {
	cp := append([]byte(nil), p[off:]...)
	select {
	case f.writes <- cp:
		return len(cp), nil
	case <-f.closed:
		return 0, io.EOF
	}
}
func (*fakeTunnel) Flush() error               { return nil }
func (*fakeTunnel) MTU() (int, error)          { return 1500, nil }
func (*fakeTunnel) Name() (string, error)      { return "fake", nil }
func (f *fakeTunnel) Events() <-chan tun.Event { return f.events }
func (f *fakeTunnel) Close() error {
	select {
	case <-f.closed:
	default:
		close(f.closed)
	}
	return nil
}

type fakeExchange struct{}

func (fakeExchange) Exchange(_ context.Context, _ []byte) ([]byte, error) {
	return nil, errors.New("not expected for passthrough")
}

func TestIsDNSPacketRecognizesCleartextDNSAcrossResolvers(t *testing.T) {
	ip := make([]byte, 28)
	ip[0], ip[9] = 0x45, 17
	copy(ip[16:20], []byte{198, 18, 0, 1})
	binary.BigEndian.PutUint16(ip[22:24], 53)
	if !isDNSPacket(ip) {
		t.Fatal("virtual DNS packet was not recognized")
	}
	binary.BigEndian.PutUint16(ip[22:24], 5353)
	if isDNSPacket(ip) {
		t.Fatal("non-DNS destination port was intercepted")
	}
	binary.BigEndian.PutUint16(ip[22:24], 53)
	ip[9] = 1
	if isDNSPacket(ip) {
		t.Fatal("non-TCP/UDP traffic was intercepted")
	}
	ip = ipv4TCP53()
	if !isDNSPacket(ip) {
		t.Fatal("TCP DNS packet was not recognized")
	}
	binary.BigEndian.PutUint16(ip[22:24], 5353)
	if isDNSPacket(ip) {
		t.Fatal("TCP packet on a non-DNS port was intercepted")
	}
	binary.BigEndian.PutUint16(ip[22:24], 53)
	ip[19] = 2
	if !isDNSPacket(ip) {
		t.Fatal("DNS packet to a non-virtual resolver was not recognized")
	}
}

func TestIsDNSPacketIPv6RequiresPort53(t *testing.T) {
	packet := make([]byte, 48)
	packet[0], packet[6] = 0x60, 17
	binary.BigEndian.PutUint16(packet[4:6], 8)
	destination := virtual6.As16()
	copy(packet[24:40], destination[:])
	binary.BigEndian.PutUint16(packet[42:44], 53)
	if !isDNSPacket(packet) {
		t.Fatal("IPv6 DNS packet was not recognized")
	}
	binary.BigEndian.PutUint16(packet[42:44], 5353)
	if isDNSPacket(packet) {
		t.Fatal("IPv6 packet on a non-DNS port was intercepted")
	}
}

func TestInterceptorTracksDNSFragmentsWithoutCapturingOtherPorts(t *testing.T) {
	i := &Interceptor{fragments: make(map[string]fragmentDecision)}

	original := ipv4UDP(dnsQuery())
	binary.BigEndian.PutUint16(original[4:6], 0x1234)
	first, last := fragmentIPv4Packet(original, 16)
	if !i.interceptsDNSPacket(first) {
		t.Fatal("first DNS fragment was not intercepted")
	}
	if !i.interceptsDNSPacket(last) {
		t.Fatal("later DNS fragment was not intercepted")
	}
	if len(i.fragments) != 0 {
		t.Fatal("completed DNS fragment decision was retained")
	}

	otherPort := ipv4UDP(dnsQuery())
	binary.BigEndian.PutUint16(otherPort[4:6], 0x5678)
	binary.BigEndian.PutUint16(otherPort[22:24], 443)
	otherFirst, otherLast := fragmentIPv4Packet(otherPort, 16)
	if i.interceptsDNSPacket(otherFirst) {
		t.Fatal("first fragment for a non-DNS port was intercepted")
	}
	if i.interceptsDNSPacket(otherLast) {
		t.Fatal("later fragment for a non-DNS port was intercepted")
	}
}

func TestInterceptorPassesUnrelatedPacket(t *testing.T) {
	p := []byte{4, 1, 2, 3, 4}
	f := newFakeTunnel()
	i, err := NewInterceptor(f, fakeExchange{})
	if err != nil {
		t.Fatal(err)
	}
	defer i.Close()
	f.in <- p
	got := make([]byte, 64)
	n, err := i.Read(got, 0)
	if err != nil {
		t.Fatal(err)
	}
	if string(got[:n]) != string(p) {
		t.Fatalf("packet changed: %v", got[:n])
	}
}

type countingExchange struct{ seen chan []byte }

func (e countingExchange) Exchange(_ context.Context, q []byte) ([]byte, error) {
	e.seen <- append([]byte(nil), q...)
	return q, nil
}

func newFakeTunnel() *fakeTunnel {
	return &fakeTunnel{in: make(chan []byte, 8), writes: make(chan []byte, 8), closed: make(chan struct{}), events: make(chan tun.Event)}
}

func dnsQuery() []byte {
	return []byte{0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 7, 'e', 'x', 'a', 'm', 'p', 'l', 'e', 0, 0, 1, 0, 1}
}

func ipv4UDP(payload []byte) []byte {
	p := make([]byte, 20+8+len(payload))
	p[0], p[8], p[9] = 0x45, 64, 17
	binary.BigEndian.PutUint16(p[2:4], uint16(len(p)))
	copy(p[12:16], []byte{10, 0, 0, 2})
	copy(p[16:20], []byte{198, 18, 0, 1})
	binary.BigEndian.PutUint16(p[20:22], 40000)
	binary.BigEndian.PutUint16(p[22:24], 53)
	binary.BigEndian.PutUint16(p[24:26], uint16(8+len(payload)))
	copy(p[28:], payload)
	var sum uint32
	for j := 0; j < 20; j += 2 {
		sum += uint32(binary.BigEndian.Uint16(p[j : j+2]))
	}
	for sum>>16 != 0 {
		sum = (sum & 0xffff) + (sum >> 16)
	}
	binary.BigEndian.PutUint16(p[10:12], ^uint16(sum))
	return p
}

func fragmentIPv4Packet(packet []byte, firstPayloadLength int) ([]byte, []byte) {
	headerLength := int(packet[0]&0x0f) * 4
	first := append([]byte(nil), packet[:headerLength+firstPayloadLength]...)
	last := make([]byte, headerLength+len(packet)-headerLength-firstPayloadLength)
	copy(last[:headerLength], packet[:headerLength])
	copy(last[headerLength:], packet[headerLength+firstPayloadLength:])
	binary.BigEndian.PutUint16(first[2:4], uint16(len(first)))
	binary.BigEndian.PutUint16(last[2:4], uint16(len(last)))
	binary.BigEndian.PutUint16(first[6:8], 0x2000)
	binary.BigEndian.PutUint16(last[6:8], uint16(firstPayloadLength/8))
	return first, last
}

func TestInterceptorUDPExchangeWritesReplyToTunnel(t *testing.T) {
	f := newFakeTunnel()
	ex := countingExchange{seen: make(chan []byte, 1)}
	i, err := NewInterceptorWithFirewall(f, ex, `{"settings":{"firewallEnabled":true,"preventDnsOverrides":true},"rules":[],"blocklists":[{"type":"domain","content":"blocked.example","action":"block"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	defer i.Close()
	q := dnsQueryForName("safe.example")
	f.in <- ipv4UDP(q)
	select {
	case seen := <-ex.seen:
		if string(seen) != string(q) {
			t.Fatalf("exchanger saw wrong query")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("UDP query did not reach exchanger")
	}
	select {
	case reply := <-f.writes:
		if len(reply) <= len(q) || binary.BigEndian.Uint16(reply[22:24]) != 40000 {
			t.Fatalf("invalid synthesized UDP reply: %d bytes", len(reply))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("UDP reply was not written to underlying tunnel")
	}
}

func TestInterceptorCloseUnblocksRead(t *testing.T) {
	f := newFakeTunnel()
	i, err := NewInterceptor(f, fakeExchange{})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { _, _ = i.Read(make([]byte, 1500), 0); close(done) }()
	if err := i.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Read remained blocked after Close")
	}
}

func TestInterceptorTCPExchangeWithGVisorClient(t *testing.T) {
	f := newFakeTunnel()
	ex := countingExchange{seen: make(chan []byte, 1)}
	i, err := NewInterceptorWithFirewall(f, ex, `{"settings":{"firewallEnabled":true,"preventDnsOverrides":true},"rules":[],"blocklists":[{"type":"domain","content":"blocked.example","action":"block"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	defer i.Close()

	clientLink := channel.New(1024, 1500, "")
	client := stack.New(stack.Options{
		NetworkProtocols:   []stack.NetworkProtocolFactory{ipv4.NewProtocol, ipv6.NewProtocol},
		TransportProtocols: []stack.TransportProtocolFactory{tcp.NewProtocol, udp.NewProtocol},
	})
	if err := client.CreateNIC(1, clientLink); err != nil {
		t.Fatal(err)
	}
	if err := client.AddProtocolAddress(1, tcpip.ProtocolAddress{
		Protocol: header.IPv4ProtocolNumber,
		AddressWithPrefix: tcpip.AddressWithPrefix{
			Address: tcpip.AddrFrom4([4]byte{10, 0, 0, 2}), PrefixLen: 32,
		},
	}, stack.AddressProperties{}); err != nil {
		t.Fatal(err)
	}
	client.AddRoute(tcpip.Route{
		Destination: (tcpip.AddressWithPrefix{Address: tcpip.AddrFrom4([4]byte{}), PrefixLen: 0}).Subnet(),
		NIC:         1,
	})
	defer client.Destroy()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	bridgeDone := make(chan struct{})
	go func() {
		defer close(bridgeDone)
		for {
			p := clientLink.ReadContext(ctx)
			if p == nil {
				return
			}
			f.in <- append([]byte(nil), p.ToView().AsSlice()...)
			p.DecRef()
		}
	}()
	go func() {
		for {
			select {
			case p := <-f.writes:
				pk := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(p)})
				clientLink.InjectInbound(header.IPv4ProtocolNumber, pk)
				pk.DecRef()
			case <-ctx.Done():
				return
			}
		}
	}()

	conn, err := gonet.DialContextTCP(ctx, client, tcpip.FullAddress{
		NIC: 1, Addr: virtual4, Port: 53,
	}, header.IPv4ProtocolNumber)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	q := dnsQueryForName("safe.example")
	var frame [2]byte
	binary.BigEndian.PutUint16(frame[:], uint16(len(q)))
	if _, err := conn.Write(append(frame[:], q...)); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(conn, frame[:]); err != nil {
		t.Fatal(err)
	}
	reply := make([]byte, binary.BigEndian.Uint16(frame[:]))
	if _, err := io.ReadFull(conn, reply); err != nil {
		t.Fatal(err)
	}
	select {
	case seen := <-ex.seen:
		if string(seen) != string(q) {
			t.Fatalf("exchanger saw wrong TCP query")
		}
	case <-ctx.Done():
		t.Fatal("TCP query did not reach exchanger")
	}
	if string(reply) != string(q) {
		t.Fatalf("unexpected TCP DNS response")
	}

	blockedQuery := dnsQueryForName("blocked.example")
	binary.BigEndian.PutUint16(frame[:], uint16(len(blockedQuery)))
	if _, err := conn.Write(append(frame[:], blockedQuery...)); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(conn, frame[:]); err != nil {
		t.Fatal(err)
	}
	blockedReply := make([]byte, binary.BigEndian.Uint16(frame[:]))
	if _, err := io.ReadFull(conn, blockedReply); err != nil {
		t.Fatal(err)
	}
	if len(blockedReply) < 4 || binary.BigEndian.Uint16(blockedReply[2:4])&0x000f != 5 {
		t.Fatalf("blocked TCP DNS query did not receive REFUSED: %x", blockedReply)
	}
	select {
	case <-ex.seen:
		t.Fatal("blocked TCP DNS query reached the upstream exchanger")
	case <-time.After(100 * time.Millisecond):
	}
	<-bridgeDone
}
