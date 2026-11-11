package bridge

import (
	"sync"
	"time"

	"github.com/ameshkov/dnscrypt/v2"
	"github.com/miekg/dns"
)

// DnscryptResolver performs DNSCrypt lookups for the Android local VPN.
type DnscryptResolver struct{}

var dnscryptResolvers = struct {
	sync.Mutex
	byStamp map[string]*dnscrypt.ResolverInfo
}{byStamp: make(map[string]*dnscrypt.ResolverInfo)}

func NewDnscryptResolver() *DnscryptResolver { return &DnscryptResolver{} }

// Query forwards one DNS packet through an SDNS/DNSCrypt resolver stamp.
func (r *DnscryptResolver) Query(stamp string, packet []byte) ([]byte, error) {
	query := new(dns.Msg)
	if err := query.Unpack(packet); err != nil {
		return nil, err
	}

	client := &dnscrypt.Client{Net: "udp", Timeout: 8 * time.Second}
	info := cachedDnscryptResolver(stamp)
	if info == nil {
		var err error
		info, err = client.Dial(stamp)
		if err != nil {
			return nil, err
		}
		cacheDnscryptResolver(stamp, info)
	}

	response, err := client.Exchange(query, info)
	if err != nil {
		info, err = client.Dial(stamp)
		if err != nil {
			return nil, err
		}
		cacheDnscryptResolver(stamp, info)
		response, err = client.Exchange(query, info)
	}
	if err != nil {
		return nil, err
	}
	return response.Pack()
}

func cachedDnscryptResolver(stamp string) *dnscrypt.ResolverInfo {
	dnscryptResolvers.Lock()
	defer dnscryptResolvers.Unlock()
	return dnscryptResolvers.byStamp[stamp]
}

func cacheDnscryptResolver(stamp string, info *dnscrypt.ResolverInfo) {
	if stamp == "" || info == nil {
		return
	}
	dnscryptResolvers.Lock()
	dnscryptResolvers.byStamp[stamp] = info
	dnscryptResolvers.Unlock()
}
