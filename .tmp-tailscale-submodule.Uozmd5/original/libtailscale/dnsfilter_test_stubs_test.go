//go:build dnsfilter_standalone_test

// This small harness runs packet parser tests without compiling Android-only
// cgo sources from the surrounding libtailscale package.
package libtailscale

import (
	"net/netip"
)

type AppContext interface {
	ShouldBlockDNSPacket([]byte, string, string, bool, bool, bool) bool
	BlockedDNSResponse([]byte) []byte
	ShouldBlockNonDNSPacket() bool
}

type multiTUN struct {
	appCtx AppContext
}

type tunDevice struct{}

func (*multiTUN) isConfiguredDNSServer(netip.Addr) bool { return true }
func (*multiTUN) injectPacket(*tunDevice, []byte) error { return nil }
