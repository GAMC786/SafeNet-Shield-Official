# Headscale and Headplane setup

SafeNet treats Headscale as the external control plane and includes the
upstream Headplane application as an isolated companion service. Headplane is
not merged into the SafeNet Express/Vite bundle. SafeNet and Headplane still do
not host the WireGuard data plane; Headscale and its clients do that.

The repository includes a deployable persistent-host bundle in
`ops/headscale/`. It is the canonical starting point for a Linux/Docker host:
Headscale's SQLite state, Headplane's database, and Caddy's certificate data
are all mounted outside the containers. The bundle also exposes the embedded
DERP/STUN ports that a physical Tailscale-compatible client needs. It is not a
replacement for an externally reachable host; Replit and Railway TCP proxy
traffic do not provide the required UDP/STUN or WireGuard data-plane path.

## Host requirements

Use a Linux host with:

- Docker or Podman
- Persistent Headscale configuration and database storage
- A stable HTTPS hostname for Headscale
- A stable HTTPS hostname for Headplane when running the companion outside the
  local development workflow
- Network access for the Tailscale-compatible clients and any DERP/STUN
  configuration required by the deployment

Headscale's container guidance is maintained at:

https://headscale.net/stable/setup/install/container/

The vendored Headplane source is in `headplane/` and its SafeNet launcher and
environment contract are documented at `headplane/README.safenet.md`.

For a ready-to-run external host, follow `ops/headscale/README.md`. Do not
commit the generated YAML, the `secrets/` files, or any Headscale node/API
response from that host.

Headplane's upstream installation guide is maintained at:

https://headplane.net/install/

Headscale does not include a built-in web UI. Headplane is a separate,
community-maintained administration UI, preserved in this repository under its
MIT license:

https://github.com/tale/headplane

## SafeNet configuration

Set these server-side environment variables for SafeNet and the companion
launcher:

```text
HEADSCALE_URL=https://headscale.example.com
HEADPLANE_URL=https://headplane.example.com/admin
HEADSCALE_API_KEY=<server-side-api-key>
HEADPLANE_COOKIE_SECRET=<exactly-32-character-secret>
HEADPLANE_NODE_API_URL=https://api.example.com/api/headscale/node-status
HEADPLANE_NODE_API_TOKEN=<server-side-read-only-token>
```

`HEADSCALE_API_KEY` is never sent to the browser. SafeNet uses it to query
Headscale's authenticated node endpoint and reports only bounded status and
node-count information.
`HEADPLANE_NODE_API_TOKEN` is also server-side only. It must be scoped to the
read-only endpoint below; it is never written to mesh evidence or returned by
the SafeNet API.

Install and start the companion from the repository:

```sh
npm run headplane:install
npm run headplane:dev
```

For a production bundle, use `npm run headplane:build` followed by
`npm run headplane:start`. After setting the values and starting both services,
the SafeNet Dashboard will show:

- Headscale control-plane status
- Registered node count when the API returns it
- A refresh action
- An explicit `Open Headplane` action

Headplane remains responsible for node, network, ACL, and DNS administration.
SafeNet does not proxy Headplane credentials or duplicate its administration
surface. The launcher shares `HEADSCALE_API_KEY` with Headplane server-side and
generates an ignored, owner-only runtime config.

## Client model

Headscale is a Tailscale control server built on WireGuard. It is not a
WG-Easy-style QR/profile server. Android clients should use a
Tailscale-compatible client configured for the Headscale login server.

If the product requirement changes to standard WireGuard profiles and QR
codes, use a dedicated WireGuard server manager instead of Headscale.

## Android mesh verification

SafeNet does not join the Headscale mesh itself. The Android device under test
must have a Tailscale-compatible client installed and configured with the
custom `HEADSCALE_URL` as its login server. The SafeNet APK and its DNS VPN
are not substitutes for that client.

Before running the physical-device proof, configure these additional values on
the verification runner:

```text
HEADSCALE_DERP_URL=https://headscale.example.com/derpmap
HEADSCALE_ANDROID_NODE_NAME=safenet-phone
HEADSCALE_ANDROID_PEER_ADDRESS=100.64.0.2
HEADSCALE_ANDROID_CLIENT_PACKAGE=com.tailscale.ipn
HEADSCALE_PERSISTENT_STATE_CONFIRMED=pass
```

`HEADSCALE_DERP_URL` must be a public health or DERP-map endpoint that the
runner can reach. Do not treat a reachable Headscale API as proof that DERP
relay or peer traffic works.


### Read-only Headplane node endpoint

The Android proof does not scrape the Headplane HTML page or accept a manually
entered owner. Configure `HEADPLANE_NODE_API_URL` to a supported,
authentication-protected read-only endpoint in the Headplane deployment (or
the SafeNet adapter at `/api/headscale/node-status`). The endpoint must accept:

```http
GET /api/headscale/node-status?node=safenet-phone
Authorization: Bearer <read-only-token>
Accept: application/json
```

The `node` query value is URL-encoded by the verifier. A successful response
must be JSON in this shape:

```json
{
  "node": {
    "name": "safenet-phone",
    "visibility": "visible",
    "owner": "safenet",
    "status": "online"
  }
}
```

`visibility` must be `visible` or `hidden`; `status` must describe the
selected node (`online` or `offline`). The verifier requires `visible`,
requires `online` for this proof, and compares `name`, `owner`, and status with
the authenticated Headscale node record. A `401` or `403` is recorded as
`HEADPLANE_NODE_API_AUTH_FAILED`; an unsupported `404`, `405`, `501`, or
malformed response is recorded as bounded `BLOCKED` evidence rather than
falling back to a manual assertion. Do not point this variable at a Headplane
HTML route or at an endpoint that accepts an administrator credential.

After confirming the Android login-server setting, run:

```sh
HEADSCALE_ANDROID_LOGIN_SERVER_CONFIRMED=pass \
HEADSCALE_PERSISTENT_STATE_CONFIRMED=pass \
npm run headscale:android:evidence -- \
  --serial <physical-device-serial> \
  --output android/app/build/reports/headscale-android-mesh/latest
```

The proof checks the authenticated Headscale node list, the authenticated
read-only Headplane node response, Headplane and DERP HTTP reachability, the
selected physical Android target, the installed client build, the registered
node's owner and online state, a VPN interface, a route through that interface,
and a real peer ping. It writes only bounded evidence under the output
directory; both API tokens and both raw node responses are removed before
evidence is written.

`result=PASS` is valid only when all of those checks complete. Missing
Headscale, Headplane, DERP, Android client, registration, login-server
confirmation, device, or peer prerequisites produce `result=BLOCKED` with an
uppercase `failure_category` and exit status 78. A hosted emulator is also
blocked because it does not provide the required physical-client evidence.

The private runner values are templated in
`docs/headscale-verification.env.example`. The expected Android node name is
`safenet-phone`; the approved peer must be the address of the separately
registered always-on node selected by the operator. Replace the peer
placeholder only after Headscale reports that node as online. A live PASS
still requires the runner to supply the server-side API key and token through
its secret store; neither value belongs in the evidence directory.
