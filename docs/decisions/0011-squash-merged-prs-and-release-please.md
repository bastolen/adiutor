# 0011. Squash-merged pull requests and Release Please

- **Status:** Accepted
- **Date:** 2026-11-07 (recorded after the decision was made)

## Context

Release Please automates releases. It reads the commit messages on `main` to pick the next version
and write `CHANGELOG.md`. So what lands on `main` decides both.

## Decision

- **Squash merges only.** A squash merge turns a pull request into one commit on `main`, with the
  pull request's title as its message.
- **Conventional Commits titles.** Messages follow Conventional Commits (`feat:`, `fix:`, `feat!:`
  for a breaking change). The commit-msg hook checks commits, but never sees a squash merge, so CI
  checks every pull request's title with the same rules (**Conventional Commits title**).
- **Release Please** keeps a release pull request open with the next version and changelog.
  Merging it publishes the release.
- **Versions stay 0.x** until Adiutor is ready for real use. A breaking change only bumps the minor
  version (`bump-minor-pre-major` in `release-please-config.json`), so 1.0.0 never happens by
  accident. You choose it with an empty commit that has a `Release-As: 1.0.0` footer.
- **The ruleset for `main`** (`.github/rulesets/main.json`) allows squash merges only, requires no
  approvals, and requires two checks: **CI passed** and **Conventional Commits title**.

## Consequences

- Pull request titles describe the change for users, since they become the changelog.
- No approval is required: GitHub doesn't let you approve your own pull request, so with one
  maintainer a required approval would block every merge.
- **CI passed** stands for every CI job, so jobs and shards can change without touching the rules.
- The ruleset waits until the repository is public or upgraded: GitHub only enforces rulesets on
  private repositories with GitHub Pro or Team.
- The `Release-As` commit goes straight to `main`, through the repository admins' bypass.

Details: [Protecting main](../ci-and-releases.md#protecting-main),
[Releases](../ci-and-releases.md#releases), [Versions](../ci-and-releases.md#versions) and
[Commit messages](../../CONTRIBUTING.md#commit-messages).

## Alternatives considered

- **Merge commits.** They break the linear history the ruleset requires.
- **Rebase merges.** Every commit on a branch would land on `main` and reach the changelog.
- **Requiring each CI job as a check.** Renaming or splitting a job would mean changing the ruleset.
