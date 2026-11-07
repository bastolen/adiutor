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

**Status:** early development. Accounts, companies, roles, invitations and sign-in security are
built; requests, the tickets themselves, come next.

## Features

- **Companies and staff.** Staff add companies and invite each company's first Admin. Users can
  belong to several companies, with a role in each (Admin, Client or Watcher), and staff have their
  own roles (Admin, Manager, Finance and Support). See
  [Companies, users and roles](docs/companies-and-roles.md).
- **Invitations.** Invite people by email or with a single-use invite link, up to 20 addresses at
  once, with a reminder before an invitation expires. There's no public sign-up.
- **Sign-in.** Email and password, passkeys, email links, and GitHub or Google accounts. See
  [Sign-in and accounts](docs/authentication.md).
- **Multi-factor authentication.** Authenticator apps, passkeys, email codes and backup codes.
  Required for staff Admins and Managers and for company Admins, and changing a sign-in method
  needs a recent confirmation. See [Multi-factor authentication](docs/mfa.md).
- **Account security.** Users see their recent activity and signed-in devices, and get an email
  about every security change. Staff Admins can reset two-step verification, sign users out and
  deactivate accounts. A searchable audit log, rate limits and a strict Content Security Policy
  guard the rest, and staff Admins can look up the error references people send them. See
  [Security measures](docs/security-measures.md).
- **Accessible, in light and dark mode.** Built to meet WCAG 2.2 AA, with full keyboard support.
  See [Design, accessibility and dark mode](docs/design.md).

**Coming next: requests.** Companies will raise requests, comment on them and approve them, and
follow them through with the staff. The company roles are already set up for it.

## Tech stack

- **App:** [Next.js](https://nextjs.org) 16 (App Router, Cache Components), React 19 and
  TypeScript
- **Interface:** Tailwind CSS 4 and SCSS, [Radix UI](https://www.radix-ui.com) and
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

You need Node.js 24.18 or newer (see `.nvmrc`), pnpm (`corepack enable` installs the version the
project pins) and Docker (for the local database and mail viewer).

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
```

The integration and end-to-end tests need `pnpm services:up` running. See [Testing](docs/testing.md).

## Documentation

The [docs](docs/README.md) go into detail, one topic each:

| Page                                                      | What it covers                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Local development](docs/development.md)                  | First run, test accounts, starting over, every script                    |
| [Where the code lives](docs/project-structure.md)         | The folders of the repository                                            |
| [Testing](docs/testing.md)                                | Unit, integration and end-to-end tests                                   |
| [Code style and tooling](docs/code-style.md)              | Linters, formatting, JSDoc, editor setup, Git hooks                      |
| [CI, releases and dependencies](docs/ci-and-releases.md)  | CI, security advisories, releases, dependency updates                    |
| [Companies, users and roles](docs/companies-and-roles.md) | Roles and permissions, staff screens, invitations                        |
| [Sign-in and accounts](docs/authentication.md)            | Sign-in methods, sessions, account pages, security emails                |
| [Multi-factor authentication](docs/mfa.md)                | Second steps, who needs them, confirming sessions                        |
| [Security measures](docs/security-measures.md)            | Audit log, rate limits, tokens, names, lock order, headers, CSP          |
| [Email](docs/email.md)                                    | Templates, previews, Mailpit, how emails are sent                        |
| [Design, accessibility and dark mode](docs/design.md)     | Components, tables, colours, keyboard support, dark mode, brand          |
| [Deploying and running](docs/deploying.md)                | Install and upgrade, server setup, client IP, jobs, logs, secrets, leaks |

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
