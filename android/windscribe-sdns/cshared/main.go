package main

/*
#include <stdint.h>
*/
import "C"

import (
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	sdns "com.safenet.dns/windscribe-sdns"
	"golang.org/x/sys/unix"
	"golang.zx2c4.com/wireguard/tun"
)

type fdTunnel struct {
	fd        int
	closeOnce sync.Once
	closeErr  error
}

func (d *fdTunnel) Read(p []byte, offset int) (int, error) {
	if offset < 0 || offset > len(p) {
		return 0, unix.EINVAL
	}
	return unix.Read(d.fd, p[offset:])
}

func (d *fdTunnel) Write(p []byte, offset int) (int, error) {
	if offset < 0 || offset > len(p) {
		return 0, unix.EINVAL
	}
	return unix.Write(d.fd, p[offset:])
}

func (*fdTunnel) Flush() error {
	return nil
}

func (*fdTunnel) MTU() (int, error) {
	return 1500, nil
}

func (*fdTunnel) Name() (string, error) {
	return "safenet-strongswan", nil
}

func (*fdTunnel) Events() <-chan tun.Event {
	return nil
}

func (d *fdTunnel) Close() error {
	d.closeOnce.Do(func() {
		d.closeErr = unix.Close(d.fd)
	})
	return d.closeErr
}

type activeFilter struct {
	filter   *sdns.Interceptor
	resolver *sdns.Resolver
}

var (
	filterHandlesMu sync.RWMutex
	filterHandles   = make(map[int64]*activeFilter)
	nextFilterID    atomic.Int64
)

//export SafeNetFilterCreate
func SafeNetFilterCreate(tunFD C.int, stamp *C.char, policy *C.char) C.int64_t {
	if tunFD < 0 {
		return 0
	}

	var resolver *sdns.Resolver
	if stamp != nil && C.GoString(stamp) != "" {
		var err error
		resolver, err = sdns.New(C.GoString(stamp), 10*time.Second)
		if err != nil {
			return 0
		}
	}

	fd, err := unix.Dup(int(tunFD))
	if err != nil {
		if resolver != nil {
			_ = resolver.Close()
		}
		return 0
	}
	device := &fdTunnel{fd: fd}

	serializedPolicy := ""
	if policy != nil {
		serializedPolicy = C.GoString(policy)
	}
	filter, err := sdns.NewPacketFilterWithFirewall(device, resolver, serializedPolicy)
	if err != nil {
		_ = device.Close()
		if resolver != nil {
			_ = resolver.Close()
		}
		return 0
	}

	id := nextFilterID.Add(1)
	if id <= 0 {
		_ = filter.Close()
		if resolver != nil {
			_ = resolver.Close()
		}
		return 0
	}
	filterHandlesMu.Lock()
	filterHandles[id] = &activeFilter{filter: filter, resolver: resolver}
	filterHandlesMu.Unlock()
	return C.int64_t(id)
}

//export SafeNetFilterOutboundPacket
func SafeNetFilterOutboundPacket(handle C.int64_t, packet unsafe.Pointer, length C.int) C.int {
	if packet == nil || length <= 0 || length > 65535 {
		return -1
	}
	active := lookupFilter(int64(handle))
	if active == nil {
		return -1
	}

	// C owns this buffer and may reuse it as soon as this call returns. The
	// interceptor can enqueue virtual-resolver packets asynchronously, so copy
	// the bytes before passing them into Go.
	bytes := C.GoBytes(packet, length)
	// The native caller treats only 1 as "pass to IKE"; 0 means that the
	// packet was consumed by SDNS or rejected by policy.
	return C.int(safeNetFilterResult(active.filter.FilterOutboundPacket(bytes)))
}

func safeNetFilterResult(pass bool) int {
	if pass {
		return 1
	}
	return 0
}

//export SafeNetFilterUpdatePolicy
func SafeNetFilterUpdatePolicy(handle C.int64_t, policy *C.char) C.int {
	active := lookupFilter(int64(handle))
	if active == nil {
		return -1
	}
	serializedPolicy := ""
	if policy != nil {
		serializedPolicy = C.GoString(policy)
	}
	if err := active.filter.SetFirewallPolicy(serializedPolicy); err != nil {
		return -1
	}
	return 0
}

//export SafeNetFilterClose
func SafeNetFilterClose(handle C.int64_t) {
	id := int64(handle)
	filterHandlesMu.Lock()
	active := filterHandles[id]
	delete(filterHandles, id)
	filterHandlesMu.Unlock()
	if active == nil {
		return
	}
	_ = active.filter.Close()
	if active.resolver != nil {
		_ = active.resolver.Close()
	}
}

func lookupFilter(id int64) *activeFilter {
	filterHandlesMu.RLock()
	defer filterHandlesMu.RUnlock()
	return filterHandles[id]
}

func main() {}
