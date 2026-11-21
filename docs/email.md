# Email

The email templates, which language each email is written in, how to preview them and see what
was sent, and how emails leave the app. Back to the [documentation](README.md).

Emails are built with [React Email](https://react.email) and sent as HTML with a plain-text version.

## Templates

One file per email in `src/emails/`:

- `magic-link.tsx`, `reset-password.tsx`, `verify-email.tsx`, `two-factor-code.tsx`,
  `account-created.tsx` and `security-notice.tsx` for accounts
- `staff-admin-added.tsx` for the staff Admins when someone else becomes one (given the role, or
  by an invitation or invite link), naming the new Admin and who made it happen, without a device
  or IP address (`notifyStaffAdminAdded` in `src/server/people/staff-admin-notice.ts` queues one
  `staff-admin-added` job per Admin; see [Background jobs](jobs.md#queued-jobs))
- `job-failing.tsx` for the staff Admins when a background job keeps failing, with the error's
  reference and a link to it under Logs → Errors, at most once a day per job (`alertStaffAdmins` in
  `src/server/jobs/alerts.ts`, see [Background jobs](jobs.md#failures))
- `invitation.tsx`, `invitation-reminder.tsx`, `invite-link-confirmation.tsx`,
  `already-member.tsx` and `already-invited.tsx` for companies (`already-invited.tsx` goes to
  someone who claimed an invite link while their address already has an open invitation there that
  someone sent, which the claim keeps: it points to the earlier invitation email and links to the
  sign-in page)
- `request-update.tsx` for the people on a request when someone replies to it or changes its
  status, for the staff on it when someone writes an internal note (marked as one, and never for
  anyone at the company), and for someone who is put on one (assigned, mentioned, or subscribed
  by someone else): one email per person and request with everything that happened, each reply in full
  (`EmailMarkdown`), the statuses in the reader's words, the request's number as its first link
  and a subject without words of its own, the request's number and title, and a footer that links
  to the account's setting that turns them off (the `request-update` jobs, batched; see
  [Emails](requests.md#emails)). Its links are the reader's own, which sign them in for 14 days
  (see [Links in emails about requests](authentication.md#links-in-emails-about-requests)), and a
  note says not to forward it
- `added-to-company.tsx` for someone staff added to a company with a role (`addMember` queues an
  `added-to-company` job in the transaction that adds them, so it goes out at the next tick; see
  [Background jobs](jobs.md#queued-jobs))

Each exports the template, example `PreviewProps` and a builder that returns the email to send.

Every template's props extend `EmailBaseProps` (`appUrl`, `locale`, `logoSrc`) from
`src/emails/base-props.ts`, and its `PreviewProps` start with `...PREVIEW_BASE` (the Adiutor app URL,
English (US) and the preview logo). Every builder takes the recipient's `locale` with the props:
the text, the subject (from the same messages), dates (`formatDateTime` with the locale) and
the document's `lang` follow it. A template that shows a time also takes the recipient's
`timeZone` and names the zone ([Which time zone](#which-time-zone)). The text lives in the `emails` catalogue, one group per template
(`emails.invitation.subject`, `.heading`, ...), and templates read it with
`translator(locale, 'emails.<name>')`, so they render outside Next.js too (scripts, the hourly job);
see [Emails](i18n.md#emails). Templates share the frame and building blocks in
`src/components/email/`:

- `EmailLayout`: the logo, the white card and a footer that says why the email was sent, with
  `<html lang>` set to the locale
- `EmailButton`, `EmailHeading`, `EmailParagraph`, `EmailNote`, `EmailCode` (a one-time code in
  a monospace box) and `LinkFallback`
- `RoleSummary`, which names the role and what it can do from the `roles` catalogue
- `EmailMarkdown`, which shows a request's description or reply formatted, from the tree the
  request's page renders, so the rules for what someone else wrote hold in an email too (see
  [Text people write](security-measures.md#text-people-write)): headings below the email's own,
  lists, tables (in columns in the email's plain text), quotes and code without colours, images
  as links, the people it mentions by name, and the plain text for a text stored as plain text or
  too costly to format
- the colours and fonts in `theme.ts` (`fontFamily`, `monoFontFamily`), which match the app's
  light theme as inline styles; the fonts are the device's own, not the Inter and JetBrains Mono the
  app ships, because many email clients block or strip web fonts

`security-notice.tsx` is one template with a wording per kind (`SECURITY_NOTICE_KINDS`): a changed or
added password, two-step verification, backup codes, passkeys and connected GitHub or Google accounts,
an MFA reset, signing out everywhere, deactivating, reactivating and deleting an account, staff role
changes, a changed company role and a removal from a company, the pauses after too many wrong
passwords (`password_sign_in_paused`) or codes (`two_factor_locked`), and a staff member signing in
as the recipient (`impersonation_started`). Each kind's subject, heading
and text are ICU messages in `emails.securityNotice.<kind>`, and the footer and the advice for when
it wasn't them are `select`s on the kind (`reason`, `ifNotYou`). The advice follows who can have
made the change: one the recipient can make themself ends with what to do if it wasn't them (reset
the password), one only an administrator makes (deactivating or reactivating the account, signing
it out everywhere, a staff or company role, a removal from a company) says to contact the
administrator if it wasn't expected, and a reset of two-step verification says to do so right away
and to change the password. Most are queued (the
`security-notice` job, see [Security emails](authentication.md#security-emails)), and the job reads
the names when it sends them, from the IDs it was queued with: `{provider}` from the provider ID,
`{role}` (named in the recipient's language), `{company}` from the company, `{name}` from the staff
member and `{staff}` (the name the staff are shown with to users). The notice to a deleted account,
sent straight away (`sendAccountDeletedNotice`), names none of them. Each has a stand-in ("A provider", "a new role",
"your company", "A staff member", "Adiutor") when it's missing, and `{minutes}` is how long signing
in as someone lasts (`IMPERSONATION_MINUTES`). Both build the email the same way
(`buildSecurityNotice` in `src/server/auth/security-notice-email.ts`). The email names the device
and IP address only for changes the recipient made themselves (see
[Security emails](authentication.md#security-emails)). Every kind
links to the Security page except `account_deactivated` and `account_deleted`, whose recipients
can't use it. `impersonation_started` links to its "Sign-ins by staff" card (`#staff-sign-in`,
`NOTICE_SECTIONS`), where the user can turn it off, as the email says.

## Which language

An email is written in its recipient's language: the one they saved (`user.locale`) while Adiutor
offers it; for someone on Default (none saved), someone whose language is turned off, or someone
without an account, Adiutor's default language (the `staff.default_locale` setting); failing that
(before setup), English (US). A language that's turned off counts as none everywhere below, an
invitation's too ([Offered languages](i18n.md#offered-languages)). `recipientLocale`
(`src/server/recipient-locale.ts`) is that rule. The language of whoever caused the email doesn't
count: a staff Admin browsing in Dutch doesn't send a user on Default a Dutch notice. Only emails
someone asks for themselves follow the language their browser shows: an invite link's confirmation
(`requesterLocale`, which reads `ServiceContext.requestLocale`), and, for an account on Default,
the sign-in link, password reset and verification (`emailLocale` in `src/lib/auth.ts`: the language
cookie, else Adiutor's default).

| Email                                                                                        | Language                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in link, password reset, verification, code                                             | The user's, else the request's (`emailLocale` in `src/lib/auth.ts`; the sign-in link works it out before the lookup that runs after the response) |
| Security notices                                                                             | The recipient's, looked up by ID or address; a deleted account's is read before the deletion and passed in (`locale`)                             |
| Invitation, its resends and its reminder                                                     | The invitation's (`invitation.locale`), or the invitee's own when they have an account with a saved language                                      |
| Invite-link confirmation, "already invited"                                                  | The language of whoever opened the link, which the invitation it turns into keeps                                                                 |
| "Already a member", added to a company, staff Admin, job keeps failing, news about a request | Each recipient's own                                                                                                                              |
| Welcome (Add user)                                                                           | The language given for the new user, which is saved as theirs; for Default, Adiutor's default language                                            |

`invitation.locale` (NOT NULL, `en-US` by default) is chosen when the invitation is sent: the
invitation services (`inviteByEmail`, `inviteManyByEmail`, `registerCompany`, `createSentInvitation`)
take an optional `locale` (one that's offered: they refuse another), by default Adiutor's default
language, and a resend keeps the invitation's language. `registerUser` takes an optional `locale` too; without one the new account
is on Default. The forms ask for it (**Email language**): Add user and Add company
start on Default (no `locale`), the invite form on the sender's language.
Scripts and the hourly job have no request: their emails use the recipient's or the invitation's
language, else Adiutor's default language (`pnpm db:seed` sends its invitations in English (US)).

## Which time zone

An email that shows a time (a security notice's "When", an invitation reminder's expiry) shows it in
its recipient's zone and names the zone ("Oct 23, 2026, 4:05 PM CEST"), since the reader may be
elsewhere by then: the zone they saved (`user.time_zone`); for an invitation to someone without one,
the zone of whoever sent it (`invitation.time_zone`, the sender's zone when it was sent, or the link
creator's for an invite link); else Adiutor's default zone (the `staff.default_time_zone` setting, UTC
until it's chosen). `recipientTimeZone` (`src/server/recipient-time-zone.ts`) is that rule; an
invitation nobody sent (setup, the seeds) has no zone of its own.

| Email               | Time zone                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Security notices    | The recipient's, looked up by ID; a deleted account's is read before the deletion and passed in             |
| Invitation reminder | The invitee's own when they have an account with a zone, else the invitation's (its sender's), else default |

## Logo

Emails link to `{app URL}/brand/logo.png` instead of attaching it. Clients that block
remote images show the alt text "Adiutor" (`emails.layout.logoAlt`) instead. `src/emails/static/logo.png` is a copy for the
template preview, and a test keeps the two identical.

## Previewing and seeing sent emails

- **Preview templates:** `pnpm email:dev` opens React Email's preview at <http://localhost:3001>.
  It lists every template with its example data and reloads as you edit.
- **See sent emails:** `pnpm services:up` also starts [Mailpit](https://mailpit.axllent.org). It
  catches everything sent to `SMTP_URL=smtp://localhost:1025` (the default in `.env.example`) and shows
  it at <http://localhost:8025>: HTML, plain text, source, links and an HTML compatibility check.
  Nothing is delivered to real inboxes. Mailpit is a development tool only; the app has no special
  code for it.

## How emails leave the app

In `src/lib/email.ts`, in order:

- `EMAIL_OUTBOX_DIR` set: written there as JSON (the end-to-end tests read them)
- `SMTP_URL` set: sent over SMTP (Mailpit in development, your provider in production, with
  `EMAIL_FROM` as the sender). A whole send takes at most 15 seconds (`SEND_TIMEOUT_MS` in
  `src/lib/email-limits.ts`, counted from the call, so waiting for a free connection counts): after
  that it fails like any other send,
  so a mail server that hangs fails one email (which a queued job tries again) instead of holding a
  request or the background jobs' tick until the platform stops it; the tick's own deadline is
  worked out from it (see [the limits](jobs.md#failures)). The mail server may still accept an
  email after its send was given up, so a job that tries again can send it twice. Each step also has
  a limit (`SMTP_TIMEOUTS`: 10 seconds to connect, 10 for the greeting, 20 of silence, instead of
  nodemailer's minutes), which closes the connection of a send that was given up; settings in
  `SMTP_URL` still win
- neither, with `NODE_ENV` set to `development` or `test`: the plain text is printed to the
  server console
- neither, anywhere else (production, or a script without `NODE_ENV`): sending fails, so links
  never end up in logs. A production server in that state says so in its log when it starts
  (`src/server/email-check.ts`, run by `register` in `src/instrumentation.ts`), so it isn't found
  out only when someone's sign-in link doesn't arrive
- `EMAIL_OUTBOX_DIR` is refused in production unless `E2E_TESTS=1` (the end-to-end tests)

A failed send is logged with `sendFailureOf` (also in `src/lib/email.ts`): only nodemailer's error code
and the SMTP reply code, never the error itself, because a mail server's refusal can quote the
address.

Services render and send an email only once their transaction has committed, never while it holds
its locks: a refused or rolled-back change sends nothing, and nothing waits on those locks while
React renders. Invitations return a `renderEmail` function for that (`createInvitationRecord` in
`src/server/people/invitations/record.ts`), which the caller calls next to `ctx.sendEmail`.
