# 0056. The PR title check runs every time

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

A pull request's title becomes the commit on `main` that Release Please reads
([decision 0011](0011-squash-merged-prs-and-release-please.md)), so **Conventional Commits title**
is one of the two checks `main` requires.
[Decision 0015](0015-spend-ci-minutes-only-on-untested-code.md) had it skip edits that leave the
title alone, to save the minutes Renovate's description rewrites cost, and
[decision 0043](0043-every-ci-job-runs-every-time.md) kept that because such an edit checks
nothing.

To GitHub, though, a skipped job is a result: it counts as passed for a required check, and it
becomes the check's latest result on the pull request's head commit. A title that failed, followed
by an edit of only the description (screenshots dragged in, say), showed the required check as
passed, so the bad title could be squash-merged onto `main`. The pull request's checks also showed
the title check as "skipping", which looked like something was wrong. The repository is public, so
the runs cost nothing.

## Decision

- **The title check runs on every event it listens to**: a pull request opened or reopened, every
  edit, whatever it changed, and every new commit (`.github/workflows/pr-title.yml`). The job has
  no condition.
- **One concurrency group per pull request**: a newer check checks the same title or a newer one,
  so it cancels an older one that's still running. The group of its own for edits that left the
  title alone was there only so a skipped run couldn't cancel a real check.

Details: [CI](../ci-and-releases.md#ci).

## Consequences

- The latest result of the check is always a check of the pull request's current title, so a
  failing title stays failing until the title is fixed.
- Every description edit, Renovate's included, starts a short run (the setup and commitlint, about
  a minute). Should the repository become private again, this needs deciding anew.

## Alternatives considered

- **Keeping the skip.** It saves a short run per description edit and keeps the hole above.
- **Skipping only edits that follow a passing check.** The workflow would have to look up the
  previous result through the API, which costs about as much as checking the title again.
