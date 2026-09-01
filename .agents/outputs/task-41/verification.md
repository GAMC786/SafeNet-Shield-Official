# Scheduled DNS alert history verification

Date: 2026-09-01 02:55 UTC

## Local checks

- `npm test -- server/public-dns-alert-workflow.test.ts` — passed, including all 9 DNS alert workflow tests.
- `npm run check` — passed.

## Live GitHub checks

Target repository: [GAMC786/SafeNet-Shield-Official](https://github.com/GAMC786/SafeNet-Shield-Official)

- The repository API responded successfully and reports `main` as the default branch.
- The live workflow run query for `event=schedule` returned zero runs.
- The live issue query for the `maintainer-alert` label returned zero issues.
- The live `main` branch is still at `0da8daa5dad61447642dccf55bbbe3ea46f7fe17`, before the scheduled DNS alert workflow changes.
- The checked-out implementation is at `e26e4cc` on `fix-vpn-release-signing`; its remote tracking branch still points at the earlier `3543bb5` commit.
- The referenced `SafeNetInc/SafeNet-DNS` repository does not exist for the connected GitHub account.

## Why the requested live lifecycle could not be completed

The alert and recovery steps intentionally require `github.event_name == 'schedule'`. GitHub's manual dispatch API produces a `workflow_dispatch` run, so dispatching the workflow now would skip both steps and would not be evidence for the scheduled path. Creating an issue manually or changing the schedule to manufacture a run would also not verify the requested failure-to-recovery behavior.

The live verification remains blocked until the implementation is merged into the default branch and GitHub produces a scheduled run that exercises the failure path, followed by a later scheduled success run.

Useful live links:

- [Actions history](https://github.com/GAMC786/SafeNet-Shield-Official/actions)
- [Maintainer-alert issues](https://github.com/GAMC786/SafeNet-Shield-Official/issues?q=is%3Aissue+label%3Amaintainer-alert)