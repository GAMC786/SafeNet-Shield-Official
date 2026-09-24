# Tailscale hosted tailnet for SafeNet

SafeNet connects to the official Tailscale hosted control plane. Tailscale
provides the encrypted mesh and device administration; SafeNet only reads
bounded device status and links to the Tailscale admin console. SafeNet is not
a Tailscale client, and Replit does not host the mesh data plane.

## Create the tailnet

Create or select a Tailscale tailnet at the
[Tailscale admin console](https://login.tailscale.com/admin). Tailscale is a
hosted service; do not deploy an unofficial Compose control plane or attempt to
restore a Tailscale control-plane VM.

In **Trust credentials**, create an OAuth credential with the least privilege
needed by SafeNet: `devices:core:read`. Copy the client ID and client secret
once, and store them only as server-side secrets. Tailscale exchanges those
credentials at `https://api.tailscale.com/api/v2/oauth/token`; SafeNet then
reads devices from the Tailscale API with a short-lived bearer token.

The device-list API can use `-` for the credential's default tailnet, or the
tailnet name/ID shown in Tailscale General settings. See the official
[OAuth client guide](https://tailscale.com/docs/features/oauth-clients) and
[API reference](https://tailscale.com/docs/reference/tailscale-api).

## Connect SafeNet

Set these values in the SafeNet server environment:

| Variable | Purpose |
| --- | --- |
| `TAILSCALE_TAILNET` | Tailnet name/ID, or `-` for the OAuth credential's default tailnet |
| `TAILSCALE_OAUTH_CLIENT_ID` | Tailscale OAuth client ID; keep server-side |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | Tailscale OAuth client secret; keep server-side |
| `TAILSCALE_STATUS_TOKEN` | Separate secret bearer token protecting SafeNet's bounded device-status endpoint |

Use Replit **Secrets** for the credentials and status token. For a published
deployment, add them under **Publishing → Deployment secrets** as well. Never
commit secrets, OAuth responses, device responses, or device addresses.

SafeNet obtains the OAuth token and requests the Tailscale device list on the
server. It never returns credentials, tokens, or the raw API response to the
browser. The Dashboard reports API reachability and device count and opens the
hosted Tailscale admin console. It does not enroll devices, change ACLs, create
auth keys, or act as a Tailscale VPN client.

## Android mesh proof

Install the official Tailscale Android app from
[Google Play](https://play.google.com/store/apps/details?id=com.tailscale.ipn)
on a physical device. Its package ID is `com.tailscale.ipn`. Follow the
[Android installation guide](https://tailscale.com/docs/install/android), sign
in to the target tailnet, and connect to an approved peer.

For release evidence, configure
[`docs/tailscale-verification.env.example`](../../docs/tailscale-verification.env.example)
in the protected runner environment. The evidence script fails closed unless
it confirms the Android device through the SafeNet adapter and Tailscale API,
the real VPN route, and a successful probe to the approved peer. An emulator
or SafeNet's DNS VPN is not Tailscale mesh proof.

Run locally on the physical-device runner:

```sh
npm run tailscale:android:evidence
```

## Recovery evidence

Use
[`docs/tailscale-recovery-evidence.md`](../../docs/tailscale-recovery-evidence.md)
to record a tailnet/account/device recovery drill. Record administrative
recovery and device identity evidence, not a fabricated server restore:
Tailscale's hosted control plane has no customer-managed Compose deployment or
control-plane volume to restore.