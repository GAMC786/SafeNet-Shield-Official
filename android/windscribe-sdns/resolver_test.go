package sdns

import (
	"context"
	"errors"
	"net/netip"
	"testing"
	"time"

	"github.com/ameshkov/dnsstamps"
	"github.com/miekg/dns"
)

type closeTrackingUpstream struct {
	closeCalls int
	closeErr   error
}

func (u *closeTrackingUpstream) Exchange(*dns.Msg) (*dns.Msg, error) {
	return nil, errors.New("not used")
}

func (u *closeTrackingUpstream) Address() string { return "test" }

func (u *closeTrackingUpstream) Close() error {
	u.closeCalls++
	return u.closeErr
}

func stampFor(proto dnsstamps.StampProtoType) string {
	s := &dnsstamps.ServerStamp{
		ServerAddrStr: netip.MustParseAddrPort("1.2.3.4:443").String(),
		ProviderName:  "resolver.example",
		Path:          "/dns-query",
		Proto:         proto,
	}
	if proto == dnsstamps.StampProtoTypeDNSCrypt {
		s.ServerPk = make([]byte, 32)
		s.ProviderName = "2.dnscrypt-cert.example"
	}
	return s.String()
}

func TestNewAcceptsSupportedStampProtocols(t *testing.T) {
	for _, proto := range []dnsstamps.StampProtoType{
		dnsstamps.StampProtoTypeDNSCrypt,
		dnsstamps.StampProtoTypeDoH,
		dnsstamps.StampProtoTypeTLS,
		dnsstamps.StampProtoTypeDoQ,
	} {
		t.Run(proto.String(), func(t *testing.T) {
			r, err := New(stampFor(proto), time.Second)
			if err != nil {
				t.Fatalf("New() error = %v", err)
			}
			_ = r.Close()
		})
	}
}

func TestNewRejectsMalformedAndUnsupportedStamps(t *testing.T) {
	plain := (&dnsstamps.ServerStamp{
		ServerAddrStr: "1.2.3.4:53",
		Proto:         dnsstamps.StampProtoTypePlain,
	}).String()
	for _, stamp := range []string{"", "sdns://not-base64", plain, "sdns://CA"} {
		if r, err := New(stamp, time.Second); err == nil || r != nil {
			t.Fatalf("New(%q) = resolver %v, error %v; want rejection", stamp, r, err)
		}
	}
}

func TestExchangeRejectsNonQuestionMessagesWithoutNetwork(t *testing.T) {
	r, err := New(stampFor(dnsstamps.StampProtoTypeTLS), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	response := new(dns.Msg)
	response.SetReply(&dns.Msg{})
	raw, err := response.Pack()
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.Exchange(context.Background(), raw)
	if !errors.Is(err, ErrInvalidQuestion) {
		t.Fatalf("Exchange() error = %v, want ErrInvalidQuestion", err)
	}
}

func TestExchangeRejectsMalformedMessage(t *testing.T) {
	r, err := New(stampFor(dnsstamps.StampProtoTypeDoQ), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	_, err = r.Exchange(context.Background(), []byte{1, 2, 3})
	if err == nil {
		t.Fatal("Exchange() unexpectedly accepted malformed DNS")
	}
}

func TestCloseReturnsTheSameErrorIdempotently(t *testing.T) {
	closeErr := errors.New("close failed")
	upstream := &closeTrackingUpstream{closeErr: closeErr}
	r := &Resolver{
		upstream: upstream,
		timeout:  time.Second,
		inFlight: make(chan struct{}, maxInFlightExchanges),
	}
	if err := r.Close(); !errors.Is(err, closeErr) {
		t.Fatalf("first Close() error = %v, want %v", err, closeErr)
	}
	if err := r.Close(); !errors.Is(err, closeErr) {
		t.Fatalf("second Close() error = %v, want %v", err, closeErr)
	}
	if upstream.closeCalls != 1 {
		t.Fatalf("upstream Close() called %d times, want once", upstream.closeCalls)
	}
}
