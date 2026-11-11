# SafeNet TrustTunnel endpoint

This directory documents the separate Linux service that SafeNet for Android
connects to. It is not part of the SafeNet web/API server.

## Requirements

- A Linux host with a public IP and a DNS name pointing to that IP.
- TCP port 443 reachable from clients. The host firewall must allow the
  endpoint's configured transport.
- A valid TLS certificate for the VPN DNS name. The TrustTunnel setup wizard
  can manage a Let's Encrypt certificate when the hostname resolves to this host.

## Install and configure

Use the official TrustTunnel endpoint installer and wizard:

1. Follow the install instructions at
   <https://github.com/TrustTunnel/TrustTunnel#quick-start>.
2. Run `/opt/trusttunnel/setup_wizard` as root and configure the listen address,
   TLS hostname, and at least one client account.
3. Enable the provided service with `systemctl enable --now trusttunnel`.
4. Allow the endpoint's configured port through the Linux firewall and any
   provider firewall.

Do not put the generated client password or `tt://` link in source control.
Treat the link as a credential because it contains client authentication data.

## Generate a SafeNet client link

From `/opt/trusttunnel`, generate a per-device link and set AdGuard Family DNS
as the encrypted DNS upstream:

```sh
./trusttunnel_endpoint vpn.toml hosts.toml \
  --client-config safenet-phone \
  --address YOUR_PUBLIC_VPN_HOSTNAME \
  --dns-upstream tls://family.adguard-dns.com
```

Use the username created by the setup wizard for `--client-config`. The exact
option names can vary by TrustTunnel release; check
`./trusttunnel_endpoint --help` and the current upstream README if they differ.
Import the resulting `tt://` link into the SafeNet VPN card on Android.

The VPN card also supplies `tls://family.adguard-dns.com` when an imported link
does not specify DNS upstreams. DNS-based filtering blocks many in-app ad
domains, but cannot guarantee removal of ads served from first-party domains or
through app-specific encrypted DNS.
