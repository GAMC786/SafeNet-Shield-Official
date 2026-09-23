# Headscale restore drill evidence

Complete one copy for each disposable host-replacement drill. This template
contains identifiers and digests only; never attach API responses, bearer
tokens, cookie secrets, private keys, or the backup archive itself.

## Run metadata

- **Result:** `PASS` / `BLOCKED` / `FAIL`
- **Run date (UTC):**
- **Source host:**
- **Replacement host:**
- **Deployment commit and image versions:**
- **Operator storage system:**
- **Storage snapshot ID:**
- **Archive SHA-256:**
- **Archive checksum verification:** `PASS` / `FAIL`
- **Restore checker result:** `PASS` / `FAIL`

## Persistent state restored

| State | Backup | Restored | Evidence |
| --- | --- | --- | --- |
| `headscale/lib` | `PASS` / `FAIL` | `PASS` / `FAIL` | SQLite/noise/DERP state present |
| `headplane/data` | `PASS` / `FAIL` | `PASS` / `FAIL` | Headplane data present |
| `caddy/data` | `PASS` / `FAIL` | `PASS` / `FAIL` | Certificate data present |

## Identity comparison

Record values or short digests, never raw API responses.

| Field | Before | After | Match |
| --- | --- | --- | --- |
| Android node name | | | `PASS` / `FAIL` |
| Android Headscale node ID | | | `PASS` / `FAIL` |
| Android public node-key digest | | | `PASS` / `FAIL` |
| Android owner | `safenet` | | `PASS` / `FAIL` |
| Approved peer name | | | `PASS` / `FAIL` |
| Approved peer Headscale node ID | | | `PASS` / `FAIL` |
| Approved peer public node-key digest | | | `PASS` / `FAIL` |
| Approved peer address | | | `PASS` / `FAIL` |

## Live mesh proof

- **Headscale health:** `PASS` / `FAIL`
- **Headplane health:** `PASS` / `FAIL`
- **Android login-server confirmation:** `PASS` / `FAIL`
- **Headplane Android node visible and online:** `PASS` / `FAIL`
- **Android client package/build:**
- **VPN interface and route:** `PASS` / `FAIL`
- **Approved peer ping:** `PASS` / `FAIL`
- **Evidence result path:**
- **Evidence SHA-256:**

The drill cannot be marked `PASS` from archive recovery alone. The original
Android node and approved peer must match and the physical mesh proof must
pass after the replacement starts.

## Secret rotation

- **Headscale API key rotated:** `YES` / `NO` / `NOT_REQUIRED`
- **Old Headscale API key revoked:** `YES` / `NO` / `NOT_REQUIRED`
- **Headplane cookie secret rotated:** `YES` / `NO` / `NOT_REQUIRED`
- **Other host/provider credentials rotated:**
- **Reason rotation was or was not required:**

## Operator notes

- **DNS cutover performed:** `YES` / `NO`
- **Rollback point:**
- **Unexpected findings:**