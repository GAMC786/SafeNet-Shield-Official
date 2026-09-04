# Browser regression checks

The DNS and Antivirus toggle checks run with Playwright and are intentionally
separate from the Node-only suite:

```sh
npm run test:ui
```

Playwright needs its Chromium browser and the host libraries required by
Chromium. If the browser executable is missing, install it from the project
root:

```sh
npx playwright install chromium
```

On Debian or Ubuntu runners where Chromium reports missing shared libraries,
install the browser dependencies as well:

```sh
npx playwright install --with-deps chromium
```

The UI test starts its own Vite server by default. Set `UI_TEST_BASE_URL` when
running against an already-started Vite server, and set `UI_TEST_PORT` if the
default test port (`4173`) is unavailable.

## Clerk authentication smoke test

The authentication smoke test runs against a configured non-production SafeNet
deployment and uses a new isolated Playwright browser context for every run:

```sh
npm run test:auth
```

For stable CI runs, record a fixture once with a non-production Clerk account:

```sh
AUTH_SMOKE_BASE_URL=https://your-test-deployment.example.com \
  npm run test:auth:record
```

Complete Google sign-in in the browser that opens. The command writes
`.auth/safenet-auth-state.json`; this file contains a live session credential,
is ignored by Git, and must never be committed. Store its JSON contents in the
workspace/GitHub secret `AUTH_SMOKE_STORAGE_STATE` and set
`AUTH_SMOKE_BASE_URL` in the secure test configuration. The test then verifies
the authenticated Command Center and the Navigation sign-out action.

An alternative full OAuth run can use the secure variables
`AUTH_SMOKE_BASE_URL`, `AUTH_SMOKE_GOOGLE_EMAIL`, and
`AUTH_SMOKE_GOOGLE_PASSWORD` instead of a storage-state fixture. Use only a
dedicated non-production Google/Clerk test account; Google may challenge
automated logins, so the recorded fixture is the preferred CI mode.