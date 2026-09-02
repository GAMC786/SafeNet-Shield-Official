# APK scanning catalog

SafeNet's APK scanner is an offline, signature-based safety check. It is not a
replacement for Google Play Protect, a sandbox, or a full antivirus engine.
Scanning happens locally and only the APK's SHA-256 and bounded ZIP content are
inspected.

## Catalog source and scope

The bundled catalog is a maintained SafeNet catalog. Hash indicators are
intended to be synchronized from the [MalwareBazaar
feed](https://bazaar.abuse.ch/); family entries in this repository are
synthetic regression markers, not live malware samples. The catalog includes
the EICAR test string, representative Android family fixtures, and SHA-256
indicators. A catalog match is a block decision; no match must not be treated
as proof that an APK is safe.

Every catalog has a version, generation time, source, and UTC expiry. The
scanner refuses expired catalogs, including after an app restart.

## Authenticated updates

Updates use a signed envelope:

```json
{
  "algorithm": "SHA256withRSA",
  "payload": "{\"schemaVersion\":1,\"version\":\"2026.09.03.1\",...}",
  "signature": "<base64 RSA signature>"
}
```

The signature covers the exact UTF-8 payload string. SafeNet embeds the
corresponding public key; the private signing key must remain in the catalog
release system and must never be shipped in the app or committed to this
repository. The Android client verifies the signature, schema, timestamps,
expiry, and monotonic generation time before replacing its catalog. Invalid,
expired, and rollback updates are rejected without changing the active
catalog. An expired downloaded catalog is deleted and the valid bundled
catalog is used; if neither is valid, scanning is disabled.

For a release operator with the private key, create an envelope with:

```sh
node scripts/sign-apk-signature-update.mjs catalog.json signed-update.json private-key.pem
```

The signed envelope is delivered to the Android bridge's
`updateApkSignatures({ signedUpdate })` method. Delivery may use the
maintainer's authenticated HTTPS channel, but transport authentication does
not replace the embedded signature check.

The Antivirus screen reports the active version, source, expiry, whether the
bundled or authenticated catalog is active, and the last update health state.