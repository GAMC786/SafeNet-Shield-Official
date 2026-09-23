# Persistent Headscale proof host

This bundle runs Headscale, Headplane, embedded DERP/STUN, and Caddy on one
Linux host with Docker or Podman Compose. It is intentionally separate from
the SafeNet web service. A Railway TCP proxy is not a replacement for this
host because the Android proof needs the Headscale control plane plus public
UDP/3478 for STUN and a stable HTTPS endpoint for DERP.

## First-time setup

1. Point DNS `A` (and, when used, `AAAA`) records at the host:
   - `HEADSCALE_DOMAIN`: the Headscale login/control hostname
   - `HEADPLANE_DOMAIN`: the Headplane administration hostname
2. Open inbound TCP `80` and `443`, and UDP `3478`. Keep Headscale metrics
   and gRPC private.
3. Prepare persistent directories and examples:

   ```sh
   mkdir -p headscale/config headscale/lib headplane caddy/data caddy/config
   cp headscale/config.yaml.example headscale/config/config.yaml
   cp headplane/config.yaml.example headplane/config.yaml
   umask 077
   printf '%s' '<headscale-api-key>' > secrets/headscale_api_key
   printf '%s' '<exactly-32-character-cookie-secret>' > secrets/headplane_cookie_secret
   ```

4. Replace the angle-bracket placeholders in both YAML files. The cookie
   secret must be exactly 32 characters. Set `HEADSCALE_DOMAIN`,
   `HEADPLANE_DOMAIN`, and `ACME_EMAIL` in the host's private `.env` file.
5. Check the rendered configuration before starting:

   ```sh
   docker compose config >/tmp/safenet-headscale.compose.yaml
   docker compose up -d
   curl --fail-with-body "https://${HEADSCALE_DOMAIN}/health"
   curl --fail-with-body "https://${HEADPLANE_DOMAIN}/healthz"
   ```

The `headscale/lib`, `headplane/data`, and Caddy data directories must remain
on persistent host storage. Back them up before upgrades. Never commit the
secret files, rendered configs, API keys, or node responses.

## Register the proof node and peer

Create the user and a short-lived pre-auth key on the host:

```sh
docker compose exec headscale headscale users create safenet
docker compose exec headscale headscale preauthkeys create \
  --user safenet --reusable=false --expiration 24h
```

Use the resulting key only to enroll the Tailscale-compatible Android client
against `https://${HEADSCALE_DOMAIN}`. Register one second, always-on node as
the approved peer. Record the actual peer address after registration; do not
guess it from the address pool.

The proof run's documented names are:

```text
HEADSCALE_ANDROID_NODE_NAME=safenet-phone
HEADSCALE_ANDROID_PEER_ADDRESS=<registered-always-on-peer-address>
HEADSCALE_ANDROID_CLIENT_PACKAGE=com.tailscale.ipn
```

The Android node must be online and owned by `safenet` in Headscale. The
approved peer must be online, reachable through the mesh, and not be the
Android node itself.