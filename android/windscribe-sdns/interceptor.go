package sdns

// This file is deliberately independent of the WireGuard package.  A small
// adapter in libwg-go can wrap its tun.Device with NewInterceptor.

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
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

// TunnelDevice is the subset of tun.Device needed by the interceptor.
type TunnelDevice interface {
	Read([]byte, int) (int, error)
	Write([]byte, int) (int, error)
	Flush() error
	MTU() (int, error)
	Name() (string, error)
	Events() <-chan tun.Event
	Close() error
}

// Exchanger resolves one complete DNS wire message.
type Exchanger interface {
	Exchange(context.Context, []byte) ([]byte, error)
}

var ErrInterceptorClosed = errors.New("SDNS interceptor is closed")

var (
	virtual4 = tcpip.AddrFrom4([4]byte{198, 18, 0, 1})
	virtual6 = tcpip.AddrFrom16([16]byte{0xfd, 0x42, 0x53, 0x41, 0x46, 0x45, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x53})
)

// Interceptor is a tun.Device-compatible DNS endpoint. It feeds packets to a
// gVisor IP stack, which owns UDP and TCP framing/checksums/reassembly. Only
// packets addressed to the two virtual resolver addresses and port 53 are
// consumed; every other packet is returned byte-for-byte by Read.
type Interceptor struct {
	under     TunnelDevice
	ex        Exchanger
	link      *channel.Endpoint
	stack     *stack.Stack
	out       chan []byte
	done      chan struct{}
	once      sync.Once
	wg        sync.WaitGroup
	ctx       context.Context
	cancel    context.CancelFunc
	fragments map[string]fragmentDecision
}

type fragmentDecision struct {
	isDNS   bool
	expires time.Time
}

type packetDNSInfo struct {
	isDNS      bool
	fragmented bool
	first      bool
	more       bool
	key        string
}

const (
	maxTrackedFragments = 256
	fragmentDecisionTTL = 15 * time.Second
)

