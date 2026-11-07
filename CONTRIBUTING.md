# Contributing to Adiutor

Thanks for wanting to help! This guide covers how to set up the project and get a change merged.

By contributing you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md), and that your
contributions are licensed under the project's [MIT License](LICENSE). Security issues go through
the [security policy](SECURITY.md), not public issues.

## Getting started

You need Node.js 26.13 or newer, the current LTS (see `.nvmrc`; with nvm, run `nvm use`, or with
pnpm managing Node, `pnpm env use --global 26.13`) and pnpm. Node.js no longer ships Corepack, so
install pnpm once with `npm install --global pnpm`; it switches to the version the project pins
(`packageManager` in `package.json`) by itself.

You also need Docker for the local PostgreSQL database and the Mailpit mail viewer.

```bash
pnpm install
cp .env.example .env    # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm services:up        # start PostgreSQL (data in docker/database/) and Mailpit
pnpm db:migrate         # create the tables
pnpm dev
```

Open <http://localhost:3000>: the first run goes to `/setup`, where you choose the name users
see (e.g. "Adiutor") and create your Admin account (e.g. `you@adiutor.dev`). Every email the app sends shows up
in Mailpit at <http://localhost:8025>, and `pnpm email:dev` previews the templates. To try other roles, invite yourself (e.g. `you+client@adiutor.dev`)
from a company's Members page, or as staff from the staff page (`/admin/staff`). To start over, stop the database and delete `docker/database/`.

`pnpm install` also installs the Git hooks. In VS Code, install the recommended extensions when
prompted. [Local development](docs/development.md#scripts) lists every script, and the
[documentation](docs/README.md) explains how the app works, one topic per page.

## Making a change

1. For anything bigger than a small fix, open an issue first so we can agree on the approach.
2. Create a branch from `main`.
3. Make your change, following the code style below, and add or update tests. Before changing how
   something fundamental works, read its [decision record](docs/decisions/README.md); a change to
   such a decision gets a new record.
4. Commit using [Conventional Commits](https://www.conventionalcommits.org) (see below).
5. Open a pull request and fill in the template. CI must pass before it can be merged.

## Code style

- ESLint (Airbnb rules), Stylelint and Prettier enforce the style. The pre-commit hook fixes what it
  can; run `pnpm lint:fix` and `pnpm format` to do the same manually.
- **Document all code with JSDoc comments** (`/** ... */`): every file starts with a `@file` block,
  and every function, component, type and exported value has a comment. This applies to CSS and
  SCSS too. Update comments, the README and the [docs](docs/README.md) when you change behaviour.
- **Build UI from `src/components/ui/`** and keep it accessible (WCAG 2.2 AA, full keyboard
  support, both colour modes). See [Design and accessibility](docs/design.md#design-and-accessibility).
- **Check where code lives** now and then: in Claude Code, `/placement-check`
  (`.claude/skills/placement-check/SKILL.md`) reviews the whole repository for code in the wrong
  layer or folder, duplicated helpers and unused code, and reports before changing anything.
- **Get a second opinion on how the app is built** now and then: in Claude Code, `/app-review`
  (`.claude/skills/app-review/SKILL.md`) reviews design and code quality, performance and data
  access, UX, UI and accessibility, tests, docs and tooling, plus a light security pass, and
  reports what it would do differently, ordered by value, before changing anything.

More about the linters, the editor setup and the Git hooks is in
[Code style and tooling](docs/code-style.md).

## Tests

- Unit and component tests: Vitest with Testing Library, as `*.test.ts(x)` files next to the code
  in `src/`. Run `pnpm test` (or `pnpm test:watch`).
- Integration tests: services against a real test database, as `*.int.test.ts` files next to
  the code they test (mostly in `src/server/`). Run `pnpm test:integration` (needs
  `pnpm services:up`).
- End-to-end tests: Playwright, in `e2e/`. Run `pnpm test:e2e` (needs `pnpm services:up`); the first
  time, install the browser with `pnpm exec playwright install chromium`. They include an
  accessibility scan of every page (`e2e/a11y.spec.ts`) and keyboard checks
  (`e2e/keyboard.spec.ts`); add new pages and interactive patterns there.

More about each kind of test is in [Testing](docs/testing.md). To step through a test, or the app
itself, in VS Code, see [Debugging in VS Code](docs/development.md#debugging-in-vs-code).

## Database changes

Change the schema in `src/db/schema/`, then run `pnpm db:generate` to write a migration in
`drizzle/` and `pnpm db:migrate` to apply it. Use UUIDv7 primary keys (never auto-increment) and add
an index for every foreign key; the integration tests check both. After changing Better Auth's
config, run `pnpm auth:schema` first. CI fails when the schema and the committed migrations don't
agree (see [CI](docs/ci-and-releases.md#ci)).

## Commit messages

Commit messages follow Conventional Commits, checked by a commit-msg hook:

```text
<type>(<optional scope>): <description>
```

Common types: `feat` (new feature), `fix` (bug fix), `docs`, `style`, `refactor`, `test`, `chore`,
`ci`. Add `!` after the type (e.g. `feat!:`) for a breaking change. These messages decide the next
version number and the changelog, so make them describe the change for users. Pull request
titles follow the same format, since a squash merge lands with the title; CI checks them (see
[CI](docs/ci-and-releases.md#ci)).

## Releases

Releases are automated by Release Please: it keeps a release pull request open that bumps the
version and updates `CHANGELOG.md`. Merging it publishes the release. It runs as a small GitHub
App; see [Releases](docs/ci-and-releases.md#releases) for the one-time setup. Versions stay
below 1.0.0 until Adiutor is ready for real use (see [Versions](docs/ci-and-releases.md#versions)).
