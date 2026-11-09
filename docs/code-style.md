# Code style and tooling

The linters and formatters, the JSDoc rule, the editor setup and the Git hooks. Back to the
[documentation](README.md).

## Code style

- **ESLint** (`eslint.config.mjs`) uses the Airbnb style guide through
  [`eslint-config-airbnb-extended`](https://eslint-airbnb-extended.nishargshah.dev), which adds
  TypeScript, React, React Hooks, accessibility and Next.js rules. The official
  `eslint-config-airbnb` does not support ESLint 9. Every `if`, `else` and loop body has braces,
  even a single statement (`curly: 'all'`, turned back on after Prettier's config, which turns it
  off; `pnpm lint:fix` adds them). Imports come in fixed groups (Node built-ins, packages, `@/…`,
  relative), with a blank line between groups and A to Z within each (`import-x/order`; side-effect
  imports like `import 'server-only'` stay put). Every `eslint-disable` comment gives its reason
  (`-- why`), none disables everything, and one that no longer disables anything is an error
  (`@eslint-community/eslint-plugin-eslint-comments`); `pnpm lint:fix` removes those. `pnpm lint`
  fails on warnings as well as errors (`--max-warnings=0`, also in the pre-commit hook). In `e2e/`
  it also refuses fixed waits (`waitForTimeout`; see [Testing](testing.md)).
- **Rules from `CLAUDE.md` that ESLint checks** (`restrictedImportsConfig` and `claudeRulesConfig`
  in `eslint.config.mjs`), so a review doesn't have to:
  - fixed colours (`bg-white`, `text-ink`, ...) and text lightened with opacity (`text-foreground/70`)
    in `src/app` and `src/components`; a font size with a line height (`text-sm/6`) is fine;
  - `useActionState`, outside `useTransientActionState` (`src/components/ui/use-transient-state.ts`);
  - `test` and `expect` imported from `@playwright/test` in a spec, instead of `e2e/support/test.ts`;
  - a provider ID (`'github'`, `'google'`) outside the files that declare the providers;
  - a role compared with a string (`role === 'admin'`) in a page or component;
  - `process.env` in `src/`, outside `src/lib/env.ts` and `src/lib/env-schema.ts`.

  A deliberate exception, like the brand panel's fixed colours, gets an `eslint-disable` comment with
  its reason. `window.confirm` was already refused (Airbnb's `no-alert`).

- **TypeScript** runs `strict` with `noUncheckedIndexedAccess`, so `list[0]` and `map.get(key)`
  may be `undefined` until checked. ESLint refuses `any` and non-null assertions (`value!`): check
  the value, or use `defined(value, 'what')` and `firstRow(rows, 'what')` (`src/lib/defined.ts`),
  which throw naming what was missing; look keys from outside up with `ownValue`
  (`src/lib/own-value.ts`). Every promise is awaited or handled (`no-floating-promises`,
  `no-misused-promises`); `void` marks a deliberate fire-and-forget, only for a function that
  reports its own errors. `for…of` is allowed (Airbnb's ban is turned off; `for…in` stays banned),
  and default and named exports are both fine (`import-x/prefer-default-export` is off).
- **JSDoc** is required: every file starts with a `/** @file ... */` block, and every function,
  component, class and exported value has a `/** */` comment, which says something: an empty block
  (as `lint:fix` inserts) fails until it's written (`jsdoc/require-description`).
  `eslint-plugin-jsdoc` enforces this for JS/TS. In CSS and SCSS, Stylelint rejects any comment that is not `/** */` (including `//`),
  but cannot check that a file header or a comment exists. The translation catalogues
  (`src/messages/**/*.json`) are the one exception: JSON can't hold comments, so
  [Languages](i18n.md) and the loader's JSDoc (`src/lib/i18n/messages.ts`) give their context.
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
- **Text** comes from the translation catalogues, in every language (see [Languages](i18n.md)).
  ESLint refuses text written straight into JSX (`react/jsx-no-literals`) or into a text prop
  (`aria-label`, `title`, `label`, `placeholder`, ...) in `src/app`, `src/components` and
  `src/emails`, and a translation call inside a template literal or a `+` anywhere in `src/`: a message is one
  whole sentence with named arguments. `pnpm lint:messages` (part of `pnpm lint`) checks the
  catalogues themselves: every language complete, the same arguments as English, no unused or
  undefined keys.
- **Browser bundle:** client components ship only what the page needs when it loads. zod and the
  schemas in `src/lib/validation.ts` stay on the server (the limits forms need are in
  `src/lib/input-rules.ts`); pages outside the sign-in pages load the Better Auth client with
  `loadAuthClient()` (`src/lib/sign-in/load-auth-client.ts`) when an action needs it; and
  libraries needed only for an action are loaded with `import()` when it happens, like `qrcode`
  when an authenticator app is set up; messages reach client components through the root provider
  and `ClientMessages`, never from the catalogues or `next-intl/server` directly.
  `src/client-imports.test.ts` follows every client
  component's static imports (not into server actions, which the browser only references) and
  fails, naming the chain, when one reaches a module on its list; add new heavy libraries there.
- **Modules that outgrow one file** (around 500 lines, or several jobs in one file) become a folder
  with an `index.ts` as the module's public API, like `src/lib/authz/mfa/`,
  `src/server/auth/auth-events/`, `src/server/auth/auth-guards/` and
  `src/server/people/invitations/`. Each file inside holds one part of the module; files import
  each other directly (never `./index`), and code outside imports only the folder itself, so
  existing imports keep working and the internals can change freely. ESLint enforces that boundary
  for the folders listed in `FOLDER_MODULES` (`eslint.config.mjs`), and `import-x/no-cycle` keeps
  the files inside from depending on each other in a circle. The tests sit next to the files they
  cover, sharing a `test-helpers.ts` in the folder (see [Testing](testing.md)).
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org), checked by
  commitlint (`commitlint.config.mjs`) in the commit-msg hook, and pull request titles in CI
  (`.github/workflows/pr-title.yml`). Dependabot's own titles (`ci(deps): bump …`) are skipped,
  since they can run past the 100-character limit.
- **EditorConfig** (`.editorconfig`) gives every editor the same basics: UTF-8, LF line endings,
  2-space indentation and a final newline. `.gitattributes` keeps LF line endings in the repository
  and in every checkout, whatever the contributor's system (images are binary).

## Editor setup (VS Code)

Opening the project in VS Code prompts you to install the recommended extensions
(`.vscode/extensions.json`): ESLint, Prettier, Stylelint, Tailwind CSS IntelliSense,
EditorConfig, Vitest and Playwright Test. The shared settings (`.vscode/settings.json`) format on save with Prettier, apply
ESLint and Stylelint fixes on save, and use the project's TypeScript version. Debug configurations
for the server, the browser, scripts, email previews and every kind of test are in
`.vscode/launch.json`, with the task they start first in `.vscode/tasks.json`: see
[Debugging in VS Code](development.md#debugging-in-vs-code).

## Git hooks

`pnpm install` sets up a [Husky](https://typicode.github.io/husky) pre-commit hook that runs
[lint-staged](https://github.com/lint-staged/lint-staged) (`lint-staged.config.mjs`) on the files
being committed:

- JS/TS: `eslint --fix` (formats with Prettier and sorts Tailwind classes, then checks lint rules),
  then the Vitest tests related to the changed files, then `pnpm lint:messages` (code can stop
  using a message, or use one that doesn't exist)
- The translation catalogues (`src/messages/`): `pnpm lint:messages`
- CSS/SCSS: `stylelint --fix` (same, for styles)
- JSON, Markdown and YAML: `prettier --write`

Only staged changes are touched: unstaged edits in the same file are set aside while the hook runs.
Fixes are added to the commit; errors that can't be fixed automatically stop the commit.

A commit-msg hook checks the commit message with commitlint.
