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
