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
  or IP address (`notifyStaffAdminAdded` in `src/server/people/staff-admin-notice.ts`)
- `job-failing.tsx` for the staff Admins when a background job keeps failing, with the error's
  reference and a link to it under Logs → Errors, at most once a day per job (`alertStaffAdmins` in
  `src/server/jobs/alerts.ts`, see [Background jobs](jobs.md#failures))
- `invitation.tsx`, `invitation-reminder.tsx`, `invite-link-confirmation.tsx`,
  `added-to-company.tsx`, `already-member.tsx` and `already-invited.tsx` for companies
  (`already-invited.tsx` goes to someone who claimed an invite link while their address already has
  an open invitation there that someone sent, which the claim keeps: it points to the earlier
  invitation email and links to the sign-in page)

Each exports the template, example `PreviewProps` and a builder that returns the email to send.

Every template's props extend `EmailBaseProps` (`appUrl`, `locale`, `logoSrc`) from
`src/emails/base-props.ts`, and its `PreviewProps` start with `...PREVIEW_BASE` (the Adiutor app URL,
English (US) and the preview logo). Every builder takes the recipient's `locale` with the props:
the text, the subject (from the same messages), dates (`formatDateTime` with the locale, in UTC) and
the document's `lang` follow it. The text lives in the `emails` catalogue, one group per template
(`emails.invitation.subject`, `.heading`, ...), and templates read it with
`translator(locale, 'emails.<name>')`, so they render outside Next.js too (scripts, the hourly job);
see [Emails](i18n.md#emails). Templates share the frame and building blocks in
`src/components/email/`:

- `EmailLayout`: the logo, the white card and a footer that says why the email was sent, with
  `<html lang>` set to the locale
- `EmailButton`, `EmailHeading`, `EmailParagraph`, `EmailNote`, `EmailCode` (a one-time code in
  a monospace box) and `LinkFallback`
- `RoleSummary`, which names the role and what it can do from the `roles` catalogue
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
it wasn't them are `select`s on the kind (`reason`, `ifNotYou`). The messages' `{provider}`, `{role}`
and `{company}` come from the `provider`, `role` (a role ID, named in the recipient's language) and
`company` options of `sendSecurityNotice` (`src/server/auth/security-notices.ts`), with a stand-in
("A provider", "a new role", "your company") when one is missing; `{name}` and `{staff}` (the staff
member, and the name the staff are shown with to users) come from `staffMember` and `staffName`
("A staff member", "Adiutor"), and `{minutes}` is how long signing in as someone lasts
(`IMPERSONATION_MINUTES`). The email names the device
and IP address only when the caller passes `showDevice: true`, which it does only for changes the
recipient made themselves (see [Security emails](authentication.md#security-emails)). Every kind
links to the Security page except `account_deactivated` and `account_deleted`, whose recipients
can't use it. `impersonation_started` links to its "Sign-ins by staff" card (`#staff-sign-in`,
`NOTICE_SECTIONS`), where the user can turn it off, as the email says.

## Which language

An email is written in its recipient's language: the one they saved (`user.locale`); for someone
on Default (none saved) or without an account, Adiutor's default language
(`staff_settings.default_locale`); failing that (before setup), English (US). `recipientLocale`
(`src/server/recipient-locale.ts`) is that rule. The language of whoever caused the email doesn't
count: a staff Admin browsing in Dutch doesn't send a user on Default a Dutch notice. Only emails
someone asks for themselves follow the language their browser shows: an invite link's confirmation
(`requesterLocale`, which reads `ServiceContext.requestLocale`), and, for an account on Default,
the sign-in link, password reset and verification (`emailLocale` in `src/lib/auth.ts`: the language
cookie, else Adiutor's default).

| Email                                                                  | Language                                                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in link, password reset, verification, code                       | The user's, else the request's (`emailLocale` in `src/lib/auth.ts`; the sign-in link works it out before the lookup that runs after the response) |
| Security notices                                                       | The recipient's, looked up by ID or address; a deleted account's is read before the deletion and passed in (`locale`)                             |
| Invitation, its resends and its reminder                               | The invitation's (`invitation.locale`), or the invitee's own when they have an account with a saved language                                      |
| Invite-link confirmation, "already invited"                            | The language of whoever opened the link, which the invitation it turns into keeps                                                                 |
| "Already a member", added to a company, staff Admin, job keeps failing | Each recipient's own                                                                                                                              |
| Welcome (Add user)                                                     | The language given for the new user, which is saved as theirs; for Default, Adiutor's default language                                            |

`invitation.locale` (NOT NULL, `en-US` by default) is chosen when the invitation is sent: the
invitation services (`inviteByEmail`, `inviteManyByEmail`, `registerCompany`, `createSentInvitation`)
take an optional `locale`, by default Adiutor's default language, and a resend keeps the
invitation's language. `registerUser` takes an optional `locale` too; without one the new account
is on Default. The forms ask for it (**Email language**): Add user and Add company
start on Default (no `locale`), the invite form on the sender's language.
Scripts and the hourly job have no request: their emails use the recipient's or the invitation's
language, else Adiutor's default language (`pnpm db:seed` sends its invitations in English (US)).

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
  `EMAIL_FROM` as the sender)
- neither, with `NODE_ENV` set to `development` or `test`: the plain text is printed to the
  server console
- neither, anywhere else (production, or a script without `NODE_ENV`): sending fails, so links
  never end up in logs
- `EMAIL_OUTBOX_DIR` is refused in production unless `E2E_TESTS=1` (the end-to-end tests)

A failed send is logged with `sendFailureOf` (also in `src/lib/email.ts`): only nodemailer's error code
and the SMTP reply code, never the error itself, because a mail server's refusal can quote the
address.

Services render and send an email only once their transaction has committed, never while it holds
its locks: a refused or rolled-back change sends nothing, and nothing waits on those locks while
React renders. Invitations return a `renderEmail` function for that (`createInvitationRecord` in
`src/server/people/invitations/record.ts`), which the caller calls next to `ctx.sendEmail`.
