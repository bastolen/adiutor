---
name: placement-check
description: Full read-only check of where the code in this repository lives (layers, routes, shared components, tests, config) and of unused code, with every finding verified by an independent reviewer, ending in a grouped report and a question about what to fix. Use when asked to check code placement, project structure, layering, duplicated helpers or unused code.
---

# Placement check

Check where the code in this repository lives, and find unused code. Change nothing: this
skill only reports. If the user named an area when invoking it, check only that area, but
still verify and report the same way. How the code is built (design, performance, UX, tests
and docs) is `/app-review`'s job (`.claude/skills/app-review/SKILL.md`); leave it out.

## How to run it

Run it as a workflow (the Workflow tool): one reviewer per area, then one skeptic per area
who tries to disprove each of that reviewer's findings. Everyone stays read-only: no edits,
moves or deletions, and no tests, builds, dev servers, Playwright or `pnpm install`/`dlx`
while checking. Reading files, grep and one-off read-only scripts are fine. Most files may be
untracked, so reviewers use the filesystem rather than `git diff`.

## Areas

1. `src/app`: the routes (`auth`, `invite`, `join`, `setup`, `sign-in-error`, `api`), the
   `(app)` route group with its private `_people` folder, and server actions.
2. `src/components`: every folder under it (`ui`, `auth`, `brand`, `email`, `language`, `layout`,
   `theme`, and any added later).
3. `src/lib`: every topic folder under it (`authz/`, `i18n/`, `request/`, `sign-in/`, `tables/`,
   and any added later), and the shared files at its root.
4. `src/server`: every topic folder under it (`auth/`, `people/`, and any added later), and the
   shared files at its root.
5. `src/db`, `drizzle/`, `src/emails`, `src/messages`, `src/styles`, the root files of `src/`
   (`proxy.ts`, `instrumentation.ts` and their tests, `client-imports.test.ts`), `scripts/`,
   `tests/` (every folder under it: `integration/`, `database/`, `auth/`, `i18n/`, `build/`) and
   `public/`.
6. `e2e/` (the specs, and `e2e/support/` for shared helpers) and everything at the repository
   root: `package.json`, `pnpm-workspace.yaml`, the lockfile, the Playwright, Vitest (and
   `vitest.setup.ts`), ESLint, Prettier, Stylelint, lint-staged, commitlint, Drizzle and Next
   configs, `tsconfig.json`, `compose.yaml`, `Dockerfile`, `.dockerignore`, `docker/`,
   `vercel.json`, `release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md`,
   `.github/`, `.vscode/`, `.husky/`, `.claude/` (settings, `launch.json` and skills),
   `renovate.json5`, `.env.example`, `.nvmrc`, `.editorconfig`, `.gitattributes`,
   `.prettierignore`, `LICENSES/`, the root Markdown files (`README.md`, `CONTRIBUTING.md`,
   `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CLAUDE.md`, `AGENTS.md`), `LICENSE`, and `docs/` with
   its index `docs/README.md`.
7. A repository-wide sweep for unused exports, files and props: a read-only script lists
   every named export in `src/**/*.{ts,tsx}` and counts its uses in other files across `src`,
   `e2e`, `scripts`, `tests` and the root config, then the candidates are checked by hand.

Not part of the check: anything Git ignores (`.gitignore`), such as `node_modules`, `.next` and
test output. `git ls-files --cached --others --exclude-standard` lists the files that are in
scope, untracked ones included. Ignored files are only read as references where this skill says
so (the docs and sources in `node_modules`), never checked or reported on.

**Every path has an area.** Before the reviewers start, the orchestrator assigns every path from
`git ls-files --cached --others --exclude-standard` to exactly one of areas 1 to 6, and reports
any path left over (a new folder or root file no area names) in the final report, with the area
it was given. Area 7 is a sweep across the others and takes no paths of its own.

## What to judge against

