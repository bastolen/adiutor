# Adiutor

Next.js app using pnpm, TypeScript, Tailwind CSS and SCSS.

Requires Node.js 24.18 or newer (see `.nvmrc`) and pnpm.

```bash
pnpm install
pnpm dev
```

The dev server runs at <http://localhost:3000>.

## Scripts

| Command             | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `pnpm dev`          | Start the dev server                                             |
| `pnpm build`        | Build for production                                             |
| `pnpm start`        | Serve the production build                                       |
| `pnpm lint`         | Check JS/TS with ESLint and CSS/SCSS with Stylelint              |
| `pnpm lint:fix`     | Fix and format JS/TS, CSS and SCSS where possible                |
| `pnpm format`       | Format every file type with Prettier (CSS, SCSS, JSON, Markdown) |
| `pnpm format:check` | Check formatting without changing files                          |
| `pnpm typecheck`    | Generate Next.js route types, then type-check with TypeScript    |
| `pnpm test`         | Run the unit and component tests (Vitest)                        |
| `pnpm test:watch`   | Run the unit tests in watch mode                                 |
| `pnpm test:e2e`     | Run the end-to-end tests (Playwright)                            |

## Tests

- **Unit and component tests** use [Vitest](https://vitest.dev) and
  [Testing Library](https://testing-library.com), as `*.test.ts(x)` files next to the code in
  `src/` (`vitest.config.mts`).
- **End-to-end tests** use [Playwright](https://playwright.dev), in `e2e/` (`playwright.config.ts`).
  They start the dev server automatically, or reuse one that is running. Install the browser once
  with `pnpm exec playwright install chromium`.

Both have a placeholder test for now; delete it when the first real test is added.

## Code style

- **ESLint** (`eslint.config.mjs`) uses the Airbnb style guide through
  [`eslint-config-airbnb-extended`](https://eslint-airbnb-extended.nishargshah.dev), which adds
  TypeScript, React, React Hooks, accessibility and Next.js rules. The official
  `eslint-config-airbnb` does not support ESLint 9.
- **JSDoc** is required: every file starts with a `/** @file ... */` block, and every function,
  component, class and exported value has a `/** */` comment. `eslint-plugin-jsdoc` enforces this
  for JS/TS. In CSS and SCSS, Stylelint rejects any comment that is not `/** */` (including `//`),
  but cannot check that a file header or a comment exists.
- **Prettier** (`prettier.config.mjs`) handles formatting with settings that match Airbnb (single
  quotes, semicolons, trailing commas, 100-character lines). It runs inside ESLint and Stylelint,
  and sorts Tailwind classes.
- **Stylelint** (`stylelint.config.mjs`) checks CSS and SCSS with the standard SCSS rules, allows
  Tailwind's at-rules (`@theme`, `@utility`, `@apply`, ...) and enforces JSDoc-style comments.
- **Tailwind classes** are sorted by Prettier's Tailwind plugin, in `className` and in helpers like
  `clsx()` and `cn()`, and in `@apply` in CSS/SCSS. Because Prettier runs inside ESLint and
  Stylelint, `pnpm lint` reports classes in the wrong order and `pnpm lint:fix` sorts them.
  `eslint-plugin-better-tailwindcss` also reports unknown, duplicate, conflicting and deprecated
  classes, using the brand theme so classes like `bg-primary` count as valid.
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org), checked by
  commitlint (`commitlint.config.mjs`).
- **EditorConfig** (`.editorconfig`) gives every editor the same basics: UTF-8, LF line endings,
  2-space indentation and a final newline.

## Editor setup (VS Code)

Opening the project in VS Code prompts you to install the recommended extensions
(`.vscode/extensions.json`): ESLint, Prettier, Stylelint, Tailwind CSS IntelliSense,
EditorConfig, Vitest and Playwright Test. The shared settings (`.vscode/settings.json`) format on save with Prettier, apply
ESLint and Stylelint fixes on save, and use the project's TypeScript version.

## Git hooks

`pnpm install` sets up a [Husky](https://typicode.github.io/husky) pre-commit hook that runs
[lint-staged](https://github.com/lint-staged/lint-staged) (`lint-staged.config.mjs`) on the files
being committed:

- JS/TS: `eslint --fix` (formats with Prettier and sorts Tailwind classes, then checks lint rules),
  then the Vitest tests related to the changed files
- CSS/SCSS: `stylelint --fix` (same, for styles)
- JSON, Markdown and YAML: `prettier --write`

Only staged changes are touched: unstaged edits in the same file are set aside while the hook runs.
Fixes are added to the commit; errors that can't be fixed automatically stop the commit.

A commit-msg hook checks the commit message with commitlint.

## CI, releases and dependencies

- **CI** (`.github/workflows/ci.yml`) runs lint, format check, type-check, unit tests, build and
  end-to-end tests on every pull request and push to `main`.
- **Releases** (`.github/workflows/release-please.yml`): Release Please keeps a release pull request
  open that bumps the version and updates `CHANGELOG.md` from the commit messages. Merging it
  publishes a GitHub release.
- **Dependency updates** (`renovate.json5`): Renovate opens grouped update pull requests weekly.

## Brand

Logos and icons live in `public/brand/`, cropped to their content with no background:

| File                               | Use on                              |
| ---------------------------------- | ----------------------------------- |
| `logo.svg`, `icon.svg`             | Light backgrounds                   |
| `logo-on-dark.svg`                 | Dark backgrounds (ink)              |
| `logo-white.svg`, `icon-white.svg` | The brand gradient or accent colour |

`src/styles/theme.css` is the Tailwind theme: `primary`, `secondary`, `accent` and `ink` colours, the `bg-brand-gradient` utility, the Facundo font stack, and text sizes with line height = font size + 8px.

In SCSS, `@use "brand";` (from `src/styles/_brand.scss`) gives the same values as Sass variables, e.g. `brand.$primary` or `brand.$brand-gradient`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md),
and report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

The code is released under the [MIT License](LICENSE).

The MIT License covers the source code only. The Adiutor name, logo and other brand assets (including
the files in `public/brand/`) are not covered by it and may not be used to represent other projects
or products without permission.
