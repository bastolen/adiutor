# 0043. Every CI job runs every time

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

[Decision 0015](0015-spend-ci-minutes-only-on-untested-code.md) let a run skip the tests when a
passing run had recorded the same code, and
[decision 0039](0039-static-checks-follow-the-tests-on-main.md) let `main` skip the static checks
along with them, because the repository was private and every Actions minute came out of a monthly
allowance. That took the most intricate job in CI (a fingerprint of the code, a lookup of records
through the Artifacts API, a rule for Release Please's draft), a record from every passing run, and
left `main` without an audit after most merges. The repository is public now, and GitHub's
standard runners cost a public repository nothing.

## Decision

- **Every job runs on every pull request and every push to `main`**, Release Please's draft
  included (`.github/workflows/ci.yml`). **CI passed** passes only when each of them passed. See
  [CI](../ci-and-releases.md#ci).
- **The Docker image's arm64 half builds on GitHub's Arm runner**, also free here, instead of
  under emulation (`.github/workflows/docker.yml`, see
  [Docker image](../ci-and-releases.md#docker-image)).
- **Renovate opens its majors itself**, without waiting for a tick in the Dependency Dashboard, and
  Next.js and React get a pull request of their own again for every kind of update
  (`renovate.json5`). Both rules of 0015 only saved runs.
- **Kept from 0015:** edits that leave a pull request's title alone skip the title check. They check
  nothing, so skipping them loses nothing.

## Consequences

- `main` runs everything again after each merge, so it catches two pull requests that only break
  together and audits the dependencies every time. Nobody waits for that run.
- No run depends on another's record, so there are no records to trust, expire or keep from forks.
- Should the repository become private again, this needs deciding anew.

## Alternatives considered

- **Keeping the skipping for speed.** It saves a run after a merge that nobody waits for, at the
  cost of the job that's hardest to follow.
- **Emulating arm64 as before.** It worked, but made each release build take about 25 minutes.
