# CI, releases and dependencies

What CI checks, how `main` is protected, how security advisories and actions are handled, how
releases are published and how dependencies are kept up to date. Back to the
[documentation](README.md).

## CI

CI (`.github/workflows/ci.yml`) runs on every pull request and push to `main`, as jobs that run at
the same time, with test-only auth settings. Its token is read-only, and checkout doesn't keep it in
`.git`. Each job starts with the same setup, a local action (`.github/actions/setup/action.yml`,
which the PR title check uses too): pnpm, Node from `.nvmrc` with pnpm's store cached, and
`pnpm install --frozen-lockfile`.

| Job                           | What it runs                                                                                        | Database   |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | ---------- |
| Static checks                 | the schema checks below, `pnpm audit --prod`, lint, format check and type-check                     | none       |
| Unit tests                    | `pnpm test`                                                                                         | none       |
| Integration tests             | `pnpm test:integration`, then the migrations applied to a fresh database                            | PostgreSQL |
| End-to-end tests (1/2), (2/2) | a production build, then half the specs each (`pnpm test:e2e --shard=1/2`), with a report per shard | PostgreSQL |
| CI passed                     | fails when any other job failed or was cancelled, and records a run where every test passed         | none       |

**CI passed** is the one check protecting `main` requires (see [Protecting main](#protecting-main)),
so jobs and shards can change without touching the rules. Each job has its own time limit (15 to 30
minutes), so a hung step can't hold a runner for GitHub's default of 6 hours.

The end-to-end specs run in two shards, split by spec file, so a file whose tests build on each other
(like `e2e/security.spec.ts`) stays together. Each shard has its own PostgreSQL service, which the
Playwright global setup migrates and seeds, and makes its own production build. That build starts
warm from Next's build cache (`.next/cache`), following
[Next's CI guide](https://nextjs.org/docs/app/guides/ci-build-caching): keyed on the lockfile and
the app's own files (`src/`, `public/`, `next.config.ts`, `tsconfig.json`). Both shards restore it,
and the first saves a new entry when the source changed. Pull requests start from `main`'s cache and
only write their own. Each shard then downloads only Playwright's Chromium, without `--with-deps`:
the runner image ships Google Chrome, so the libraries Chromium needs are already installed, and
installing them again with `apt-get` would fail whenever Ubuntu's package servers can't be reached.

### Skipping the tests

The static checks always run. The unit, integration and end-to-end tests only run for code that
hasn't passed them yet, and **CI passed** counts the skipped jobs as passed.

- **The fingerprint:** the first job (Decide what runs) hashes every tracked file and its content
  (`git ls-tree -r HEAD`; on a pull request, GitHub's merge commit with `main`, so the code as it
  would land). It leaves out the files no test reads: `docs/`, every Markdown file, `LICENSE`,
  `.github/ISSUE_TEMPLATE/`, `.github/CODEOWNERS`, `.github/dependabot.yml`, `.github/rulesets/`,
  `renovate.json5`, `commitlint.config.mjs`, `.vscode/`, `.claude/`, `vercel.json`,
  `.release-please-manifest.json` and `release-please-config.json`. `package.json` counts without
  its `version`, which nothing in the app or its tests reads. Workflows and the local actions count,
  so a change to CI always runs the tests.
- **The record:** after a run where every test job ran and passed, **CI passed** uploads a small
  artifact named `tests-passed-<fingerprint>`. A failed, cancelled or skipped run uploads nothing.
  The first job looks the name up through GitHub's Artifacts API and skips the tests when a record
  counts (below). If the API can't answer, the tests run.
- **What that skips:**
  - `main`'s run after merging a pull request whose last run was against the current `main`: the
    squash merge lands exactly the code that pull request tested. A merge of a pull request that
    fell behind `main` runs the tests on `main`.
  - a change to docs or repository settings, once `main`'s code passed;
  - a re-run of code that passed;
  - the release commit that merging the release pull request puts on `main`.
    When nothing recorded a pass of `main`'s code (its last run failed or was cancelled), the next
    run of that code runs the tests.
- **The draft release pull request** never runs the tests. Its code is `main`'s, plus the
  changelog and version the fingerprint leaves out, and a draft can't be merged. Marked ready for
  review, it runs every test.
- **Who can use a record:** only records made by runs of this repository's own branches: `main`
  and pull requests from branches here. A fork's pull request runs its own copy of the workflow and
  could upload anything, so its records are ignored. It can still skip the tests when its code
  matches a record made here. Records expire after 7 days, and the tests then run again. The
  fingerprint starts with a scheme number, which changes when the list of files left out does.

**PR titles** (`.github/workflows/pr-title.yml`): a squash merge lands on `main` with the pull
request's title, and Release Please reads it, but the commit-msg hook never sees it. So every pull
request's title is checked with the same commitlint rules (`commitlint.config.mjs`) when it's
opened, when its title is edited and on every new commit. An edit that leaves the title alone (a
new description, which Renovate writes on every update) skips the check: the job doesn't start a
runner, and GitHub counts a skipped job as passed. Renovate's and Release Please's titles
(`chore(deps): …`, `fix(deps): …`, `chore(main): release …`) already pass. Dependabot's
(`ci(deps): bump …`) are skipped: Dependabot doesn't let us choose them, its group wording ("… in the
github-actions group across 1 directory") can run past the 100-character limit, and their `ci` type
keeps them out of the release notes anyway. Its check, **Conventional Commits title**, is the other
one protecting `main` requires.

The static checks start by checking that the database schema and the committed migrations agree:
`pnpm auth:schema` must leave `src/db/schema/auth.ts` unchanged (Better Auth's tables match its
config), and `pnpm db:generate` must write nothing in `drizzle/` (the migrations match
`src/db/schema/`). Otherwise a schema-only unique index, constraint, default or `onDelete` change
would pass CI and never reach the database. If either fails, run the same commands locally
(`pnpm auth:schema` first after changing Better Auth's config, then `pnpm db:generate`) and
commit what they change. drizzle-kit asks about ambiguous renames, which CI can't answer, so
generate such a migration locally.

## Protecting main

`.github/rulesets/main.json` holds the rules for `main`, and the ruleset on GitHub is made from it.
GitHub enforces rulesets on a private repository only with GitHub Pro (or Team), which this
account has. The file is strict JSON (no comments) in the format GitHub's ruleset import and API
take, so this section explains it:

- `main` (the default branch, `~DEFAULT_BRANCH`) can't be deleted or force-pushed, and its history
  stays linear.
- Changes arrive through a pull request, merged by squashing only, with every conversation
  resolved. No approval is required: GitHub doesn't let you approve your own pull request, so with
  one maintainer a required approval would block every merge.
- **CI passed** and **Conventional Commits title** must pass, and both must come from GitHub Actions
  (`integration_id` 15368, the app that reports this repository's checks). A branch doesn't have
  to be up to date with `main` first, so Renovate's pull requests don't need a rebase and a second
  run before merging.
- Repository admins can bypass the rules (`actor_id` 5 is the admin role). That's for emergencies,
  and for the empty `Release-As` commit in [Versions](#versions), which goes straight to `main`.

To create the ruleset (once, or again in a new repository), either import the file in the
repository's Settings → Rules → Rulesets → New ruleset → Import a ruleset, check it and click
Create, or run:

```bash
gh api --method POST repos/bastolen/adiutor/rulesets --input .github/rulesets/main.json
```

If the import doesn't recognise the bypass entry, add **Repository admin** to the bypass list in
the form before creating it. After changing the file, update the ruleset on GitHub to match: find
its ID with `gh api repos/bastolen/adiutor/rulesets`, then run
`gh api --method PUT repos/bastolen/adiutor/rulesets/<id> --input .github/rulesets/main.json`.
When a job in CI is renamed, the rules don't change; only renaming **CI passed** or the PR title
check means updating the file and the ruleset.

## Protecting production

`.github/rulesets/production.json` holds the rules for the `production` branch, which Vercel
deploys as production (see [Vercel](deploying.md#vercel)), and the ruleset on GitHub is made from
it. It's strict JSON in the same format as `main.json`, so this section explains it:

- Nobody can create, update, delete or force-push `production` (`creation`, `update`, `deletion`
  and `non_fast_forward`), except the two accounts allowed through:
  - repository admins (`actor_id` 5, as in `main.json`): you, for emergencies;
  - Release Please's app, `adiutor-releases` (`Integration` 5542327, the app's ID), which
    `.github/workflows/production-branch.yml` uses to move `production` to each published release.
- So only a release, or you, can change what production serves. Pull requests, Renovate,
  Dependabot and the built-in token of any workflow can't.

To create the ruleset, import the file as above, or run:

```bash
gh api --method POST repos/bastolen/adiutor/rulesets --input .github/rulesets/production.json
```

If the import doesn't recognise the bypass entries, add **Repository admin** and the
**adiutor-releases** app to the bypass list in the form before creating it. After changing the
file, update the ruleset with `PUT`, as for `main`.

`vercel.json` also refuses to build `production` unless it points at a release commit (see
[Vercel](deploying.md#vercel)).

## Security advisories

`pnpm audit --prod` in CI fails the build on a new advisory in a
production dependency (`pnpm audit` locally checks the development ones too). An advisory that
was checked and can't be reached from the app is listed under `auditConfig.ignoreGhsas` in
`pnpm-workspace.yaml`, with why and when it goes away; remove the entry once the fix lands.

## Pinned actions

Every action is pinned to a full commit SHA with its version in a comment
(`uses: actions/checkout@<commit SHA> # vX.Y.Z`), and the PostgreSQL image to its digest, so a moved
or hijacked tag can't change what runs. Pin new actions the same way, also inside the local actions
in `.github/actions/`, which Dependabot updates along with the workflows.

## Releases

Releases (`.github/workflows/release-please.yml`): Release Please keeps a release pull request
open that bumps the version and updates `CHANGELOG.md` from the commit messages. It opens it as a
draft (`draft-pull-request` in `release-please-config.json`), which GitHub won't merge, so its
updates after every merge to `main` skip the tests when `main`'s code passed them (see [Skipping
the tests](#skipping-the-tests)). To release, mark it ready for review (`gh pr ready <number>`):
CI then runs every test on it, whatever passed before, and again on each update while it stays
ready. A release pull request is one the release app opened, from a branch in this repository whose
name starts with `release-please--`. Merge it once **CI passed** is green; that publishes a GitHub
release, and `.github/workflows/production-branch.yml` moves the `production` branch to it, which
Vercel deploys as production (see [Vercel](deploying.md#vercel)). It works as a small GitHub App instead of the workflow's own token
(which gets no access at all), so the repository doesn't have to let GitHub Actions create and
approve pull requests, and CI runs on the release pull request. To set it up once:

1. Create a GitHub App (your settings → Developer settings → GitHub Apps → New GitHub App), e.g.
   "Adiutor releases": no webhook; repository permissions **Contents**, **Pull requests** and
   **Issues**, each **Read and write** (Issues for the release pull request's labels); installable
   only on your account.
2. Install it on this repository only.
3. In the repository's Settings → Secrets and variables → Actions, add the variable
   `RELEASE_APP_CLIENT_ID` (the app's Client ID) and the secret `RELEASE_APP_PRIVATE_KEY` (a
   private key generated on the app's page: the whole `.pem` file).
4. In Settings → Actions → General, turn off "Allow GitHub Actions to create and approve pull
   requests", and set the default workflow permissions to read-only.

Until then, the workflow is skipped.

### Versions

`release-please-config.json` sets how the version moves, and `.release-please-manifest.json` holds
the last released version (Release Please updates it with every release; it starts empty). Both are
strict JSON, so they can't carry comments; this section explains them instead.

Adiutor stays below 1.0.0 until it's ready for real use. The first release is 0.1.0
(`initial-version`), and after that:

| Change on `main`                                | Next version (from 0.1.0) |
| ----------------------------------------------- | ------------------------- |
| A feature (`feat:`)                             | 0.2.0                     |
| A fix (`fix:`, including `fix(deps):`)          | 0.1.1                     |
| A breaking change (`feat!:`, `BREAKING CHANGE`) | 0.2.0                     |

A breaking change only bumps the minor version (`bump-minor-pre-major`), so 1.0.0 never happens by
accident. To release 1.0.0, push an empty commit to `main` with a `Release-As` footer, and Release
Please opens a release pull request for that version:

```bash
git commit --allow-empty -m "chore: release 1.0.0" -m "Release-As: 1.0.0"
```

Tags are `v0.1.0`, `v0.2.0` and so on, without the package name (`include-component-in-tag`). The
workflow leaves out the action's `release-type` input on purpose: with it set, the action ignores
both files.

### Docker image

Every release also publishes the Docker image (`.github/workflows/docker.yml`, built from the
`Dockerfile`; see [Docker](deploying.md#docker)) to Docker Hub as `bastolen/adiutor` and to GitHub's
container registry as `ghcr.io/bastolen/adiutor`. Release Please publishes releases with its app's
token, so they start this workflow (events made with the built-in token don't start workflows).

- **Platforms:** `linux/amd64` and `linux/arm64`. The workflow builds both on one amd64 runner, so
  the arm64 half is built under emulation and a release build takes a while (about 25 minutes).
  GitHub also has arm64 runners for private repositories, should that ever need to be faster.
- **Tags:** the version (`0.1.0`), its minor line (`0.1`, which moves to `0.1.1` when that's out)
  and `latest`. There's no `0` tag while Adiutor is below 1.0.0, since a new minor can break things.
- **What's attached:** build provenance and an SBOM (the list of what's in the image), and the
  standard labels (source, version, commit).
- **Pull requests** don't build the image; build it locally after changing the `Dockerfile`, the
  dependencies or the build.

To set it up once, before the first release:

1. On Docker Hub, create an access token (Account settings → Personal access tokens) with **Read &
   Write** access to `bastolen/adiutor`.
2. In this repository's Settings → Secrets and variables → Actions, add the variable
   `DOCKERHUB_USERNAME` (your Docker Hub username) and the secret `DOCKERHUB_TOKEN` (the token).

Without them the workflow fails, rather than finishing a release without an image. GitHub's registry
needs no setup: the workflow pushes with its own token.

To publish a release again (after a failed push, say), run the workflow by hand: Actions → Docker
image → Run workflow, with the release's tag (`v0.1.0`). That doesn't move `latest`.

**Visibility:** both images are private while the repository is. The Docker Hub repository's
visibility is set on Docker Hub. GitHub's package is linked to this repository (through the image's
source label), so it gets the repository's access, but its visibility is a separate setting that
GitHub doesn't keep in step: when you make the repository public, also make the package public (the
package's settings → Change visibility).

## Dependency updates

Weekly on Monday morning, a few days after a release at the earliest:

- Renovate (`renovate.json5`, needs the Renovate GitHub app installed on the repository) updates
  the npm packages, the container images (in the workflows and `compose.yaml`), `.nvmrc` and the
  pnpm version in `packageManager`. It uses pnpm like local development: the lockfile, that pnpm
  version and the settings in `pnpm-workspace.yaml`.
- Renovate waits 3 days after a release before proposing it (`minimumReleaseAge`), in case the
  release is pulled or compromised, and shows the wait on each pull request as the
  `renovate/stability-days` check. Image digest updates and lockfile refreshes carry no release
  date that check can read, so `renovate.json5` lets it pass for them instead of leaving it pending
  forever. Digest pull requests still wait: Renovate opens or updates them only 3 days after Docker
  Hub pushed the image. If the check stays pending on another kind of update, Renovate's job log
  (developer.mend.io) says why.
- Renovate's pull requests come in groups: all minor and patch updates together (Next.js and React
  included), and the major updates of Next.js, React and their types together.
- Major updates wait for approval: Renovate lists them under "Pending Approval" in the Dependency
  Dashboard issue and opens the pull request once you tick its box. A major often waits on the
  tools around it (typescript-eslint for TypeScript, plugins for ESLint), and an open pull request
  that can't pass yet runs CI again every time a merge changes the lockfile. Security fixes don't
  wait. Closing a pull request makes Renovate skip that version; the dashboard lists it with a box
  to open it again.
- Dependabot (`.github/dependabot.yml`, built into GitHub) updates the GitHub Actions, SHA and
  version comment together, in one pull request. Leave the repository's "Dependabot security
  updates" off, or it opens npm pull requests next to Renovate's.
