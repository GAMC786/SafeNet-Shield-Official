# Headscale and Headplane external-host setup

SafeNet treats Headscale and Headplane as external services. The SafeNet web
deployment only checks the control plane and opens the Headplane UI; it does
not host the WireGuard data plane.

## Host requirements

Use a Linux host with:

- Docker or Podman
- Persistent Headscale configuration and database storage
- A stable HTTPS hostname for Headscale
- A stable HTTPS hostname for Headplane
- Network access for the Tailscale-compatible clients and any DERP/STUN
  configuration required by the deployment

Headscale's container guidance is maintained at:

https://headscale.net/stable/setup/install/container/

Headplane's installation and configuration guide is maintained at:

https://headplane.net/install/

Headscale does not include a built-in web UI. Headplane is a separate,
community-maintained administration UI:

https://github.com/tale/headplane

## SafeNet configuration

Set these server-side environment variables:

```text
HEADSCALE_URL=https://headscale.example.com
HEADPLANE_URL=https://headplane.example.com
HEADSCALE_API_KEY=<server-side-api-key>
```

`HEADSCALE_API_KEY` is never sent to the browser. SafeNet uses it to query
Headscale's authenticated node endpoint and reports only bounded status and
node-count information.

After setting the values, restart SafeNet. The Dashboard will show:

- Headscale control-plane status
- Registered node count when the API returns it
- A refresh action
- An explicit `Open Headplane` action

Headplane remains responsible for node, network, ACL, and DNS administration.
SafeNet does not proxy Headplane credentials or duplicate its administration
surface.

## Client model

Headscale is a Tailscale control server built on WireGuard. It is not a
WG-Easy-style QR/profile server. Android clients should use a
Tailscale-compatible client configured for the Headscale login server.

If the product requirement changes to standard WireGuard profiles and QR
codes, use a dedicated WireGuard server manager instead of Headscale.