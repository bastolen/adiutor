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
3. Keep it short, about 200 to 450 words: the reasoning and the trade-off, not the mechanics. Link to
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

| Number | Decision                                                                                                                           | Summary                                                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001   | [Invitation-only sign-up](0001-invitation-only-sign-up.md)                                                                         | No public sign-up: accounts come from invitations, Add user and first-run setup.                                                                  |
| 0002   | [Trusted provider email addresses](0002-trusted-provider-email-addresses.md)                                                       | A GitHub or Google sign-in connects to the account with the address the provider verified.                                                        |
| 0003   | [Who needs MFA, and what counts](0003-who-needs-mfa-and-what-counts.md)                                                            | Staff Admins and Managers and company Admins need a strong second step; email codes don't count.                                                  |
| 0004   | [Recent confirmation for sign-in changes and lasting access](0004-recent-confirmation-for-sign-in-changes-and-lasting-access.md)   | New ways in, for yourself or others, need your second step from the last 15 minutes.                                                              |
| 0005   | [Fixed seven-day sessions](0005-fixed-seven-day-sessions.md)                                                                       | Sessions end 7 days after the sign-in and are never extended.                                                                                     |
| 0006   | [Nonce-based Content Security Policy](0006-nonce-based-content-security-policy.md)                                                 | Only scripts with the response's nonce run, so every page renders per request.                                                                    |
| 0007   | [Permission checks in services, never the proxy](0007-permission-checks-in-services-never-the-proxy.md)                            | Rules in `src/lib/authz`, checks in the services; the proxy only sends signed-out visitors to sign in.                                            |
| 0008   | [Roles and companies are the app's own data](0008-roles-and-companies-are-the-apps-own-data.md)                                    | Better Auth handles identity only; companies, roles and invitations are Adiutor's own.                                                            |
| 0009   | [Cache Components, and pages kept alive](0009-cache-components-and-pages-kept-alive.md)                                            | Pages stay alive across navigation, so messages and dialogs use transient state.                                                                  |
| 0010   | [UUIDv7 IDs generated by PostgreSQL](0010-uuidv7-ids-generated-by-postgresql.md)                                                   | Every ID is a time-ordered UUIDv7 from `uuidv7()`, never auto-increment.                                                                          |
| 0011   | [Squash-merged pull requests and Release Please](0011-squash-merged-prs-and-release-please.md)                                     | PR titles become the commits Release Please versions from; versions stay 0.x until 1.0.0 is chosen.                                               |
| 0012   | [Tests cover the application only](0012-tests-cover-the-application-only.md)                                                       | No tests for config, tooling, `scripts/` or the test helpers in `tests/`.                                                                         |
| 0013   | [One Docker image with the whole application](0013-one-docker-image-with-the-whole-application.md)                                 | One image runs the server and every command; the database is the operator's.                                                                      |
| 0014   | [Languages without URLs, with next-intl](0014-languages-without-urls-with-next-intl.md)                                            | The language comes from a cookie, then Adiutor's default; messages are ICU sentences, checked per key.                                            |
| 0015   | [Spend CI minutes only on untested code](0015-spend-ci-minutes-only-on-untested-code.md)                                           | Superseded by 0042. Passing runs left records any run here could reuse; Renovate's majors wait for approval.                                      |
| 0016   | [Ship Inter and JetBrains Mono](0016-ship-inter-and-jetbrains-mono.md)                                                             | Adiutor serves its own fonts, so text looks and measures the same on every device and in CI.                                                      |
| 0017   | [Staff can sign in as users](0017-staff-sign-in-as-users.md)                                                                       | Some staff see Adiutor as a user for 30 minutes, with strong MFA, a banner, and changes refused except request work (0028).                       |
| 0018   | [Recurring and queued jobs in PostgreSQL, started by one tick](0018-background-jobs-in-postgres-with-one-tick.md)                  | A tick every 5 minutes runs recurring and queued jobs, with their state and history in PostgreSQL.                                                |
| 0019   | [Requests: one number series, plain text and a history in one table](0019-requests-one-series-plain-text-and-a-history.md)         | One series with a display prefix, types that set a staff-only priority, plain text, and one table for replies and changes.                        |
| 0020   | [Save a language only when its owner picks it](0020-save-a-language-only-when-its-owner-picks-it.md)                               | Signing in never saves a language: the browser gets the account's, and an account on Default removes the cookie.                                  |
| 0021   | [Markdown for request text: rendered on the server, written in an editor](0021-markdown-for-request-text.md)                       | New texts are Markdown, rendered on the server from a tree and written in an editor; older texts stay plain.                                      |
| 0022   | [Profile pictures from providers, served through Adiutor](0022-profile-pictures-from-providers.md)                                 | A connected GitHub or Google account's picture, fetched by the server and served from `/avatars/<account>`; nothing stored.                       |
| 0023   | [Mentions: a marker in the text that points at a row, and a list by what the writer may know](0023-mentions-as-markers-to-rows.md) | A mention is a link-shaped marker to a row; the text holds no name or user ID, and the browser gets keys, not IDs.                                |
| 0024   | [Edit replies and descriptions, with earlier versions for the staff](0024-edit-replies-and-descriptions.md)                        | Authors edit their replies and those who take part the description, while open; the staff read the earlier versions.                              |
| 0025   | [The people on a request: one table with roles, and subscribing as a preference](0025-people-on-a-request-one-table-with-roles.md) | Assignees and subscribers are rows of one table; anyone who reads a request can follow it, and it leaves no history.                              |
| 0026   | [Internal notes: a kind of entry only the staff read](0026-internal-notes-as-a-kind-of-entry.md)                                   | A note is a `note` entry the services leave out for company readers; it changes no status or activity and subscribes no one at the company.       |
| 0027   | [Request types the staff manage](0027-request-types-the-staff-manage.md)                                                           | Types are rows staff Admins manage: one text, keys that never change, archived rather than deleted, in the audit log.                             |
| 0028   | [Request work while signed in as a user](0028-request-work-while-signed-in-as-a-user.md)                                           | Staff signed in as a user may do that user's request work; each row records the staff member, told only to the user and audit:view staff.         |
| 0029   | [Staff choose the offered languages](0029-staff-choose-the-offered-languages.md)                                                   | Staff Admins turn languages off; one that's off isn't offered, its people get the default, and the default stays on.                              |
| 0030   | [Times in each person's own time zone, which their browser sets first](0030-times-in-each-persons-own-time-zone.md)                | Each account has a zone, saved from the browser at the first visit; pages show times in it, emails name it.                                       |
| 0031   | [Emails about requests: one per person and request, with the whole reply](0031-emails-about-requests.md)                           | The people on a request are told of replies and status changes in one batched email, read when it's sent.                                         |
| 0032   | [Internal notes email the staff](0032-internal-notes-email-the-staff.md)                                                           | A note goes to the staff on the request and the staff it mentions; it's checked when queued and when read, so nobody at the company hears of one. |
| 0033   | [Solutions the company approves](0033-solutions-the-company-approves.md)                                                           | Staff send a reply as the solution; the request waits for approval until the company's Admins or Clients approve (done) or deny (in progress).    |
| 0034   | [Settings in one key/value table, typed and checked in code](0034-settings-in-one-key-value-table.md)                              | One `setting` row per setting; the registry in `src/server/settings/` types and checks them, and setup is a setting of its own.                   |
| 0035   | [A posted mention carries its key for the readers who may write](0035-mention-keys-on-posted-texts.md)                             | A mention on a page carries its key for readers who may write in the request, so a pasted mention stays one; the server still checks it.          |
| 0036   | [Links in emails about requests sign the recipient in](0036-sign-in-links-in-request-emails.md)                                    | A reusable link for 14 days skips the step-up page; anything that needs a recent confirmation asks for it straight away.                          |
| 0037   | [A board of requests, with a Move menu on every card](0037-a-board-of-requests.md)                                                 | A lane per status at its own route; every card's Move menu moves it, drag is only an extra; the list's sort, no pages, `from` against old boards. |
| 0038   | [Request links continue by themselves where the browser can't tell a click](0038-request-links-continue-by-themselves.md)          | Safari never says a person clicked; with nobody signed in, the confirmation page sends its Continue once per page load.                           |
| 0039   | [The static checks follow the tests on main](0039-static-checks-follow-the-tests-on-main.md)                                       | Superseded by 0042. Pull requests always ran them; `main` only when the tests ran.                                                                |
| 0040   | [Older browsers' Continue is checked by its Origin](0040-older-browsers-continue-by-origin.md)                                     | A request link's Continue without `Sec-Fetch-*` headers (Safari before 16.4) counts when its `Origin` is exactly the site's.                      |
| 0041   | [Email links continue only from their own page, by a POST](0041-email-links-continue-by-post.md)                                   | The sign-in email page's Continue is a `POST` only it makes, checked like a request link's; every `GET` of the link goes to the page first.       |
| 0042   | [Wider pages for the lists of requests and people](0042-wider-pages-for-lists-of-requests-and-people.md)                           | Requests, users, a company's pages and Settings grow to 1200px on a wide screen, with more columns from 1536px; other pages keep 944px.           |
| 0042   | [Every CI job runs every time](0042-every-ci-job-runs-every-time.md)                                                               | The repository is public, so every job runs on every pull request and on `main`; arm64 builds on an Arm runner.                                   |
