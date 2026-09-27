// Package sdns provides a small, embeddable DNS-stamp resolver for the
// Windscribe tunnel.  It deliberately accepts only resolver stamps; plain
// DNS URLs and server stamps are not exposed by this API.
package sdns

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/AdguardTeam/dnsproxy/upstream"
	"github.com/ameshkov/dnsstamps"
	"github.com/miekg/dns"
)

const (
	defaultTimeout       = 10 * time.Second
	maxInFlightExchanges = 32
)

var (
	ErrInvalidStamp     = errors.New("invalid SDNS stamp")
	ErrUnsupportedStamp = errors.New("unsupported SDNS stamp protocol")
	ErrInvalidQuestion  = errors.New("DNS message must contain exactly one question")
	ErrNotQuestion      = errors.New("DNS message contains response records")
	ErrExchangeTimeout  = errors.New("DNS exchange timed out")
)

// Resolver is safe for concurrent Exchange calls.
type Resolver struct {
	upstream  upstream.Upstream
	timeout   time.Duration
	closeOnce sync.Once
	closeErr  error
	inFlight  chan struct{}
}

// New validates stamp and creates a resolver without making a network request.
// Supported stamp protocols are DNSCrypt, DoH, DoT, and DoQ. ODoH and relay
// stamps are intentionally rejected because dnsproxy's upstream package does
// not implement them as recursive DNS resolvers.
func New(stamp string, timeout time.Duration) (*Resolver, error) {
	if stamp == "" {
		return nil, fmt.Errorf("%w: stamp is empty", ErrInvalidStamp)
	}
	parsed, err := dnsstamps.NewServerStampFromString(stamp)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidStamp, err)
	}
	switch parsed.Proto {
	case dnsstamps.StampProtoTypeDNSCrypt,
		dnsstamps.StampProtoTypeDoH,
		dnsstamps.StampProtoTypeTLS,
		dnsstamps.StampProtoTypeDoQ:
	default:
		return nil, fmt.Errorf("%w: %v", ErrUnsupportedStamp, parsed.Proto)
	}
	host, _, splitErr := net.SplitHostPort(parsed.ServerAddrStr)
	if splitErr != nil {
		host = parsed.ServerAddrStr
	}
	if net.ParseIP(strings.Trim(host, "[]")) == nil {
		return nil, fmt.Errorf("%w: hostname bootstrap is disabled", ErrInvalidStamp)
	}
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	// AddressToUpstream performs the remaining protocol/address validation.
	// It constructs clients only; no exchange or bootstrap query occurs here.
	u, err := upstream.AddressToUpstream(stamp, &upstream.Options{Timeout: timeout})
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidStamp, err)
	}
	return &Resolver{
		upstream: u,
		timeout:  timeout,
		inFlight: make(chan struct{}, maxInFlightExchanges),
	}, nil
}

// Exchange forwards one DNS question and returns its packed response.
// The input must be a query, not a response or multi-question message.
func (r *Resolver) Exchange(ctx context.Context, rawDNSMessage []byte) ([]byte, error) {
	if r == nil || r.upstream == nil {
		return nil, errors.New("SDNS resolver is nil")
	}
	if ctx == nil {
		return nil, errors.New("DNS exchange context is nil")
	}
	req := new(dns.Msg)
	if err := req.Unpack(rawDNSMessage); err != nil {
		return nil, fmt.Errorf("invalid DNS message: %w", err)
	}
	if len(req.Question) != 1 {
		return nil, ErrInvalidQuestion
	}
	if len(req.Answer) != 0 || len(req.Ns) != 0 {
		return nil, ErrNotQuestion
	}
	for _, extra := range req.Extra {
		if _, ok := extra.(*dns.OPT); !ok {
			return nil, ErrNotQuestion
		}
	}

	exchangeCtx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	select {
	case r.inFlight <- struct{}{}:
	case <-exchangeCtx.Done():
		if errors.Is(exchangeCtx.Err(), context.DeadlineExceeded) {
			return nil, ErrExchangeTimeout
		}
		return nil, exchangeCtx.Err()
	}
	result := make(chan exchangeResult, 1)
	go func() {
		defer func() { <-r.inFlight }()
		resp, err := r.upstream.Exchange(req)
		result <- exchangeResult{resp: resp, err: err}
	}()
	select {
	case <-exchangeCtx.Done():
		if errors.Is(exchangeCtx.Err(), context.DeadlineExceeded) {
			return nil, ErrExchangeTimeout
		}
		return nil, exchangeCtx.Err()
	case result := <-result:
		if result.err != nil {
			return nil, fmt.Errorf("SDNS exchange failed: %w", result.err)
		}
		if result.resp == nil {
			return nil, errors.New("SDNS exchange returned an empty response")
		}
		response, err := result.resp.Pack()
		if err != nil {
			return nil, fmt.Errorf("invalid SDNS response: %w", err)
		}
		return response, nil
	}
}

// Close releases resolver resources. It is safe to call more than once.
func (r *Resolver) Close() error {
	if r == nil || r.upstream == nil {
		return nil
	}
	r.closeOnce.Do(func() { r.closeErr = r.upstream.Close() })
	return r.closeErr
}

type exchangeResult struct {
	resp *dns.Msg
	err  error
}
