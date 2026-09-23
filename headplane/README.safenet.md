# SafeNet Headplane companion service

This directory contains a vendored snapshot of the upstream Headplane project:

- Repository: https://github.com/tale/headplane
- Upstream version: `0.7.1`
- Snapshot commit: `72ea6aa0b3b713ac3c23b4978e3e259d1ad1fd2f`
- License: MIT, preserved in `headplane/LICENSE`

The published `restty` package is blocked by the workspace package firewall, so
the optional Headplane browser-SSH terminal uses a locally built MIT-licensed
snapshot under `headplane/vendor/restty`. Its build source is pinned in the
workspace setup history and its package exports remain unchanged.

Headplane stays isolated from SafeNet's Express/Vite application. It is a
separate React Router/Node service that talks directly to Headscale and stores
its own session/database state.

## Local setup

Headplane requires Node.js 24 and pnpm:

```sh
npm run headplane:install
```

Set these environment variables before starting it:

```text
HEADSCALE_URL=https://headscale.example.com
HEADSCALE_API_KEY=<headscale-api-key>
HEADPLANE_COOKIE_SECRET=<exactly-32-character-secret>
HEADPLANE_URL=https://headplane.example.com/admin
```

Optional values:

```text
HEADPLANE_PORT=3000
HEADPLANE_BASE_URL=https://headplane.example.com
HEADPLANE_COOKIE_SECURE=true
HEADPLANE_DATA_PATH=headplane/.runtime/data
```

The root launcher generates `headplane/.runtime/config.yaml` from these
variables. The generated file is ignored and written with owner-only
permissions, so credentials are not committed to the repository.

Run the companion service in development:

```sh
npm run headplane:dev
```

Build and run the production bundle:

```sh
npm run headplane:build
npm run headplane:start
```

The Headplane UI is served at `/admin`. SafeNet's `HEADPLANE_URL` should point
to that UI path so the Dashboard opens the correct route.

Advanced Headplane features such as DNS editing and automatic Headscale
configuration require Headplane and Headscale to share the relevant
configuration files and, for Docker integration, a carefully restricted Docker
socket. The SafeNet launcher deliberately leaves those integrations disabled.