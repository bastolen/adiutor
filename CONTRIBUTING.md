# Contributing to Adiutor

Thanks for wanting to help! This guide covers how to set up the project and get a change merged.

By contributing you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md), and that your
contributions are licensed under the project's [MIT License](LICENSE). Security issues go through
the [security policy](SECURITY.md), not public issues.

## Getting started

You need Node.js 24.18 or newer (see `.nvmrc`; with nvm, run `nvm use`) and pnpm (`corepack enable` installs
the version the project pins).

```bash
pnpm install
pnpm dev
```

`pnpm install` also installs the Git hooks. In VS Code, install the recommended extensions when
prompted. The README lists every script.

## Making a change

1. For anything bigger than a small fix, open an issue first so we can agree on the approach.
2. Create a branch from `main`.
3. Make your change, following the code style below, and add or update tests.
4. Commit using [Conventional Commits](https://www.conventionalcommits.org) (see below).
5. Open a pull request and fill in the template. CI must pass before it can be merged.

## Code style

- ESLint (Airbnb rules), Stylelint and Prettier enforce the style. The pre-commit hook fixes what it
  can; run `pnpm lint:fix` and `pnpm format` to do the same manually.
- **Document all code with JSDoc comments** (`/** ... */`): every file starts with a `@file` block,
  and every function, component, type and exported value has a comment. This applies to CSS and
  SCSS too. Update comments and the README when you change behaviour.

## Tests

- Unit and component tests: Vitest with Testing Library, as `*.test.ts(x)` files next to the code
  in `src/`. Run `pnpm test` (or `pnpm test:watch`).
- End-to-end tests: Playwright, in `e2e/`. Run `pnpm test:e2e`; the first time, install the browser
  with `pnpm exec playwright install chromium`.

## Commit messages

Commit messages follow Conventional Commits, checked by a commit-msg hook:

```text
<type>(<optional scope>): <description>
```

Common types: `feat` (new feature), `fix` (bug fix), `docs`, `style`, `refactor`, `test`, `chore`,
`ci`. Add `!` after the type (e.g. `feat!:`) for a breaking change. These messages decide the next
version number and the changelog, so make them describe the change for users.

## Releases

Releases are automated by Release Please: it keeps a release pull request open that bumps the
version and updates `CHANGELOG.md`. Merging it publishes the release.
