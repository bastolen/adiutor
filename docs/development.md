# Local development

Running Adiutor on your machine after the [quick start](../README.md#quick-start): the first run,
migrations, test data, starting over, and every script. Back to the [documentation](README.md).

## First run

Open <http://localhost:3000>. On the first run it goes to `/setup`, where you choose the name
users see and create your Admin account. After that, sign in at `/auth`. Every email the app sends shows up in
Mailpit at <http://localhost:8025> (see [Email](email.md)).

For scripted deployments, `pnpm setup:platform --staff-name "Adiutor" --email you@adiutor.dev --name
"Your Name"` does the same from the command line (the account then signs in with an email link).

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
times, some audit log entries and sample errors from the last few days to look up under Logs →
Errors (`scripts/sample-errors.ts`; `pnpm jobs:run` removes them once they're 7 days old).
`scripts/seed-dev.ts` lists the accounts and their password. The open invitations are emailed to
Mailpit, and the script prints the authenticator setup key, backup codes and the links that still
work. It reads the same validated `.env` as the app (so `BETTER_AUTH_URL` must be set), and refuses
to run (`src/lib/dev-seed-guard.ts`) in production, when `BETTER_AUTH_URL` isn't on this machine
(`localhost`, `127.0.0.1`, `[::1]` or a `.localhost` name, as on a server whose database happens to
listen on `localhost`), against the test database or against a database that isn't on this machine.

The seeded accounts all use `@adiutor.test` addresses, which can't receive mail from GitHub or
Google. To sign in with your own provider account, add `--admin-mail` with its verified address:
`pnpm db:seed --yes --admin-mail you@adiutor.dev` also creates a staff Admin with that address and
no password. Sign in as it with an email link (it arrives in Mailpit) or with GitHub or Google. It
starts without MFA, so unless your GitHub account has two-factor authentication on, the Security
page asks you to set it up, as for any staff Admin.

## Scripts

| Command                    | What it does                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                 | Start the dev server                                                                                        |
| `pnpm build`               | Build for production                                                                                        |
| `pnpm start`               | Serve the production build                                                                                  |
| `pnpm lint`                | Check JS/TS with ESLint and CSS/SCSS with Stylelint                                                         |
| `pnpm lint:fix`            | Fix and format JS/TS, CSS and SCSS where possible                                                           |
| `pnpm format`              | Format every file type with Prettier (CSS, SCSS, JSON, Markdown)                                            |
| `pnpm format:check`        | Check formatting without changing files                                                                     |
| `pnpm typecheck`           | Generate Next.js route types, then type-check with TypeScript                                               |
| `pnpm test`                | Run the unit and component tests (Vitest)                                                                   |
| `pnpm test:watch`          | Run the unit tests in watch mode                                                                            |
| `pnpm test:integration`    | Run the service tests against the test database (Vitest)                                                    |
| `pnpm test:e2e`            | Run the end-to-end tests (Playwright)                                                                       |
| `pnpm services:up`         | Start PostgreSQL and Mailpit (Docker)                                                                       |
| `pnpm services:down`       | Stop them (database data is kept)                                                                           |
| `pnpm email:dev`           | Preview the email templates at <http://localhost:3001>                                                      |
| `pnpm db:generate`         | Write a migration for schema changes (drizzle-kit)                                                          |
| `pnpm db:migrate`          | Apply pending migrations                                                                                    |
| `pnpm auth:schema`         | Regenerate Better Auth's tables after changing its config                                                   |
| `pnpm setup:platform`      | First-run setup from the command line (can also recover; see [First run](companies-and-roles.md#first-run)) |
| `pnpm db:seed --yes`       | Replace all local data with test accounts and companies (`--admin-mail` adds your own staff Admin)          |
| `pnpm jobs:run`            | Run the background jobs once (see [Background jobs](deploying.md#background-jobs))                          |
| `pnpm sessions:revoke-all` | End sessions after a leak (see [After a suspected leak](deploying.md#after-a-suspected-leak))               |
