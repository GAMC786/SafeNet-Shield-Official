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

## Backup and host-replacement restore drill

Persistent mounts are not recovery evidence by themselves. Run this drill at
least once before relying on a host replacement, and repeat it after changing
the host image, Headscale version, or backup provider. Use the operator's
approved encrypted storage system; the example below uses `restic` only as the
storage client and assumes its repository credentials are already configured
outside this repository.

### 1. Capture bounded identity evidence

Before stopping the services, record the Android node and the separately
approved peer from the authenticated Headscale API. Keep only the public
identity fields below in a private, access-controlled manifest. Do not save
the API response, bearer token, machine key, or any private key:

```text
android_node_name=safenet-phone
android_node_id=<Headscale node ID>
android_node_public_key=<public node key>
approved_peer_name=<always-on peer name>
approved_peer_id=<Headscale peer ID>
approved_peer_public_key=<public peer key>
approved_peer_address=<registered peer address>
```

The operator should obtain the values from the authenticated
`GET /api/v1/node` response and write the seven-line file to a private path
such as `/var/lib/safenet-headscale/restore-identity.env`. The node name,
owner, online state, peer route, and peer ping must also be captured by the
existing Android mesh evidence command after the restore; the manifest alone
does not prove that the mesh is usable.

### 2. Create and store the backup

Set `BUNDLE_ROOT` to the directory containing this compose file. Stop all
three services so SQLite WAL state and Caddy certificate updates are
quiescent, then create and checksum an archive:

```sh
export BUNDLE_ROOT=/srv/safenet-headscale
export IDENTITY_MANIFEST=/var/lib/safenet-headscale/restore-identity.env
export BACKUP_DIR=/var/lib/safenet-headscale/backups/$(date -u +%Y%m%dT%H%M%SZ)

cd "$BUNDLE_ROOT"
docker compose stop caddy headplane headscale
mkdir -p "$BACKUP_DIR"
cp "$IDENTITY_MANIFEST" "$BACKUP_DIR/restore-identity.env"
bash ./backup-restore-check.sh create \
  --source "$BUNDLE_ROOT" \
  --output "$BACKUP_DIR/safenet-headscale-state.tar.gz" \
  --identity "$IDENTITY_MANIFEST" \
  --result "$BACKUP_DIR/create-result.txt"
docker compose up -d
```

Upload the archive, its `.sha256` file, and `create-result.txt` to the
operator's encrypted storage system. For example, with an already configured
`restic` repository:

```sh
restic backup "$BACKUP_DIR" --tag safenet-headscale-state
restic snapshots --tag safenet-headscale-state
```

Record the resulting storage snapshot ID and archive SHA-256 in
`docs/headscale-restore-evidence.md`. The backup must contain exactly these
runtime state areas: `headscale/lib`, `headplane/data`, and `caddy/data`.
The tracked compose/config files are restored from the release or deployment
commit, not from an unreviewed backup. Never put the `secrets/` directory or
the private `.env` file in the archive.

### 3. Restore into a disposable replacement host

Provision a clean Linux host with the same Docker/Podman Compose support,
firewall rules, DNS names, and the exact deployment commit. Do not point
production DNS at it yet. Retrieve the archive and checksum from the
operator's storage system, then restore into a new, empty bundle root:

```sh
restic restore <snapshot-id> --target /var/tmp/safenet-headscale-restore
mkdir -p /srv/safenet-headscale-replacement/backups
cp /var/tmp/safenet-headscale-restore/var/lib/safenet-headscale/backups/<timestamp>/* \
  /srv/safenet-headscale-replacement/backups/

cd /srv/safenet-headscale-replacement
bash ./backup-restore-check.sh restore-check \
  --archive /srv/safenet-headscale-replacement/backups/safenet-headscale-state.tar.gz \
  --identity /srv/safenet-headscale-replacement/backups/restore-identity.env \
  --target /srv/safenet-headscale-replacement/restored-state \
  --result /srv/safenet-headscale-replacement/backups/restore-result.txt
```

Copy the verified `headscale/lib`, `headplane/data`, and `caddy/data`
directories into the replacement bundle root only after the check passes.
For example:

```sh
cp -a restored-state/headscale/lib/. headscale/lib/
cp -a restored-state/headplane/data/. headplane/data/
cp -a restored-state/caddy/data/. caddy/data/
```

Recreate the ignored config and secret files from the reviewed deployment
commit and the operator secret store. The checker refuses a non-empty target,
validates the archive checksum, rejects unsafe archive paths, and confirms the
Headscale, Headplane, Caddy, Android-node, and approved-peer state markers.

Start the replacement stack and verify the public endpoints before changing
DNS:

```sh
cd /srv/safenet-headscale-replacement
docker compose config >/tmp/safenet-headscale-replacement.compose.yaml
docker compose up -d
curl --fail-with-body "https://${HEADSCALE_DOMAIN}/health"
curl --fail-with-body "https://${HEADPLANE_DOMAIN}/healthz"
```

### 4. Prove the identities and mesh survived

Using the replacement host's newly issued read-only verification credentials,
compare the authenticated `/api/v1/node` records with the pre-replacement
manifest. The Android node must have the same Headscale node ID, name, public
node key, owner `safenet`, and online state. The approved peer must have the
same node ID and public node key and contain the recorded mesh address. Do not
approve a newly registered node as a substitute: a changed identity means the
restore failed.

The comparison can be made without retaining the raw API response:

```sh
bash ./verify-restored-identities.sh \
  --url "https://${HEADSCALE_DOMAIN}" \
  --api-key-file /var/lib/safenet-headscale/restore-verification-api-key \
  --identity backups/restore-identity.env \
  --result backups/live-identity-result.txt
```

The command writes only bounded field-level PASS/FAIL values and removes its
temporary API response. A live `result=PASS` is required before continuing.

After the replacement control plane is reachable, run the physical Android
proof with the same Android installation and the same approved peer:

```sh
HEADSCALE_ANDROID_LOGIN_SERVER_CONFIRMED=pass \
HEADSCALE_PERSISTENT_STATE_CONFIRMED=pass \
npm run headscale:android:evidence -- \
  --serial <physical-device-serial> \
  --output android/app/build/reports/headscale-android-mesh/restore-<timestamp>
```

The restore drill is `PASS` only when the archive check passes, both
identities match, Headplane reports the original Android node as visible and
online, the Android client still uses the same login server, the VPN route
uses the mesh interface, and the real ping to the approved peer succeeds.
Record the bounded result file and the before/after API identity comparison;
do not retain raw API responses, tokens, or private keys.

### 5. Rotate credentials after a host replacement

If the old host may have been accessed, or its disk/backup was exposed,
rotate the Headscale API key used by Headplane and SafeNet, replace the
Headplane cookie secret, and rotate any host/provider credentials according
to the operator's policy. Revoke the old API key after the replacement is
healthy. A cookie-secret change logs Headplane users out. Do not rotate
Headscale's noise private key during an ordinary restore: changing it would
change the control-plane identity and can invalidate the mesh. Expired
pre-auth keys are not restored credentials; issue a new short-lived key only
when enrolling a genuinely new node.

Use the evidence template in `docs/headscale-restore-evidence.md` and retain
the operator storage snapshot ID, archive digest, restore-check result, live
identity comparison, and Android mesh result for the drill.

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