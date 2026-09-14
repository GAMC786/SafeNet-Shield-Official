# ClamAV REST deployment contract

SafeNet keeps the ClamAV REST URL on the server. Configure the deployment
environment variable `CLAMAV_REST_URL` with the HTTPS URL of a managed
ClamAV REST service. Do not put this URL or service credentials in client
code. The URL must not contain embedded credentials.

The service must expose these same-origin endpoints:

## `GET /health`

Return a successful HTTP response when the service and its ClamAV engine are
ready. JSON is preferred:

```json
{ "status": "ok", "version": "1.2.3" }
```

Plain text health responses are also accepted. SafeNet displays the optional
`version` or `clamav_version` value in the antivirus page.

## `POST /scan`

Accept a file as an `application/octet-stream` request body and return either
JSON or plain text. A JSON response should identify the verdict with
`infected` (or `is_infected`) and may include `viruses`, for example:

```json
{ "infected": false, "message": "OK" }
```

```json
{ "infected": true, "viruses": ["Eicar-Test-Signature"] }
```

SafeNet's **Verify engine** action calls `/health`, scans a clean fixture, and
scans the standard EICAR test signature. The engine is not marked verified and
the protected scan route remains unavailable unless all three checks pass.