---
name: Cloudflare hosted retry timing
description: Hosted browser checks for the Cloudflare speed-test recovery path need longer bounded waits and must allow both retry UI states.
---

Cloudflare browser recovery tests should allow up to 60 seconds for both the initial failed-probe transition and the retry completion, should accept either `Run Again` or `Resume Test`, and should keep every retry probe mocked.

**Why:** GitHub-hosted Chromium can take substantially longer than local runs to settle a failed `__down` probe. The UI may remain resumable rather than entering the terminal error state, so a 10-second wait or a `Run Again`-only assertion creates false release failures.

**How to apply:** Keep the production Cloudflare sequence unchanged. In Playwright checks, make the fixture fail a bounded number of requests and fulfill all later probes locally; use explicit waits for the alert, recovery button, and completion.