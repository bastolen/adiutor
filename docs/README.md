# Documentation

The [README](../README.md) covers what Adiutor is and how to get it running. These pages go into
detail, one topic each.

## Working on Adiutor

- [Local development](development.md): the first run, test accounts, starting over and every
  script.
- [Where the code lives](project-structure.md): the folders of the repository and what belongs in
  each.
- [Testing](testing.md): unit, integration and end-to-end tests.
- [Code style and tooling](code-style.md): ESLint, Prettier, Stylelint, JSDoc, the editor setup
  and the Git hooks.
- [CI, releases and dependencies](ci-and-releases.md): what CI checks, security advisories, pinned
  actions, releases and dependency updates.

## How it works

- [Companies, users and roles](companies-and-roles.md): roles and permissions, the staff screens,
  accounts and invitations.
- [Sign-in and accounts](authentication.md): sign-in methods, email links, sessions, deactivated
  accounts, the account pages and security emails.
- [Multi-factor authentication](mfa.md): second steps, who must have them, and when a session
  counts as confirmed.
- [Security measures](security-measures.md): the audit log, rate limits, the client IP, tokens,
  the name checks, the lock order of concurrent changes, security headers and the Content Security
  Policy.
- [Email](email.md): the templates, previewing them, Mailpit, and how emails leave the app.
- [Design, accessibility and dark mode](design.md): the component library, tables, colours,
  keyboard support, dark mode and the brand assets.

## Running it

- [Deploying and running Adiutor](deploying.md): installing and upgrading, what to set up on a
  server, the client IP address, background jobs, logs, rotating the auth secret, and what to do
  after a suspected leak.

## The project

- [Contributing](../CONTRIBUTING.md), the [Code of Conduct](../CODE_OF_CONDUCT.md) and the
  [security policy](../SECURITY.md).
