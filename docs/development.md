# Local development

Running Adiutor on your machine after the [quick start](../README.md#quick-start): the first run,
migrations, test data, starting over, debugging, and every script. Back to the
[documentation](README.md).

## First run

Open <http://localhost:3000>. On the first run it goes to `/setup`, where you choose the name users
see and create your Admin account (see the [quick start](../README.md#quick-start)). After that,
sign in at `/auth`.

Next.js's development indicator (the round "N") is turned off in `next.config.ts`
(`devIndicators: false`), because in every corner it covers one of the app's controls. Compile and
runtime errors still show in its overlay.

For scripted deployments, `pnpm setup:platform --staff-name "Adiutor" --email you@adiutor.dev --name
"Your Name"` does what `/setup` does, from the command line (the account then signs in with an email link).
Add `--default-language nl-NL` (or `es-ES`) to choose Adiutor's default language; it's English (US)
otherwise. Add `--time-zone Europe/Amsterdam` to choose Adiutor's default time zone, which a new
Admin gets as their own too; it's UTC otherwise, and the Admin's browser saves their zone on their
first visit. The web form takes the zone from the setting-up browser.

## Migrations

After pulling changes, run `pnpm db:migrate` to apply new migrations from `drizzle/`. When you
forget, `pnpm dev` says so as it starts (`src/server/migration-check.ts`, run from
`src/instrumentation.ts`): it warns that the database is missing migrations and names them, or that
it has none applied yet, and pages that need them fail until you migrate. When the database's
migrations don't match `drizzle/` (it was migrated from another branch, or before the migrations
were regenerated), `pnpm db:migrate` can't fix it; the warning says so, and the way out is
[starting over](#starting-over). The check runs in the background and never stops the server; when
the database can't be reached it only notes that it couldn't check. Production servers don't run
it: [deploying](deploying.md#installing-and-upgrading) migrates before every restart.

## Background jobs

`pnpm dev` calls the [background jobs](jobs.md)' endpoint itself, right away and then every minute,
as a cron service would (`GET /api/jobs` at `BETTER_AUTH_URL` with `CRON_SECRET`; `startDevTick` in
`src/server/jobs/dev-tick.ts`, started from `src/instrumentation.ts`), so emails the app queues,
such as security notices, reach Mailpit within a minute. Going through the endpoint keeps the jobs'
code current: Next.js recompiles the route after an edit or a branch switch, while code that
`instrumentation.ts` loaded stays as it was when the server started. A backlog continues straight
away, as in production ([The endpoint](jobs.md#the-endpoint)).

- **`CRON_SECRET`** must be set in `.env` (`openssl rand -base64 32`). Without it the endpoint is
  off, `pnpm dev` says so once as it starts, and only `pnpm jobs:run` runs the jobs.
- **A second dev server** on another port (another checkout, say) sets `BETTER_AUTH_URL` to its own
  address, or its ticks go to the first server.
- **A failed call** is logged by its status or error, and the next minute tries again.

`pnpm jobs:run` runs a tick at once, and `pnpm jobs:run <job>` one job. Production servers never
tick themselves: see [Background jobs](deploying.md#background-jobs) in the deployment docs.

## Starting over

The database files live in `docker/database/` (git-ignored). To start over with an empty database
(for example after the migrations were regenerated), run `pnpm services:down`, delete that folder,
then `pnpm services:up` and `pnpm db:migrate`. This also empties the test database, which the tests
recreate.

## Test accounts

To try every role and sign-in setup, `pnpm db:seed --yes` empties the local database and adds your
staff (shown to users as "Adiutor Tests", with a staff invitation and invite link), test companies (active, deactivated
and just-added) and accounts for every role,
including multi-company users, staff who are also company members, an unverified email, email-link-only
accounts, a GitHub-only Admin (whose GitHub MFA only counts while GitHub sign-in is configured), a
deactivated account, authenticator and email-code MFA (and a
Manager with email codes only, which don't count for Managers), plus
invitations and invite links in every state (one due for its expiry reminder), varied "last active"
times, some audit log entries, sample errors from the last few days to look up under Logs →
Errors (`scripts/sample-errors.ts`; the `retention` job removes them once they're 7 days old) and
sample requests in every status, with replies and changes from both sides, and two internal
requests, the staff's own (`scripts/sample-requests.ts`).
`scripts/seed-dev.ts` lists the accounts and their password. The open invitations are emailed to
Mailpit, and the script prints the authenticator setup key, backup codes and the links that still
work. It reads the same validated `.env` as the app (so `BETTER_AUTH_URL` must be set), and refuses
to run (`src/lib/dev-seed-guard.ts`) in production, when `BETTER_AUTH_URL` isn't on this machine
(`localhost`, `127.0.0.1`, `[::1]` or a `.localhost` name, as on a server whose database happens to
listen on `localhost`), against the test database or against a database that isn't on this machine.
The database's host is read as the driver reads it (`src/lib/database-address.ts`): a `host`
parameter wins over the URL's own host, so `…@localhost/adiutor?host=db.adiutor.dev` is refused,
and so are a socket's folder (`?host=/cloudsql/…`), a list of hosts and a URL without a host.

The seeded accounts all use `@adiutor.test` addresses, which can't receive mail from GitHub or
Google. To sign in with your own provider account, add `--admin-mail` with its verified address:
`pnpm db:seed --yes --admin-mail you@adiutor.dev` also creates a staff Admin with that address and
no password. Sign in as it with an email link (it arrives in Mailpit) or with GitHub or Google. It
starts without MFA, so unless your GitHub account has two-factor authentication on, the Security
page asks you to set it up, as for any staff Admin.

## Debugging in VS Code

Open the Run and Debug panel (⇧⌘D, or Ctrl+Shift+D), choose a configuration and press F5. They're in
`.vscode/launch.json` and run on VS Code's built-in JavaScript debugger, so they need no extra
extension.

| Configuration                    | What it reaches                                                                                               | Starts PostgreSQL and Mailpit first |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `App: server and browser`        | The whole app: runs `pnpm dev`, then opens Chrome with the debugger attached once it's ready                  | Yes                                 |
| `App: server`                    | Server Components, Server Actions, route handlers, `proxy`, `instrumentation` and services                    | Yes                                 |
| `App: browser`                   | Client components in Chrome, against a server that's already running                                          | No                                  |
| `App: attach to running server`  | A server you started yourself with `pnpm dev --inspect`                                                       | No                                  |
| `Script: current file`           | The open file in `scripts/`, with the arguments you type (`seed-dev.ts` still refuses to run without `--yes`) | Yes                                 |
| `Emails: preview`                | The templates in `src/emails/`, as `pnpm email:dev` previews them                                             | No                                  |
| `Unit test: current file`        | The open `*.test.ts(x)` file, without a time limit                                                            | No                                  |
| `Integration test: current file` | The open `*.int.test.ts` file, against the test database, without a time limit                                | Yes                                 |
| `E2E test: current spec`         | The open spec in `e2e/` and its helpers, with a visible browser and no time limit                             | Yes                                 |

The Vitest and Playwright extensions' own debug buttons, next to each test, are the other way to
debug a single test.

**Fewer stops in Server Components.** In development, Next.js checks every page for instant
navigation by rendering it again in a background worker (`[worker 1]` in the Call Stack panel), so a
breakpoint on a line with JSX used to stop dozens of times per page load: 69 times on the sign-in
page when measured. `App: server and browser` and `App: server` set `SKIP_INSTANT_VALIDATION`,
which makes `next.config.ts` check only pages that ask for it (`instantInsights.validationLevel:
'manual-warning'`), and the same breakpoint stops 7 times, all in the real render. The price is that
these two configurations don't show Next's instant-navigation warnings; `pnpm dev` without the
debugger still does. For the attach configuration, start the server with
`SKIP_INSTANT_VALIDATION=1 pnpm dev --inspect`.

Things that can look like a problem but aren't:

- **A breakpoint on a line with JSX still stops more than once.** The real render is the stop with
  `renderFunctionComponent` in its call stack; the others are React rebuilding stack traces. Email
  previews repeat the same way.
- **A breakpoint on the `NEXT_RUNTIME` check in `src/instrumentation.ts` never stops**, because
  Next.js compiles that condition away. Put it on a line inside the block.
- **A page that only fails in the production build** (while prerendering) can't be debugged with
  these configurations, since the build has no server source maps. Run `pnpm build --debug-prerender`
  instead: it leaves the server code unminified, adds server source maps for readable stack traces,
  and keeps one failing page from stopping the rest of the build. Never deploy a build made this way.

## Scripts

| Command                    | What it does                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                 | Start the dev server                                                                                        |
| `pnpm build`               | Build for production                                                                                        |
| `pnpm start`               | Serve the production build                                                                                  |
| `pnpm lint`                | Check JS/TS with ESLint and CSS with Stylelint                                                              |
| `pnpm lint:fix`            | Fix and format JS/TS and CSS where possible                                                                 |
| `pnpm format`              | Format every file type with Prettier (CSS, JSON, Markdown)                                                  |
| `pnpm format:check`        | Check formatting without changing files                                                                     |
| `pnpm typecheck`           | Generate Next.js route types, then type-check with TypeScript                                               |
| `pnpm test`                | Run the unit and component tests (Vitest)                                                                   |
| `pnpm test:watch`          | Run the unit tests in watch mode                                                                            |
| `pnpm test:integration`    | Run the service tests against the test database (Vitest)                                                    |
| `pnpm test:e2e`            | Run the end-to-end tests (Playwright)                                                                       |
| `pnpm check:schema`        | Check that Better Auth's tables and the migrations match the config and the schema, as CI does              |
| `pnpm ci:local`            | Run every check CI runs, one after another (see [CI](ci-and-releases.md))                                   |
| `pnpm services:up`         | Start PostgreSQL and Mailpit (Docker)                                                                       |
| `pnpm services:down`       | Stop them (database data is kept)                                                                           |
| `pnpm email:dev`           | Preview the email templates at <http://localhost:3001>                                                      |
| `pnpm db:generate`         | Write a migration for schema changes (drizzle-kit)                                                          |
| `pnpm db:migrate`          | Apply pending migrations                                                                                    |
| `pnpm auth:schema`         | Regenerate Better Auth's tables after changing its config                                                   |
| `pnpm setup:platform`      | First-run setup from the command line (can also recover; see [First run](companies-and-roles.md#first-run)) |
| `pnpm db:seed --yes`       | Replace all local data with test accounts and companies (`--admin-mail` adds your own staff Admin)          |
| `pnpm jobs:run [job]`      | One tick, or one job now; more `jobs:` commands in [Background jobs](jobs.md#from-the-command-line)         |
| `pnpm sessions:revoke-all` | End sessions after a leak (see [After a suspected leak](deploying.md#after-a-suspected-leak))               |
