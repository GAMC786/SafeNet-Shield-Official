package sdns

import (
	"encoding/base64"
	"fmt"
	"strings"
)

// StripTunnelMetadata removes SafeNet-only fields before WireGuard's UAPI
// parser sees them while returning their decoded values to the tunnel adapter.
// Invalid firewall metadata is reported as configured with an empty policy so
// the interceptor applies its fail-closed policy without rejecting the tunnel.
func StripTunnelMetadata(settings string) (
	cleaned, stamp string,
	resolverConfigured bool,
	firewallPolicy string,
	firewallConfigured bool,
	err error,
) {
	var kept strings.Builder
	firewallInvalid := false
	for _, line := range strings.SplitAfter(settings, "\n") {
		content := strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
		if strings.HasPrefix(content, "safenet_sdns=") {
			if resolverConfigured {
				return "", "", false, "", false, fmt.Errorf("duplicate safenet_sdns metadata")
			}
			encoded := strings.TrimPrefix(content, "safenet_sdns=")
			if encoded == "" {
				return "", "", false, "", false, fmt.Errorf("empty safenet_sdns metadata")
			}
			stampBytes, decodeErr := decodeURLBase64(encoded)
			if decodeErr != nil || len(stampBytes) == 0 {
				return "", "", false, "", false, fmt.Errorf("malformed safenet_sdns metadata")
			}
			stamp, resolverConfigured = string(stampBytes), true
			continue
		}
		if strings.HasPrefix(content, "safenet_firewall=") {
			encoded := strings.TrimPrefix(content, "safenet_firewall=")
			if firewallConfigured {
				firewallPolicy = ""
				firewallInvalid = true
				continue
			}
			firewallConfigured = true
			if encoded == "" {
				firewallInvalid = true
				continue
			}
			policy, decodeErr := decodeURLBase64(encoded)
			if decodeErr != nil || len(policy) == 0 {
				firewallInvalid = true
				continue
			}
			firewallPolicy = string(policy)
			continue
		}
		kept.WriteString(line)
	}
	if firewallInvalid {
		firewallPolicy = ""
	}
	return kept.String(), stamp, resolverConfigured, firewallPolicy, firewallConfigured, nil
}

func decodeURLBase64(value string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err == nil {
		return decoded, nil
	}
	return base64.URLEncoding.DecodeString(value)
}
