# NetBird self-hosting for SafeNet

SafeNet connects to an independently hosted NetBird deployment. NetBird runs
the mesh control and relay services; SafeNet only reads bounded peer status
and links to the NetBird Dashboard. Do not run the mesh data plane in Replit.

## Deploy NetBird

Use the official [NetBird self-hosted quickstart](https://docs.netbird.io/selfhosted/selfhosted-quickstart)
on a separate public Linux VM. Its current baseline is 1 CPU, 2 GB RAM, a
public DNS name, inbound TCP 80 and 443, UDP 3478, Docker with Compose v2,
`jq`, and `curl`.

Download the official installer, inspect it, then run it on that VM:

```sh
curl -fsSLo getting-started.sh \
  https://github.com/netbirdio/netbird/releases/latest/download/getting-started.sh
less getting-started.sh
bash getting-started.sh
```

Select the default Traefik option for the quickstart unless the host already
has a reverse proxy. Follow the installer prompts for the public domain and
TLS. It generates the Compose deployment and configuration; manage the
resulting stack from the directory and Compose file it reports. Confirm the
Dashboard loads and that the management API is reachable before connecting
SafeNet.

Keep the generated Compose file, configuration, environment file, signing and
encryption keys, and every persistent volume/bind mount on durable storage.
Back up all state declared by the generated deployment, not just this
repository's files. Do not commit secrets, populated environment files, peer
responses, or private keys. Before upgrades or host replacement, make a
consistent encrypted backup and test restoration on a separate host.

## Connect SafeNet

Set the following in the SafeNet server environment:

| Variable | Purpose |
| --- | --- |
| `NETBIRD_MANAGEMENT_URL` | NetBird API root, e.g. `https://mesh.example.com`; SafeNet requests `/api/peers` |
| `NETBIRD_DASHBOARD_URL` | Browser-accessible NetBird Dashboard URL |
| `NETBIRD_API_TOKEN` | Secret token for a dedicated NetBird service user with the minimum peer-read permission |
| `NETBIRD_STATUS_TOKEN` | Separate secret bearer token used to protect SafeNet's bounded peer-status endpoint for physical evidence |

The API request uses `Authorization: Token …`, as documented by the NetBird
[Peers API](https://docs.netbird.io/api/resources/peers). Keep both tokens
server-side. SafeNet never returns them or the raw peer response to the browser.
When only the Dashboard is needed, its URL can be configured without exposing
NetBird management credentials to the client.

The SafeNet Dashboard shows the API reachability and peer count and opens the
configured NetBird Dashboard. It does not enroll devices, change NetBird
policy, create peers, or act as a NetBird VPN client.

## Android mesh proof

Install the official NetBird Android client from
[Google Play](https://play.google.com/store/apps/details?id=io.netbird.client)
on a physical device. Configure it with this self-hosted management URL, enroll
the device, and connect to an approved peer. The official Android package ID is
`io.netbird.client`.

For a release evidence run, configure the variables in
[`docs/netbird-verification.env.example`](../../docs/netbird-verification.env.example)
in the protected runner environment. The evidence script fails closed unless
it can confirm the enrolled peer through the NetBird API and SafeNet's
token-protected adapter, the real VPN route, and a successful probe to the
approved peer. An emulator or SafeNet's own DNS VPN is not mesh proof.

Run locally on the physical-device runner:

```sh
npm run netbird:android:evidence
```

## Recovery evidence

Use [`docs/netbird-restore-evidence.md`](../../docs/netbird-restore-evidence.md)
to record a host-replacement drill. A copied archive or a healthy Dashboard is
not sufficient: verify restored peer identities through the API and repeat the
physical Android route and approved-peer probe before recording recovery as
successful.