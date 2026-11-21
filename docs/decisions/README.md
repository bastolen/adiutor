# Decision records

Back to the [documentation](../README.md).

A decision record is a short page about one significant decision: the situation, what was chosen,
what it costs and what else was considered. The other docs pages say how Adiutor works. These pages
say why it works that way.

## When to add one

Add a record for a decision that a new contributor would otherwise question or undo. That's usually
one of these:

- **Architecture:** how the app is built and which tools and services it relies on.
- **Security model:** who may do what, and how sign-in, sessions and second steps work.
- **Process:** how changes are tested, merged and released.

A choice that the code and its comments already explain doesn't need one.

## How to add one

1. Copy the template below into a new file named `NNNN-short-title.md`: the next free number, then
   a few words of title in lowercase, joined by hyphens.
2. Set the status to "Accepted" and the date to the day of the decision. If you record a decision
   some time after it was made, add "(recorded after the decision was made)" after the date.
3. Keep it short, about 150 to 300 words: the reasoning and the trade-off, not the mechanics. Link to
   the docs page and section that hold the detail instead of repeating it, and name the key code
   in backticks.
4. Add it to the [index](#index).

Don't rewrite a record when the decision changes. Write a new record that replaces it, and set the
old record's status to "Superseded by NNNN", with a link to the new one.

## Template

```markdown
# NNNN. Title

- **Status:** Accepted
- **Date:** YYYY-MM-DD

## Context

The situation that called for a decision, and what mattered.

## Decision

What was chosen, with links to the docs and the key code.

## Consequences

What follows from it: what it costs, what you must keep doing, what it rules out.

## Alternatives considered

The other options, and why they weren't chosen.
```

## Index

| Number | Decision                                                                                                                           | Summary                                                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001   | [Invitation-only sign-up](0001-invitation-only-sign-up.md)                                                                         | No public sign-up: accounts come from invitations, Add user and first-run setup.                                                            |
| 0002   | [Trusted provider email addresses](0002-trusted-provider-email-addresses.md)                                                       | A GitHub or Google sign-in connects to the account with the address the provider verified.                                                  |
| 0003   | [Who needs MFA, and what counts](0003-who-needs-mfa-and-what-counts.md)                                                            | Staff Admins and Managers and company Admins need a strong second step; email codes don't count.                                            |
| 0004   | [Recent confirmation for sign-in changes and lasting access](0004-recent-confirmation-for-sign-in-changes-and-lasting-access.md)   | New ways in, for yourself or others, need your second step from the last 15 minutes.                                                        |
| 0005   | [Fixed seven-day sessions](0005-fixed-seven-day-sessions.md)                                                                       | Sessions end 7 days after the sign-in and are never extended.                                                                               |
| 0006   | [Nonce-based Content Security Policy](0006-nonce-based-content-security-policy.md)                                                 | Only scripts with the response's nonce run, so every page renders per request.                                                              |
| 0007   | [Permission checks in services, never the proxy](0007-permission-checks-in-services-never-the-proxy.md)                            | Rules in `src/lib/authz`, checks in the services; the proxy only sends signed-out visitors to sign in.                                      |
| 0008   | [Roles and companies are the app's own data](0008-roles-and-companies-are-the-apps-own-data.md)                                    | Better Auth handles identity only; companies, roles and invitations are Adiutor's own.                                                      |
| 0009   | [Cache Components, and pages kept alive](0009-cache-components-and-pages-kept-alive.md)                                            | Pages stay alive across navigation, so messages and dialogs use transient state.                                                            |
| 0010   | [UUIDv7 IDs generated by PostgreSQL](0010-uuidv7-ids-generated-by-postgresql.md)                                                   | Every ID is a time-ordered UUIDv7 from `uuidv7()`, never auto-increment.                                                                    |
| 0011   | [Squash-merged pull requests and Release Please](0011-squash-merged-prs-and-release-please.md)                                     | PR titles become the commits Release Please versions from; versions stay 0.x until 1.0.0 is chosen.                                         |
| 0012   | [Tests cover the application only](0012-tests-cover-the-application-only.md)                                                       | No tests for config, tooling, `scripts/` or the test helpers in `tests/`.                                                                   |
| 0013   | [One Docker image with the whole application](0013-one-docker-image-with-the-whole-application.md)                                 | One image runs the server and every command; the database is the operator's.                                                                |
| 0014   | [Languages without URLs, with next-intl](0014-languages-without-urls-with-next-intl.md)                                            | The language comes from a cookie, then Adiutor's default; messages are ICU sentences, checked per key.                                      |
| 0015   | [Spend CI minutes only on untested code](0015-spend-ci-minutes-only-on-untested-code.md)                                           | Passing runs leave records any run here can reuse; Renovate's majors wait for approval.                                                     |
| 0016   | [Ship Inter and JetBrains Mono](0016-ship-inter-and-jetbrains-mono.md)                                                             | Adiutor serves its own fonts, so text looks and measures the same on every device and in CI.                                                |
| 0017   | [Staff can sign in as users](0017-staff-sign-in-as-users.md)                                                                       | Some staff see Adiutor as a user for 30 minutes, with strong MFA, a banner, and changes refused.                                            |
| 0018   | [Recurring and queued jobs in PostgreSQL, started by one tick](0018-background-jobs-in-postgres-with-one-tick.md)                  | A tick every 5 minutes runs recurring and queued jobs, with their state and history in PostgreSQL.                                          |
| 0019   | [Requests: one number series, plain text and a history in one table](0019-requests-one-series-plain-text-and-a-history.md)         | One series with a display prefix, types that set a staff-only priority, plain text, and one table for replies and changes.                  |
| 0020   | [Save a language only when its owner picks it](0020-save-a-language-only-when-its-owner-picks-it.md)                               | Signing in never saves a language: the browser gets the account's, and an account on Default removes the cookie.                            |
| 0021   | [Markdown for request text: rendered on the server, written in an editor](0021-markdown-for-request-text.md)                       | New texts are Markdown, rendered on the server from a tree and written in an editor; older texts stay plain.                                |
| 0022   | [Profile pictures from providers, served through Adiutor](0022-profile-pictures-from-providers.md)                                 | A connected GitHub or Google account's picture, fetched by the server and served from `/avatars/<account>`; nothing stored.                 |
| 0023   | [Mentions: a marker in the text that points at a row, and a list by what the writer may know](0023-mentions-as-markers-to-rows.md) | A mention is a link-shaped marker to a row; the text holds no name or user ID, and the browser gets keys, not IDs.                          |
| 0024   | [Edit replies and descriptions, with earlier versions for the staff](0024-edit-replies-and-descriptions.md)                        | Authors edit their replies and those who take part the description, while open; the staff read the earlier versions.                        |
| 0026   | [Internal notes: a kind of entry only the staff read](0026-internal-notes-as-a-kind-of-entry.md)                                   | A note is a `note` entry the services leave out for company readers; it changes no status or activity and subscribes no one at the company. |
| 0027   | [Request types the staff manage](0027-request-types-the-staff-manage.md)                                                           | Types are rows staff Admins manage: one text, keys that never change, archived rather than deleted, in the audit log.                       |
