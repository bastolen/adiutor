# CI, releases and dependencies

What CI checks, how security advisories and actions are handled, how releases are published and
how dependencies are kept up to date. Back to the [documentation](README.md).

## CI

CI (`.github/workflows/ci.yml`) runs an audit of the production dependencies, lint, format
check, type-check, unit and integration tests, build and end-to-end tests on every pull request
and push to `main`, with a PostgreSQL service and test-only auth settings. Its token is read-only,
and checkout doesn't keep it in `.git`.

It keeps Next's build cache (`.next/cache`) between runs, following
[Next's CI guide](https://nextjs.org/docs/app/guides/ci-build-caching): keyed on the lockfile and
the app's own files (`src/`, `public/`, `next.config.ts`, `tsconfig.json`), so a build starts
warm, and a new entry is saved whenever the source changes. Pull requests start from `main`'s
cache and only write their own. The job stops after 45 minutes, so a hung step can't hold a
runner for GitHub's default of 6 hours.

**PR titles** (`.github/workflows/pr-title.yml`): a squash merge lands on `main` with the pull
request's title, and Release Please reads it, but the commit-msg hook never sees it. So every pull
request's title is checked with the same commitlint rules (`commitlint.config.mjs`) when it's
opened or edited and on every new commit. Renovate's, Dependabot's and Release Please's titles
(`chore(deps): …`, `ci(deps): …`, `chore(main): release …`) already pass. It can be a required
check once branch protection is available for the repository.

Right after installing, it checks that the database schema and the committed migrations agree:
`pnpm auth:schema` must leave `src/db/schema/auth.ts` unchanged (Better Auth's tables match its
config), and `pnpm db:generate` must write nothing in `drizzle/` (the migrations match
`src/db/schema/`). Otherwise a schema-only unique index, constraint, default or `onDelete` change
would pass CI and never reach the database. If either fails, run the same commands locally
(`pnpm auth:schema` first after changing Better Auth's config, then `pnpm db:generate`) and
commit what they change. drizzle-kit asks about ambiguous renames, which CI can't answer, so
generate such a migration locally.

## Security advisories

`pnpm audit --prod` in CI fails the build on a new advisory in a
production dependency (`pnpm audit` locally checks the development ones too). An advisory that
was checked and can't be reached from the app is listed under `auditConfig.ignoreGhsas` in
`pnpm-workspace.yaml`, with why and when it goes away; remove the entry once the fix lands.

## Pinned actions

Every action is pinned to a full commit SHA with its version in a comment
(`uses: actions/checkout@<commit SHA> # vX.Y.Z`), and the PostgreSQL image to its digest, so a moved
or hijacked tag can't change what runs. Pin new actions the same way.

## Releases

Releases (`.github/workflows/release-please.yml`): Release Please keeps a release pull request
open that bumps the version and updates `CHANGELOG.md` from the commit messages. Merging it
publishes a GitHub release. It works as a small GitHub App instead of the workflow's own token
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

## Dependency updates

Weekly on Monday morning, a few days after a release at the earliest:

- Renovate (`renovate.json5`, needs the Renovate GitHub app installed on the repository) updates
  the npm packages, the container images (in the workflows and `compose.yaml`), `.nvmrc` and the
  pnpm version in `packageManager`. It uses pnpm like local development: the lockfile, that pnpm
  version and the settings in `pnpm-workspace.yaml`.
- Dependabot (`.github/dependabot.yml`, built into GitHub) updates the GitHub Actions, SHA and
  version comment together, in one pull request. Leave the repository's "Dependabot security
  updates" off, or it opens npm pull requests next to Renovate's.
