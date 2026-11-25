# 0039. The static checks follow the tests on main

- **Status:** Superseded by [0043](0043-every-ci-job-runs-every-time.md)
- **Date:** 2026-11-22

## Context

[Decision 0015](0015-spend-ci-minutes-only-on-untested-code.md) lets a run skip the tests when a
passing run recorded the same code, so `main` doesn't test again what a pull request just tested.
The static checks (the schema checks, `pnpm audit --prod`, lint, format check and type-check) were
left out of it and ran on every push to `main`: about four and a half minutes after each merge, for
code the pull request had already checked.

## Decision

- **Pull requests run the static checks every time.** They also check what the tests' fingerprint
  leaves out, like the formatting of docs and Markdown, and audit the dependencies.
- **On `main` they run only when the tests do** (the `checks` job in `.github/workflows/ci.yml`).
  A record of a passing run is made only when every job passed, the static checks included, so code
  that skips the tests on `main` passed them already. A pull request that fell behind `main` still
  runs both there. See [Skipping the tests](../ci-and-releases.md#skipping-the-tests).

## Consequences

- Merging a pull request that's up to date with `main` costs only the first job and **CI passed**.
- `main` no longer audits the dependencies after such a merge. A new advisory shows up at the next
  pull request, or when Dependabot or Renovate raise it.
- On a pull request the static checks start once the first job has decided, about half a minute
  later. The run takes as long as before, since the end-to-end tests take longest.

## Alternatives considered

- **No CI on pushes to `main`.** Nothing would catch two pull requests that only break together.
- **A record of its own for the static checks**, keyed on every file. It would skip them on more
  runs, at the cost of a second record and its lookup, for a job that takes a few minutes.
