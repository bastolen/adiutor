# 0015. Spend CI minutes only on untested code

- **Status:** Superseded by [0043](0043-every-ci-job-runs-every-time.md)
- **Date:** 2026-11-10

## Context

The repository is private, so every Actions minute comes out of the account's monthly allowance. A
full CI run costs about 26 billed minutes, and in its first busy week CI used almost the whole
month's allowance. Most of it re-ran code that had already passed. Every merge re-ran the tests on
`main`, even when the pull request had tested exactly the code that landed: the record of a passing
run lived in the Actions cache, which never lets `main` read what a pull request saved. Release
Please's draft pull request re-ran them while `main`'s run was still going. And every merge rebased
each open Renovate pull request, including majors that couldn't pass until upstream releases
landed.

## Decision

- **Records any run of this repository can use:** a passing run records its code's fingerprint as
  an artifact (`tests-passed-<fingerprint>` in `.github/workflows/ci.yml`). A run skips the tests
  when a record for its code exists and a run of this repository's own branches made it, never a
  fork's. See [Skipping the tests](../ci-and-releases.md#skipping-the-tests).
- **The draft release pull request skips the tests:** its code is `main`'s. Marked ready for review,
  it runs every test.
- **Renovate's majors wait for approval** in the Dependency Dashboard (`renovate.json5`), and
  Next.js and React minors join the weekly non-major pull request.
- **Description-only edits skip the PR title check** (`.github/workflows/pr-title.yml`).

## Consequences

- Merging a pull request that's up to date with `main` costs a few minutes instead of a full run.
  Merging one that fell behind still runs everything on `main`.
- Anyone who can push a branch here could upload a fake record. They could already change the
  workflow their own pull request runs, so this gives them nothing new; forks are ignored.
- Majors need a tick in the dashboard before they arrive.

## Alternatives considered

- **No tests on pushes to `main`.** Cheaper still, but nothing would catch two pull requests that
  only break together.
- **Requiring branches to be up to date before merging.** That would guarantee `main` gets the
  tested code, but Renovate would then rebase every open pull request after each merge, and each
  rebase is a full run.
- **Making the repository public**, where standard runners are free. Possible later; it's a
  product decision, not a CI one.
