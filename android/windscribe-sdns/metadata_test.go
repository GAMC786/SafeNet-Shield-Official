package sdns

import (
	"encoding/base64"
	"testing"
)

func TestStripTunnelMetadataExtractsFirewallSnapshotAndPreservesWireGuardSettings(t *testing.T) {
	stamp := base64.RawURLEncoding.EncodeToString([]byte("sdns://resolver"))
	policy := base64.RawURLEncoding.EncodeToString([]byte(`{"settings":{"firewallEnabled":true,"preventDnsOverrides":true},"rules":[],"blocklists":[]}`))
	input := "private_key=abc\nsafenet_sdns=" + stamp + "\nsafenet_firewall=" + policy + "\n"

	cleaned, gotStamp, resolverConfigured, gotPolicy, firewallConfigured, err :=
		StripTunnelMetadata(input)
	if err != nil {
		t.Fatal(err)
	}
	if cleaned != "private_key=abc\n" {
		t.Fatalf("unexpected WireGuard settings: %q", cleaned)
	}
	if gotStamp != "sdns://resolver" || !resolverConfigured {
		t.Fatalf("resolver metadata was not extracted: stamp=%q configured=%t", gotStamp, resolverConfigured)
	}
	if gotPolicy != `{"settings":{"firewallEnabled":true,"preventDnsOverrides":true},"rules":[],"blocklists":[]}` ||
		!firewallConfigured {
		t.Fatalf("firewall snapshot was not extracted: policy=%q configured=%t", gotPolicy, firewallConfigured)
	}
}

func TestStripTunnelMetadataMarksMalformedFirewallSnapshotForFailClosedHandling(t *testing.T) {
	cleaned, _, _, policy, configured, err :=
		StripTunnelMetadata("private_key=abc\nsafenet_firewall=not-base64!\n")
	if err != nil {
		t.Fatal(err)
	}
	if cleaned != "private_key=abc\n" || !configured || policy != "" {
		t.Fatalf("malformed firewall metadata was not marked fail-closed: clean=%q configured=%t policy=%q", cleaned, configured, policy)
	}
}
