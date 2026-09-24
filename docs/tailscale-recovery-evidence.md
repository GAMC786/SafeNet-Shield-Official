# Tailscale tailnet and device recovery evidence

Use this template for a recovery drill involving the hosted Tailscale
tailnet. Tailscale's control plane is operated by Tailscale: there is no
customer-managed Compose stack, management VM, or control-plane volume to
restore. Do not include OAuth client secrets, access tokens, auth keys, raw API
responses, private keys, or user credentials in the evidence.

```text
drill_started_utc=
drill_completed_utc=
tailnet_reference=
administrator_reference=
trust_credential_reference=
credential_rotation_confirmed=pass|fail
tailnet_access_restored=pass|fail
tailnet_policy_reviewed=pass|fail
android_device_id_before=
android_device_id_after=
approved_peer_id_before=
approved_peer_id_after=
device_identities_match=pass|fail
android_client_package=com.tailscale.ipn
physical_device_confirmed=pass|fail
android_tailnet_confirmed=pass|fail
android_device_connected=pass|fail
vpn_route_confirmed=pass|fail
approved_peer_probe=pass|fail
result=PASS|BLOCKED|FAIL
blocker=
```

Before the drill, record only the tailnet and device identifiers needed for
comparison. Confirm that administrators can access the Tailscale console,
rotate the SafeNet OAuth credential if required, and review device
authorization and ACL policy.

After recovery, confirm the Android device and approved peer are the expected
devices and are connected. Run
`npm run tailscale:android:evidence` from the physical-device runner to prove
the real Tailscale VPN route and approved-peer probe. Mark the result
`BLOCKED` if the Tailscale account, credential, physical device, or approved
peer is unavailable. A healthy admin console or API response alone is not
proof of Android mesh connectivity.