- **The rules in CLAUDE.md**, especially:
  - permission rules only in `src/lib/authz` (MFA rules in `mfa/`), with pages checking
    permissions through `src/server/authz.ts`;
  - `src/lib` pure and client-safe, and `src/lib/auth.ts` and `src/db` free of `server-only`;
  - services taking a `ServiceContext`;
  - **topic folders:** new server and lib files go in the folder of their topic
    (`src/server/auth/`, `src/server/people/`, `src/lib/sign-in/`, `src/lib/tables/`,
    `src/lib/request/`, `src/lib/i18n/`, `src/lib/authz/`), with their tests next to them; code shared by every topic stays at the
    root of `src/server` or `src/lib`, and shared e2e helpers go in `e2e/support/`;
  - **declared once:**
    - OAuth providers in `src/lib/sign-in/oauth-providers.ts`, with their credentials in
      `src/lib/sign-in/providers.ts`, their icon in `PROVIDER_ICONS`
      (`src/components/brand/provider-icons.tsx`) and their MFA check in
      `src/server/auth/provider-mfa.ts`;
    - the guards' refusals in `src/lib/sign-in/sign-in-refusals.ts`;
    - the Better Auth endpoints the browser may use in `src/lib/sign-in/auth-endpoints.ts`;
    - tables in `src/lib/tables/tables.ts`, with lists paginated through `paginate` in
      `src/server/pagination.ts`;
    - environment variables in `src/lib/env-schema.ts` and `.env.example`;
    - sign-in error messages in `src/app/sign-in-error/messages.ts`;
    - a user's MFA facts, loaded only through `src/server/auth/mfa-state.ts`;
  - UI built from `src/components/ui`, with menus, selects and dialogs going through its Radix
    wrappers;
  - email templates in `src/emails`, built with `EmailLayout` and the blocks in
    `src/components/email`;
  - the schema in `src/db/schema`, with migrations in `drizzle/`; `src/db/schema/auth.ts` is
    generated (`pnpm auth:schema`);
  - unit tests next to their code, and integration tests named `*.int.test.ts`; Playwright
    specs in `e2e/`, importing `test`/`expect` from `e2e/support/test.ts`; a row in
    `src/server/authorization-matrix.int.test.ts` for every permission-relevant service;
  - `README.md` about the product, and developer detail in `docs/`, one page per topic, each
    listed in `docs/README.md` and in the README's Documentation table.
- **The Next.js 16 docs** in `node_modules/next/dist/docs/01-app`: colocation, private
  folders, route groups, `proxy.ts`. Don't assume older Next.js conventions.
- **Common sense layering:**
  - code used by one route lives next to that route, and code shared by several routes
    doesn't live inside one of them;
  - no pure helpers in server modules, and nothing that touches the database, secrets or
    headers in `src/lib`;
  - no duplicated helpers or constants, including copies a client form makes because it
    can't import from a server module;
  - file names that match their contents.
- **Unused code:** exports, files and props nothing uses, and leftovers from removed features.
  These are not unused:
  - Next.js file conventions (default exports of `page`, `layout`, `route`, `not-found`,
    `error`, `loading` and `template`, plus `metadata`, `generateMetadata`, `viewport`, the
    proxy's `config` and the instrumentation hooks);
  - React Email `PreviewProps` and template default exports;
  - Drizzle tables, which are used through the schema object;
  - types used only inside other exported types;
  - constant lists whose only use is deriving an exported type (e.g. `AUDIT_ACTIONS`,
    `PERMISSIONS`): unexported, ESLint flags them as used only as a type.

  List exports that only tests use separately, as low impact.

Known exception, confirmed by the owner (don't report it): the block at the top of
`AGENTS.md`, which `next dev` writes and adds back itself.

Reviewers report only concrete, checkable findings, each with its evidence (the grep or the
imports found). No style nits, naming taste, or anything CLAUDE.md explicitly allows. Each
skeptic re-runs the checks for every finding it gets, looks for missed uses (dynamic imports,
re-exports, string references, config files, conventions), and keeps a finding only if it
still holds. It may give a better fix.

## Report

- Merge the findings different reviewers made about the same thing.
- Check the most important findings yourself before reporting them.
- Save the full list with evidence in the scratchpad, and give its full path.
- Group the findings, each with a file link, where the code should go or what to do, and why:
  1. **Project rules broken**
  2. **Files in the wrong place**
  3. **Duplicated code**
  4. **Unused**
- Say how many findings survived the skeptics and how many didn't.
- End by asking which groups to fix, plus any decision that's the user's to make (for
  example, deleting files or local data, or anything that may be on purpose). Change nothing
  until they answer.
