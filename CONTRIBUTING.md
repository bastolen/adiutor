# Contributing to Adiutor

Thanks for wanting to help! This guide covers how to set up the project and get a change merged.

By contributing you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md), and that your
contributions are licensed under the project's [MIT License](LICENSE). Security issues go through
the [security policy](SECURITY.md), not public issues.

## Getting started

Follow the [quick start](README.md#quick-start) in the README.
[Local development](docs/development.md) has the test accounts (`pnpm db:seed --yes`), starting
over and every script, and the [documentation](docs/README.md) explains how the app works, one
topic per page. `pnpm install` also installs the Git hooks. In VS Code, install the recommended
extensions when prompted.

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
  and every function, component, type and exported value has a comment. This applies to CSS too.
  Update comments, the README and the [docs](docs/README.md) when you change behaviour.
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

Add or update tests with every change; how to write and run each kind is in
[Testing](docs/testing.md).

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

Releases are automated; see [Releases](docs/ci-and-releases.md#releases).
