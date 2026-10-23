@AGENTS.md

## Documentation

- Document all code with JSDoc-style `/** ... */` comments. This includes TypeScript, config files, CSS and SCSS.
- Every file starts with a `/** @file ... */` block saying what it is for. Every export, component, function, config option, theme token group and Sass variable gets its own `/** */` comment.
- When you change code, update its comments and the README in the same change, so documentation never drifts from the code.

## Code style

- Follow the Airbnb style guide. Run `pnpm lint:fix` and `pnpm format` after changes, then `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` must pass.
- Keep `.vscode/extensions.json` and `.vscode/settings.json` in sync with the tooling: when a linter, formatter or framework that has an official VS Code extension is added, removed or reconfigured, update both files (and the README's "Editor setup" section).
- The pre-commit hook (`.husky/pre-commit` → `lint-staged.config.mjs`) must cover every file type the linters and Prettier handle; update it when tooling changes.
- Add or update tests with every change: Vitest `*.test.ts(x)` files next to the code in `src/`, Playwright specs in `e2e/`. Delete the placeholder tests once real ones exist.
- Commit messages follow Conventional Commits (checked by commitlint).
- Keep `.github/workflows/ci.yml` running every check script; update it when scripts change.