func NewInterceptor(under TunnelDevice, ex Exchanger) (*Interceptor, error) {
	if under == nil || ex == nil {
		return nil, errors.New("SDNS interceptor requires a tunnel and exchanger")
	}
	mtu, err := under.MTU()
	if err != nil || mtu <= 0 {
		mtu = 1500
	}
	link := channel.New(1024, uint32(mtu), "")
	s := stack.New(stack.Options{
		NetworkProtocols:   []stack.NetworkProtocolFactory{ipv4.NewProtocol, ipv6.NewProtocol},
		TransportProtocols: []stack.TransportProtocolFactory{tcp.NewProtocol, udp.NewProtocol},
	})
	if err := s.CreateNIC(1, link); err != nil {
		return nil, errors.New(err.String())
	}
	s.AddRoute(tcpip.Route{
		Destination: (tcpip.AddressWithPrefix{Address: tcpip.AddrFrom4([4]byte{}), PrefixLen: 0}).Subnet(),
		NIC:         1,
	})
	s.AddRoute(tcpip.Route{
		Destination: (tcpip.AddressWithPrefix{Address: tcpip.AddrFrom16([16]byte{}), PrefixLen: 0}).Subnet(),
		NIC:         1,
	})
	for _, a := range []struct {
		proto tcpip.NetworkProtocolNumber
		addr  tcpip.Address
	}{
		{header.IPv4ProtocolNumber, virtual4},
		{header.IPv6ProtocolNumber, virtual6},
	} {
		prefix := 128
		if a.proto == header.IPv4ProtocolNumber {
			prefix = 32
		}
		if err := s.AddProtocolAddress(1, tcpip.ProtocolAddress{
			Protocol: a.proto, AddressWithPrefix: tcpip.AddressWithPrefix{Address: a.addr, PrefixLen: prefix},
		}, stack.AddressProperties{}); err != nil {
			return nil, errors.New(err.String())
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	i := &Interceptor{
		under: under, ex: ex, link: link, stack: s, out: make(chan []byte, 1024),
		done: make(chan struct{}), ctx: ctx, cancel: cancel,
		fragments: make(map[string]fragmentDecision),
	}
	if err := i.startServers(); err != nil {
		cancel()
		link.Close()
		s.Destroy()
		return nil, err
	}
	i.wg.Add(2)
	go i.readLoop()
	go i.outputLoop()
	return i, nil
}

func (i *Interceptor) startServers() error {
	var udps []*gonet.UDPConn
	for _, a := range []struct {
		netw  string
		addr  tcpip.FullAddress
		proto tcpip.NetworkProtocolNumber
	}{{"udp4", tcpip.FullAddress{NIC: 1, Addr: virtual4, Port: 53}, header.IPv4ProtocolNumber}, {"udp6", tcpip.FullAddress{NIC: 1, Addr: virtual6, Port: 53}, header.IPv6ProtocolNumber}} {
		c, err := gonet.DialUDP(i.stack, &a.addr, nil, a.proto)
		if err != nil {
			for _, u := range udps {
				_ = u.Close()
			}
			return fmt.Errorf("SDNS UDP listener: %w", err)
		}
		udps = append(udps, c)
		i.wg.Add(1)
		go i.udpLoop(c)
	}
	var tcps []*gonet.TCPListener
	for _, a := range []struct {
		addr  tcpip.FullAddress
		proto tcpip.NetworkProtocolNumber
	}{
		{tcpip.FullAddress{NIC: 1, Addr: virtual4, Port: 53}, header.IPv4ProtocolNumber},
		{tcpip.FullAddress{NIC: 1, Addr: virtual6, Port: 53}, header.IPv6ProtocolNumber},
	} {
		l, err := gonet.ListenTCP(i.stack, a.addr, a.proto)
		if err != nil {
			for _, u := range udps {
				_ = u.Close()
			}
			for _, tcpListener := range tcps {
				_ = tcpListener.Close()
			}
			return fmt.Errorf("SDNS TCP listener: %w", err)
		}
		tcps = append(tcps, l)
		i.wg.Add(1)
		go i.tcpLoop(l)
	}
	return nil
}

func (i *Interceptor) udpLoop(c *gonet.UDPConn) {
	defer i.wg.Done()
	defer c.Close()
	buf := make([]byte, 65535)
	for {
		n, peer, err := c.ReadFrom(buf)
		if err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(i.ctx, 10*time.Second)
		resp, err := i.ex.Exchange(ctx, append([]byte(nil), buf[:n]...))
		cancel()
		if err == nil {
			_, _ = c.WriteTo(resp, peer)
		}
	}
}

func (i *Interceptor) tcpLoop(l *gonet.TCPListener) {
	defer i.wg.Done()
	defer l.Close()
	for {
		c, err := l.Accept()
		if err != nil {
			return
		}
		i.wg.Add(1)
		go func() { defer i.wg.Done(); i.tcpConn(c) }()
	}
}

func (i *Interceptor) tcpConn(c net.Conn) {
	defer c.Close()
	for {
		var h [2]byte
		if _, err := io.ReadFull(c, h[:]); err != nil {
			return
		}
		n := int(binary.BigEndian.Uint16(h[:]))
		if n == 0 || n > 65535 {
			return
		}
		q := make([]byte, n)
		if _, err := io.ReadFull(c, q); err != nil {
			return
		}
		ctx, cancel := context.WithTimeout(i.ctx, 10*time.Second)
		resp, err := i.ex.Exchange(ctx, q)
		cancel()
		if err != nil || len(resp) > 65535 {
			return
		}
		binary.BigEndian.PutUint16(h[:], uint16(len(resp)))
		if _, err = c.Write(h[:]); err != nil {
			return
		}
		if _, err = c.Write(resp); err != nil {
			return
		}
	}
}

func (i *Interceptor) readLoop() {
	defer i.wg.Done()
	buf := make([]byte, 65535)
	for {
		n, err := i.under.Read(buf, 0)
		if err != nil {
			close(i.out)
			return
		}
		if n == 0 {
			continue
		}
		p := append([]byte(nil), buf[:n]...)
		if !i.interceptsDNSPacket(p) {
			i.enqueue(p)
			continue
		}
		pk := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(p)})
		if p[0]>>4 == 4 {
			i.link.InjectInbound(header.IPv4ProtocolNumber, pk)
		} else {
			i.link.InjectInbound(header.IPv6ProtocolNumber, pk)
		}
		pk.DecRef()
	}
}

func isDNSPacket(p []byte) bool {
	info, ok := inspectDNSPacket(p)
	return ok && info.isDNS
}

