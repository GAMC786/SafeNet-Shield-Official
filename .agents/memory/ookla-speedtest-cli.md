---
name: Ookla Speedtest CLI integration
description: SafeNet's server-side Ookla measurement depends on an official binary and its usage terms.
---

The official Ookla CLI is not available in the Replit system package index. The supported setup downloads the official architecture-specific Debian package from Ookla's package repository and extracts the binary at startup; `SPEEDTEST_CLI_PATH` can override that path.

**Why:** The CLI is the requested measurement engine, but silently falling back to a browser implementation would change the product behavior. The CLI also reports a personal/non-commercial-use restriction, which must be reviewed before publishing a commercial SafeNet deployment.

**How to apply:** Keep the binary setup explicit and fail the API clearly when the CLI is unavailable. Confirm Ookla authorization or licensing before using this integration in a published commercial environment.