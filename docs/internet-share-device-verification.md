# Internet Share two-device verification

This runbook is for validating the Android-only Internet Share flow with two
real Android devices. A hosted browser check or a single emulator cannot prove
Wi-Fi Direct discovery, peer authentication, proxy routing, or disconnect
updates.

## Prerequisites

- A SafeNet Android build installed on the sharing phone.
- A second Android phone or tablet with Wi-Fi enabled.
- The sharing phone has working Wi-Fi or mobile data before the test starts.
- Record the build version and both device models in the test notes. Do not
  record the displayed Wi-Fi passphrase in a shared report.

## Test procedure

1. On the sharing phone, open **Internet Share** and grant the requested
   Nearby Wi-Fi permission. On Android versions that require it, grant the
   location permission used for Wi-Fi Direct.
2. Tap **Start sharing**. Confirm the screen reaches **Broadcasting** without
   an error and shows a network name, passphrase, proxy host, and proxy port.
   The expected proxy defaults are `192.168.49.1:8080`; use the values shown
   by the app if the device reports different values.
3. On the second device, open Wi-Fi settings, select the displayed network,
   and authenticate with the displayed passphrase. Confirm the sharing phone
   shows the peer name and address under **Connected devices**.
4. Configure a manual proxy for that Wi-Fi connection using the displayed
   proxy host and port. Verify both:
   - An ordinary HTTP page loads through the proxy.
   - An HTTPS page loads through the same proxy. This exercises the
     `CONNECT` tunnel; the page must remain end-to-end encrypted.
5. Disconnect the second device from the Wi-Fi Direct network. Within the
   next status refresh, confirm its entry disappears and the connected count
   returns to zero.
6. Tap **Stop sharing** on the sharing phone. Confirm the screen returns to
   the stopped state, the proxy no longer accepts connections, and the Wi-Fi
   Direct group disappears from the second device.
7. Repeat steps 1–6 with SafeNet VPN enabled on the sharing phone. Confirm:
   - Internet Share still starts and stops cleanly.
   - The second device can still use HTTP and HTTPS through the displayed
     proxy.
   - SafeNet VPN protection remains active on the sharing phone.
   - Stopping either feature does not leave the other feature reporting a
     stale running state.

## Evidence to capture

| Check | Evidence |
| --- | --- |
| Start/stop lifecycle | Screenshots or screen recording of stopped, broadcasting, and stopped states |
| Peer discovery and authentication | Screenshot of the network name/passphrase on the sharing phone and the peer in Connected devices |
| HTTP forwarding | URL and successful response observed on the second device |
| HTTPS CONNECT forwarding | HTTPS URL and successful response observed on the second device |
| Disconnect handling | Before/after Connected devices screenshots with timestamps |
| VPN interaction | VPN status plus Internet Share status while both are enabled |

## Workspace verification boundary

The cloud workspace can run the web and source-contract tests, but it does not
have an Android SDK, an attached Android target, or a KVM-backed emulator.
Those checks do not substitute for the two-device procedure above. Until a
physical-device runner supplies the evidence table, the end-to-end status is
**not verified**.