func inspectDNSPacket(p []byte) (packetDNSInfo, bool) {
	var info packetDNSInfo
	if len(p) < 20 {
		return info, false
	}

	switch p[0] >> 4 {
	case 4:
		headerLen := int(p[0]&0x0f) * 4
		if headerLen < 20 || headerLen+4 > len(p) ||
			p[16] != 198 || p[17] != 18 || p[18] != 0 || p[19] != 1 {
			return info, false
		}
		protocol := p[9]
		if protocol != 6 && protocol != 17 {
			return info, false
		}
		fragment := binary.BigEndian.Uint16(p[6:8])
		offset := fragment & 0x1fff
		info.more = fragment&0x2000 != 0
		info.fragmented = offset != 0 || info.more
		info.first = offset == 0
		if info.fragmented {
			info.key = "4" + string(p[12:20]) + string(p[4:6]) + string([]byte{protocol})
			if !info.first {
				return info, true
			}
		}
		info.isDNS = binary.BigEndian.Uint16(p[headerLen+2:headerLen+4]) == 53
		return info, true

	case 6:
		if len(p) < 40 {
			return info, false
		}
		v := virtual6.As16()
		if string(p[24:40]) != string(v[:]) {
			return info, false
		}
		end := len(p)
		payloadLen := int(binary.BigEndian.Uint16(p[4:6]))
		if payloadLen > 0 && 40+payloadLen < end {
			end = 40 + payloadLen
		}
		nextHeader := p[6]
		offset := 40
		for steps := 0; steps < 8; steps++ {
			switch nextHeader {
			case 6, 17:
				if offset+4 > end {
					return packetDNSInfo{}, false
				}
				info.isDNS = binary.BigEndian.Uint16(p[offset+2:offset+4]) == 53
				return info, true
			case 44: // Fragment header
				if offset+8 > end {
					return packetDNSInfo{}, false
				}
				fragmentNext := p[offset]
				fragment := binary.BigEndian.Uint16(p[offset+2 : offset+4])
				fragmentOffset := fragment & 0xfff8
				info.more = fragment&1 != 0
				info.fragmented = true
				info.first = fragmentOffset == 0
				info.key = "6" + string(p[8:40]) + string(p[offset+4:offset+8]) + string([]byte{fragmentNext})
				if !info.first {
					return info, true
				}
				nextHeader = fragmentNext
				offset += 8
			case 0, 43, 60, 135: // Hop-by-hop, routing, destination, mobility
				if offset+2 > end {
					return packetDNSInfo{}, false
				}
				length := (int(p[offset+1]) + 1) * 8
				if offset+length > end {
					return packetDNSInfo{}, false
				}
				nextHeader = p[offset]
				offset += length
			case 51: // Authentication header
				if offset+2 > end {
					return packetDNSInfo{}, false
				}
				length := (int(p[offset+1]) + 2) * 4
				if offset+length > end {
					return packetDNSInfo{}, false
				}
				nextHeader = p[offset]
				offset += length
			default:
				return packetDNSInfo{}, false
			}
		}
	}
	return packetDNSInfo{}, false
}

func (i *Interceptor) interceptsDNSPacket(p []byte) bool {
	info, ok := inspectDNSPacket(p)
	if !ok {
		return false
	}
	if !info.fragmented {
		return info.isDNS
	}

	now := time.Now()
	for key, decision := range i.fragments {
		if !now.Before(decision.expires) {
			delete(i.fragments, key)
		}
	}
	if info.first {
		if info.more {
			i.rememberFragment(info.key, info.isDNS, now)
		}
		return info.isDNS
	}
	decision, found := i.fragments[info.key]
	if !found || !now.Before(decision.expires) {
		delete(i.fragments, info.key)
		return false
	}
	if !info.more {
		delete(i.fragments, info.key)
	}
	return decision.isDNS
}

func (i *Interceptor) rememberFragment(key string, isDNS bool, now time.Time) {
	if i.fragments == nil {
		i.fragments = make(map[string]fragmentDecision)
	}
	if _, exists := i.fragments[key]; !exists && len(i.fragments) >= maxTrackedFragments {
		oldestKey := ""
		var oldest time.Time
		for candidate, decision := range i.fragments {
			if oldestKey == "" || decision.expires.Before(oldest) {
				oldestKey, oldest = candidate, decision.expires
			}
		}
		delete(i.fragments, oldestKey)
	}
	i.fragments[key] = fragmentDecision{isDNS: isDNS, expires: now.Add(fragmentDecisionTTL)}
}

func (i *Interceptor) outputLoop() {
	defer i.wg.Done()
	for {
		p := i.link.ReadContext(i.ctx)
		if p == nil {
			return
		}
		v := p.ToView().AsSlice()
		select {
		case <-i.done:
			p.DecRef()
			return
		default:
			_, _ = i.under.Write(v, 0)
		}
		p.DecRef()
	}
}

func (i *Interceptor) enqueue(p []byte) {
	select {
	case i.out <- p:
	case <-i.done:
	}
}

func (i *Interceptor) Read(b []byte, off int) (int, error) {
	select {
	case p, ok := <-i.out:
		if !ok {
			return 0, io.EOF
		}
		if len(p) > len(b)-off {
			return 0, errors.New("SDNS packet exceeds read buffer")
		}
		copy(b[off:], p)
		return len(p), nil
	case <-i.done:
		return 0, ErrInterceptorClosed
	}
}
func (i *Interceptor) Write(b []byte, off int) (int, error) { return i.under.Write(b, off) }
func (i *Interceptor) Flush() error                         { return i.under.Flush() }
func (i *Interceptor) MTU() (int, error)                    { return i.under.MTU() }
func (i *Interceptor) Name() (string, error)                { return i.under.Name() }
func (i *Interceptor) Events() <-chan tun.Event             { return i.under.Events() }
func (i *Interceptor) Close() error {
	var err error
	i.once.Do(func() {
		close(i.done)
		i.cancel()
		i.link.Close()
		i.stack.Destroy()
		err = i.under.Close()
		i.wg.Wait()
	})
	return err
}
