# Testing

The three kinds of tests, where they live and what they need. Back to the
[documentation](README.md).

Tests cover the application. Config, tooling, the scripts in `scripts/` and the test helpers in
`tests/` have no tests of their own. To stop at a breakpoint in a test, use the "current file"
configurations in VS Code, which turn the time limit off (see
[Debugging in VS Code](development.md#debugging-in-vs-code)).

- **Unit and component tests** use [Vitest](https://vitest.dev) and
  [Testing Library](https://testing-library.com), as `*.test.ts(x)` files next to the code in
  `src/` (`vitest.config.mts`). Run them with `pnpm test` (or `pnpm test:watch`). Checks on types use Vitest's `expectTypeOf` in such a
  file: `pnpm typecheck` enforces them, not the test run (e.g.
  `src/server/auth/hook-contexts.test.ts`, which checks that the parts of Better Auth's context the
  app's hooks read still fit Better Auth's types).
- **Languages:** unit tests render in English (US) without a request or a provider:
  `vitest.setup.ts` stands in for next-intl (`tests/i18n/next-intl-mocks.ts`), so `useTranslations`,
  `getTranslations`, `getLocale` and `requestLocale()` give English. To check Dutch or Spanish text
  (word order, plurals), render with `renderInLocale(locale, ui)` from `tests/i18n/render.tsx`, or
  translate outside React with `translator(locale, namespace)`. End-to-end tests run in English
  (US) (`locale` in `playwright.config.ts`).
- **A module split into a folder** (see "Modules that outgrow one file" in
  [Code style](code-style.md)) has a test file next to each of its files, and the helpers they
  share in the folder's `test-helpers.ts`. When the tests share a database test context, that file
  calls `setupTestContext()` once; every test file still declares its own `vi.mock` calls and hooks,
  since Vitest hoists those per file. The one mock every integration file needs, `@/db` pointing
  at the test database, is declared once in `tests/integration/setup.ts` (a `setupFiles` entry of
  the integration project), so no file copies it.
- **Integration tests** (`*.int.test.ts` next to the code they test, mostly in `src/server/`) run
  the services against a real PostgreSQL test database, `adiutor_test`. It's created and migrated
  automatically and emptied before each test. Because the tests empty it, its name must end in
  `_test` and it can't be the database in `DATABASE_URL` (same host, port and name); anything else
  is refused before a test runs (`tests/database/database-url.ts`). They cover the permission rules, the privacy rule,
  single-use links (including two people racing for one), invitations to one address at the same
  moment (`atTheSameMoment` in `tests/integration/helpers.ts`), whole sign-in flows through Better
  Auth (`src/server/auth/password-sign-in.int.test.ts`, and email links in
  `src/server/auth/email-link-chain.int.test.ts`) and the database rules (UUIDv7 IDs, indexed
  foreign keys). Run them with `pnpm test:integration`.
- **End-to-end tests** use [Playwright](https://playwright.dev), in `e2e/` (`playwright.config.ts`).
  They build and start their own server on port 3100 against the seeded test database, and read
  emails from `e2e/.outbox`; your dev server and database aren't touched. Before reading, the email
  helpers (`e2e/support/outbox.ts`) start the [background jobs](jobs.md)' tick on that server
  (`/api/jobs`, with the test `CRON_SECRET`), so emails waiting in the queue go out first. They include the
  accessibility and keyboard checks described under
  [Design and accessibility](design.md#design-and-accessibility).
  - **Running and build reuse:** install the browser once with
    `pnpm exec playwright install chromium`, then run them with `pnpm test:e2e`. Locally they reuse
    the last build when nothing it reads (`src/` apart from unit tests, `public/`,
    `next.config.ts`, `tsconfig.json`, `package.json`, the lockfile) changed since
    (`tests/build/build-state.ts`), so rerunning a spec after editing only specs starts at once;
    `E2E_REBUILD=1 pnpm test:e2e` builds anyway (e.g. after an edit saved while a build was
    running).
  - **Isolation:** every test gets its own client address (`X-Forwarded-For`, set in
    `e2e/support/test.ts`), so Better Auth's per-IP limits (3 sign-ins per 10 seconds, sign-in
    links, codes) don't carry over between tests; a test that signs in more often than that gives
    a page another address with `useOwnClientIp`. A test that uses up state (locks, deletes or
    changes an account) has its own seeded account or a fresh address. The seed includes a
    company, "Adiutor Tests Paging", with more members and invite links than fit on a page, used
    by the pagination tests (`e2e/tables.spec.ts`) and the accessibility and keyboard checks of
    paginated tables (`e2e/a11y.spec.ts`, `e2e/keyboard.spec.ts`); no test changes its data.
  - **Tokens:** the invitation and invite-link pages are scanned with real tokens stored straight
    in the database (`storeInvitation`, `storeInviteLink` in `e2e/support/db.ts`), signed out and
    signed in. Those helpers, like the others in that file, open their own connection to the test
    database (`withTestDatabase`), so specs pass no URL.
  - **Emails:** emails to a seeded or reused address are counted with `countEmails` before the
    action and awaited with `waitForNewEmail` after it. `waitForEmail` returns an email that's
    already there, so it's only for a fresh address's first email.
  - **Waiting and negative checks:** tests wait for what they need (`expect.poll`,
    `waitForNewEmail`, a locator), never a fixed time: ESLint refuses `waitForTimeout` in `e2e/`,
    except where a helper waits out Better Auth's rate-limit window. A check that something
    doesn't happen (a second email) belongs in the integration tests, which can wait for the work
    done after a response.
  - **CI retries and traces:** in CI a failed test is retried twice and traced on its first retry,
    except in `e2e/security.spec.ts`: its tests use up state in order, so it doesn't retry and
    keeps a trace of its first failure instead (traces are in the `playwright-report` artifact).

`pnpm services:up` must be running for integration and end-to-end tests.
