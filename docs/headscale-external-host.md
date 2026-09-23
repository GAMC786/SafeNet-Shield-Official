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

After confirming the Android login-server setting and the node row in
Headplane, run:

```sh
HEADSCALE_HEADPLANE_NODE_STATUS=pass \
HEADSCALE_HEADPLANE_NODE_OWNER=safenet \
HEADSCALE_ANDROID_LOGIN_SERVER_CONFIRMED=pass \
HEADSCALE_PERSISTENT_STATE_CONFIRMED=pass \
npm run headscale:android:evidence -- \
  --serial <physical-device-serial> \
  --output android/app/build/reports/headscale-android-mesh/latest
```

The proof checks the authenticated Headscale node list, Headplane and DERP
HTTP reachability, the selected physical Android target, the installed client
build, the registered node's owner and online state, a VPN interface, a route
through that interface, and a real peer ping. It writes only bounded evidence
under the output directory; the API key and raw node response are never
written.

`result=PASS` is valid only when all of those checks complete. Missing
Headscale, Headplane, DERP, Android client, registration, login-server
confirmation, device, or peer prerequisites produce `result=BLOCKED` with an
uppercase `failure_category` and exit status 78. A hosted emulator is also
blocked because it does not provide the required physical-client evidence.
