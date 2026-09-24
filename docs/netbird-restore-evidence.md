# NetBird host-replacement recovery evidence

Use this template for a recovery drill on the separately hosted NetBird
deployment. Do not include API tokens, setup keys, private keys, raw API
responses, or user credentials in the evidence.

```text
drill_started_utc=
drill_completed_utc=
source_host_reference=
replacement_host_reference=
netbird_version_before=
netbird_version_after=
backup_reference=
backup_checksum=
encrypted_backup_confirmed=pass|fail
generated_configuration_restored=pass|fail
all_declared_persistent_volumes_restored=pass|fail
management_api_reachable=pass|fail
dashboard_reachable=pass|fail
android_peer_id_before=
android_peer_id_after=
approved_peer_id_before=
approved_peer_id_after=
peer_identities_match=pass|fail
android_client_package=io.netbird.client
physical_device_confirmed=pass|fail
android_peer_connected=pass|fail
vpn_route_confirmed=pass|fail
approved_peer_probe=pass|fail
result=PASS|BLOCKED|FAIL
blocker=
```

Before the drill, record only the peer IDs needed for comparison from the
authenticated NetBird API. Back up the exact generated Compose configuration
and every persistent data volume/bind mount used by that deployment. Use the
official NetBird maintenance documentation for the installed version; do not
assume a volume name or database layout from another release.

After restoration, check that the management API and Dashboard are available,
the Android and approved-peer IDs match, and the peer remains connected. Then
run `npm run netbird:android:evidence` from the physical-device runner to prove
the NetBird VPN route and a real peer probe. Mark the result `BLOCKED` if the
external host, credentials, physical device, or approved peer is unavailable.