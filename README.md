<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-on-dark.svg" />
    <img src="public/brand/logo.svg" alt="Adiutor" width="280" />
  </picture>
</h1>

[![CI](https://github.com/bastolen/adiutor/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bastolen/adiutor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Adiutor is a shared service desk: a ticketing system where companies raise requests with your staff
and work them through together by commenting, explaining, approving and reporting, without chasing
emails.

It's for staff who support several companies, such as IT service providers, agencies and
consultants: the companies raise requests, and the staff work them through with them. Each company
manages its own users, and the staff see every company.

**Status:** early development. Accounts, companies, roles, invitations, sign-in security and
requests, with staff assigned and people subscribed to them, are built; emails about requests
and approving the work come next.

## Features

- **Requests.** Companies raise requests, and both sides work each one through in one
  conversation: replies, a status from Open to Done (or Cancelled), and a type that sets a
  priority only the staff see. Descriptions and replies are written in an editor that turns
  Markdown into formatting as it's typed, with lists, tables and highlighted code, and can mention
  people, picked from a list at "@". Company Admins and Clients raise, reply, close and reopen;
  Watchers follow; the staff work on every company's requests and assign each to one or more of
  themselves, which everyone on the request sees. Everyone who reads a request can subscribe to
  it, and whoever raises it, replies to it or is mentioned in it is subscribed. See
  [Requests](docs/requests.md).
- **Companies and staff.** Staff add companies and invite each company's first Admin. Users can
  belong to several companies, with a role in each (Admin, Client or Watcher), and staff have their
  own roles (Admin, Manager, Finance and Support). See
  [Companies, users and roles](docs/companies-and-roles.md).
- **Invitations.** Invite people by email or with a single-use invite link, up to 20 addresses at
  once, with a reminder before an invitation expires. There's no public sign-up.
- **Sign-in.** Email and password, passkeys, email links, and GitHub or Google accounts. See
  [Sign-in and accounts](docs/authentication.md).
- **Pictures.** People show the picture of a GitHub or Google account they connected, or their
  initials, chosen on their account page. Adiutor serves the picture itself and stores no files.
- **Multi-factor authentication.** Authenticator apps, passkeys, email codes and backup codes.
  Required for staff Admins and Managers and for company Admins, and changing a sign-in method
  needs a recent confirmation. See [Multi-factor authentication](docs/mfa.md).
- **Account security.** Users see their recent activity and signed-in devices, and get an email
  about every security change. Staff Admins can reset two-step verification, sign users out and
  deactivate accounts. A searchable audit log, rate limits and a strict Content Security Policy
  guard the rest, and staff Admins can look up the error references people send them. See
  [Security measures](docs/security-measures.md).
- **Sign in as a user.** Staff Admins, Managers and Support can see Adiutor the way a user does, to
  check what isn't working for them. It lasts 30 minutes at most, needs strong MFA, shows a banner
  and changes nothing in the user's name. The user gets an email, and every start is in the audit
  log. See [Signing in as a user](docs/authentication.md#signing-in-as-a-user).
- **Background jobs.** Reminders, clean-ups and emails that can wait a few minutes run in the
  background, and are tried again when they fail. Staff Admins and Managers see them under Logs →
  Jobs, where staff Admins also run, pause and retry them. See [Background jobs](docs/jobs.md).
- **Accessible, in light and dark mode.** Built to meet WCAG 2.2 AA, with full keyboard support.
  See [Design, accessibility and dark mode](docs/design.md).
- **English, Dutch and Spanish.** The staff choose Adiutor's default language, which everyone
  follows until they choose their own on the sign-in page or their account, without the address
  changing; emails reach them in it. Invitations go out in the language the sender picks. See
  [Languages](docs/i18n.md).

**Coming next:** emails about requests, and an approval step for finished work.

## Tech stack

- **App:** [Next.js](https://nextjs.org) 16 (App Router, Cache Components), React 19 and
  TypeScript, with [next-intl](https://next-intl.dev) for languages
- **Interface:** Tailwind CSS 4, [Radix UI](https://www.radix-ui.com) and
  [Lucide](https://lucide.dev) icons
- **Sign-in:** [Better Auth](https://www.better-auth.com), with passkeys, two-factor
  authentication, email links and GitHub and Google sign-in
- **Data:** PostgreSQL 18 with [Drizzle ORM](https://orm.drizzle.team), and Zod for validation
- **Email:** [React Email](https://react.email) templates sent over SMTP, with
  [Mailpit](https://mailpit.axllent.org) catching them in development
- **Tests:** Vitest with Testing Library, and Playwright with axe
- **Tooling:** pnpm, Docker Compose, ESLint (Airbnb style), Prettier, Stylelint, Husky and
  commitlint
- **Automation:** GitHub Actions, Release Please, Renovate and Dependabot

## Quick start

You need Node.js 26.13 or newer, the current LTS (see `.nvmrc`), pnpm (install it once with
`npm install --global pnpm`; it switches to the version the project pins by itself) and Docker (for
the local database and mail viewer).

```bash
pnpm install
cp .env.example .env    # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm services:up        # start PostgreSQL and Mailpit in Docker
pnpm db:migrate         # create the tables
pnpm dev
```

Open <http://localhost:3000>. On the first run it goes to `/setup`, where you choose the name users
see and create your Admin account. After that, sign in at `/auth`. Every email the app sends shows
up in Mailpit at <http://localhost:8025>.

To try every role, `pnpm db:seed --yes` replaces the local data with test companies and accounts
(`scripts/seed-dev.ts` lists them); add `--admin-mail you@adiutor.dev` to also get a staff Admin
you can sign in to with your own GitHub or Google account. [Local development](docs/development.md)
has more on the first run, the test accounts, starting over and every script.

### Running the tests

```bash
pnpm test                               # unit and component tests
pnpm test:integration                   # service tests against the test database
pnpm exec playwright install chromium   # once, for the end-to-end tests
pnpm test:e2e                           # end-to-end tests
pnpm lint && pnpm format:check && pnpm typecheck
pnpm ci:local                           # everything CI checks, in one go
```

The integration and end-to-end tests need `pnpm services:up` running. See [Testing](docs/testing.md).

## Documentation

The [docs](docs/README.md) go into detail, one topic each:

| Page                                                      | What it covers                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Local development](docs/development.md)                  | First run, test accounts, starting over, every script                           |
| [Where the code lives](docs/project-structure.md)         | The folders of the repository                                                   |
| [Testing](docs/testing.md)                                | Unit, integration and end-to-end tests                                          |
| [Code style and tooling](docs/code-style.md)              | Linters, formatting, JSDoc, editor setup, Git hooks                             |
| [CI, releases and dependencies](docs/ci-and-releases.md)  | CI, protecting `main`, security advisories, releases, dependency updates        |
| [Companies, users and roles](docs/companies-and-roles.md) | Roles and permissions, staff screens, invitations                               |
| [Requests](docs/requests.md)                              | Statuses, types and priorities, numbers, text, who may do what, the pages       |
| [Sign-in and accounts](docs/authentication.md)            | Sign-in methods, sessions, account pages, security emails                       |
| [Multi-factor authentication](docs/mfa.md)                | Second steps, who needs them, confirming sessions                               |
| [Security measures](docs/security-measures.md)            | Audit log, rate limits, tokens, names, lock order, headers, CSP                 |
| [Email](docs/email.md)                                    | Templates, previews, Mailpit, how emails are sent                               |
| [Background jobs](docs/jobs.md)                           | The tick, recurring and queued jobs, the Jobs page, commands, adding a job      |
| [Design, accessibility and dark mode](docs/design.md)     | Components, tables, colours, keyboard support, dark mode, brand                 |
| [Languages](docs/i18n.md)                                 | Choosing a language, translation catalogues, formatting, checks                 |
| [Deploying and running](docs/deploying.md)                | Install and upgrade, Vercel, Docker, server setup, client IP, jobs, logs, leaks |
| [Decision records](docs/decisions/README.md)              | Why Adiutor works the way it does, one decision per page                        |

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to set up the project,
the code style and how to get a change merged. Please follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please don't report security issues in public issues or pull requests. Report them privately as
described in [SECURITY.md](SECURITY.md).

## License

The code is released under the [MIT License](LICENSE).

The MIT License covers the source code only. The Adiutor name, logo and other brand assets (including
the files in `public/brand/`) are not covered by it and may not be used to represent other projects
or products without permission.

The fonts Adiutor ships, [Inter](https://github.com/rsms/inter) and
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), are under the SIL Open Font License
1.1 (see `LICENSES/`).
