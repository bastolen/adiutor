# Email

The email templates, how to preview them and see what was sent, and how emails leave the app.
Back to the [documentation](README.md).

Emails are built with [React Email](https://react.email) and sent as HTML with a plain-text version.

## Templates

One file per email in `src/emails/`:

- `magic-link.tsx`, `reset-password.tsx`, `verify-email.tsx`, `two-factor-code.tsx`,
  `account-created.tsx` and `security-notice.tsx` for accounts
- `staff-admin-added.tsx` for the staff Admins when someone else becomes one (given the role, or
  by an invitation or invite link), naming the new Admin and who made it happen, without a device
  or IP address (`notifyStaffAdminAdded` in `src/server/people/staff-admin-notice.ts`)
- `invitation.tsx`, `invitation-reminder.tsx`, `invite-link-confirmation.tsx`,
  `added-to-company.tsx`, `already-member.tsx` and `already-invited.tsx` for companies
  (`already-invited.tsx` goes to someone who claimed an invite link while their address already has
  an open invitation there that someone sent, which the claim keeps: it points to the earlier
  invitation email and links to the sign-in page)

Each exports the template, example `PreviewProps` and a builder that returns the email to send.

Every template's props extend `EmailBaseProps` (`appUrl`, `logoSrc`) from `src/emails/base-props.ts`,
and its `PreviewProps` start with `...PREVIEW_BASE` (the Adiutor app URL and the preview logo).
Templates share the frame and building blocks in `src/components/email/`:

- `EmailLayout`: the logo, the white card and a footer that says why the email was sent
- `EmailButton`, `EmailHeading`, `EmailParagraph`, `EmailNote`, `EmailCode` (a one-time code in
  a monospace box) and `LinkFallback`
- `RoleSummary`
- the colours and fonts in `theme.ts` (`fontFamily`, `monoFontFamily`), which match the app's
  light theme as inline styles

`security-notice.tsx` is one template with a wording per kind (`SECURITY_NOTICE_KINDS`): a changed or
added password, two-step verification, backup codes, passkeys and connected GitHub or Google accounts,
an MFA reset, signing out everywhere, deactivating, reactivating and deleting an account, staff role
changes, a changed company role and a removal from a company, and the pauses after too many wrong
passwords (`password_sign_in_paused`) or codes (`two_factor_locked`). The wording has the
placeholders `{provider}`, `{role}` and `{company}`, filled from the `provider`, `role` and `company`
options of `sendSecurityNotice` (`src/server/auth/security-notices.ts`). The email names the device
and IP address only when the caller passes `showDevice: true`, which it does only for changes the
recipient made themselves (see [Security emails](authentication.md#security-emails)). Every kind
links to the Security page except `account_deactivated` and `account_deleted`, whose recipients
can't use it.

## Logo

Emails link to `{app URL}/brand/logo.png` instead of attaching it. Clients that block
remote images show the alt text "Adiutor" instead. `src/emails/static/logo.png` is a copy for the
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

Services render and send an email only once their transaction has committed, never while it holds
its locks: a refused or rolled-back change sends nothing, and nothing waits on those locks while
React renders. Invitations return a `renderEmail` function for that (`createInvitationRecord` in
`src/server/people/invitations/record.ts`), which the caller calls next to `ctx.sendEmail`.
