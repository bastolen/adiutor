# Email

The email templates, which language each email is written in, how to preview them and see what
was sent, and how emails leave the app. Back to the [documentation](README.md).

Emails are built with [React Email](https://react.email) and sent as HTML with a plain-text version.

## Templates

One file per email in `src/emails/`:

- `magic-link.tsx`, `reset-password.tsx`, `verify-email.tsx`, `two-factor-code.tsx`,
  `account-created.tsx` and `security-notice.tsx` for accounts
- `staff-admin-added.tsx` for the staff Admins when someone else becomes one (given the role, by
  an invitation or invite link, or by the reactivation of an account that kept the role), naming
  the new Admin and who made it happen, without a device
  or IP address (`notifyStaffAdminAdded` in `src/server/people/staff-admin-notice.ts` queues one
  `staff-admin-added` job per Admin; see [Background jobs](jobs.md#queued-jobs))
- `webhook-turned-off.tsx` for the staff Admins when Adiutor turned a webhook off (its deliveries
  failed for days, its receiver is gone, or its address or secret can't be read), naming the
  webhook and why, never its address, with a link to it (one `webhook-turned-off` job per Admin;
  see [Retries and turning off](webhooks.md#retries-and-turning-off))
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
  anyone at the company), and for someone who is put on one (assigned, mentioned, subscribed
  by someone else, or having it raised for them by a staff member, with its description): one
  email per person and request with everything that happened, each reply in full
  (`EmailMarkdown`) with the names and sizes of its files (never attached or linked), the statuses
  in the reader's words, the request's number as its first link
  (opening the request at the first news the email tells of, with its `#entry-<ID>` anchor)
  and a subject without words of its own, the request's number and title, and a footer that links
  to the account's setting that turns them off (the `request-update` jobs, batched; see
  [Emails](requests.md#emails)). Its links are the reader's own, which sign them in for 14 days
  (see [Links in emails about requests](authentication.md#links-in-emails-about-requests)), and a
  note says not to forward it. When it tells an Admin or Client of a solution they may answer,
  Approve (the main button) and Deny (`EmailButton`'s `secondary` variant) take the place of
  "Open request": links of their own that answer once without signing in, made by the job as it
  sends the email ([Solutions](requests.md#solutions),
  [decision 0033](decisions/0033-solutions-the-company-approves.md))
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
`translator(locale, 'emails.<name>')`, so they render outside Next.js too (scripts, background jobs);
see [Emails](i18n.md#emails). Templates share the frame and building blocks in
`src/components/email/`:

- `EmailLayout`: the logo, the white card and a footer that says why the email was sent and who
  sent it (`emails.layout.sentBy`, "Sent by" and the staff's name, linked to the app), with
  `<html lang>` set to the locale. Once the staff have a name of their own (`poweredByShown`), a
  last small line says "Powered by Adiutor" (`emails.layout.poweredBy`), without a link, in the
  plain text too
- `EmailButton`, `EmailHeading`, `EmailParagraph`, `EmailNote`, `EmailCode` (a one-time code in
  a monospace box) and `LinkFallback`
- `RoleSummary`, which names the role and what it can do from the `roles` catalogue
- `EmailMarkdown`, which shows a request's description or reply formatted, from the tree the
  request's page renders, so the rules for what someone else wrote hold in an email too (see
  [Text people write](security-measures.md#text-people-write)): headings below the email's own,
  lists, tables (in columns in the email's plain text), quotes and code without colours, images
  as links, the people it mentions by name, and the plain text for a text stored as plain text or
  too costly to format. Given the email's `appUrl`, it shows a link to one of the staff's pages as
  its text, as the page does, also in such a plain text (`staffLinksAsLabels`); an internal note,
  for the staff only, gets none and keeps them
- the fonts in `theme.ts` (`fontFamily`, `monoFontFamily`): the device's own, not the Inter and
  JetBrains Mono the app ships, because many email clients block or strip web fonts
- the colours, which are the brand colours a staff Admin chose (decision 0049). `theme.ts` has
  `EmailColours`, `DEFAULT_EMAIL_COLOURS` (the app's light theme, which is what an email has when
  nothing was chosen) and `emailColoursOf` (the light palette of `derivePalette`; emails have no
  dark mode). A template works its colours out once, `const colours = emailColours(brand)`
  (`theme.ts`), and passes them to every block as the required `colours` prop (`EmailButton`,
  `EmailCode`, `EmailHeading`, `EmailMarkdown`, ...); `EmailLayout` takes `brand` itself. Nothing in
  an email is a fixed colour, and the styles that use colours are functions of them
  (`paragraph(colours)`, `small(colours)`). There is no React context or hook: emails are bundled
  into server code (the jobs and the instrumentation), where React has none, and ESLint refuses
  them in `src/emails` and `src/components/email`

Every send passes `brand` in the template's props (`EmailBaseProps.brand`, an `EmailBrand`: the
colours, `name`, the staff's name, which the email's text shows instead of "Adiutor", decision
0050, and `logo`, the logo a staff Admin uploaded, decision 0052): `loadEmailBrand(db)` in
`src/server/branding/email-brand.ts` reads the saved colours, the staff's name and the logo when
the email is built and falls back to Adiutor's own when they can't be read, so a mail still goes
out. A job that sends several emails
in a run loads it once. The Better Auth callbacks in `src/lib/auth.ts` import it next to their
template, inside the callback. An invitation's `renderEmail(brand)` takes it, so it's rendered after
the transaction commits. The template preview has no `brand`, so it shows the defaults.

### The staff's name

No email names Adiutor in its text ([decision 0050](decisions/0050-the-staffs-name-instead-of-adiutor.md)): every message that names the service takes the staff's name as
its `{staff}` argument, from `emailName(brand)` (`theme.ts`; Adiutor's own without a brand, as in
the preview and before setup names the staff), in the template and in its builder's subject. The
logo's alt text is the name too. The one exception is the footer's "Powered by Adiutor", shown
only once the name isn't Adiutor's own: with the name left as "Adiutor", an email reads as it
always did, without that line. A template never takes the name as a prop of its own (the welcome
email and the security notices once did): `brand` is the one source.

The name may be a team's ("Acme Support", "The Service Desk"), so the messages are written to read
right with any name, in every language:

- nothing right before the name: no article and no possessive. "Your account on {staff}", never
  "your {staff} account" or "an {staff} account"; in Dutch "je account bij {staff}", never "je
  {staff}-account"; in Spanish "tu cuenta en {staff}", never "tu cuenta de {staff}"
- the name is never part of a compound ("{staff} staff", "{staff}-wachtwoord") or a possessive
  ("{staff}’s"), and is never translated or declined
- it appears once in a sentence: a staff member who signed in as someone is "{name} from {staff}"
  and "signed in as you", without "to {staff}" after it
- what the software does itself has no name as the one who did it: a webhook "was turned off
  automatically", not "{staff} turned it off", which would read as if someone on the staff had

An invitation can be to the staff itself, whose name is then the company's as well, so the
invitation emails (`invitation`, `invitationReminder`, `inviteLinkConfirmation`, `alreadyMember`,
`alreadyInvited`) take a `target` prop (`InviteTarget`: `company` or `staff`) and their messages
choose a sentence with `{target, select, staff {…} other {…}}`: "join Acme Support as Manager"
for the staff, "join Beta on Acme Support as Client" for a company, never "join Acme Support on
Acme Support". `createInvitationRecord` passes `staff` for an invitation without a company, and
so does the reminder job (`invitation-reminders`), which names the staff by the brand's name where
it needs the staff's name for a company's.

The staff's name never stands in for a person either. When whoever sent an invitation or added
someone to a company has no account any more by the time the email goes out, the reminder
(`inviterName`) and the "added to a company" email (`adderName`) get `null`, and their messages
choose a sentence that names nobody (`{by, select, none {…} other {…}}`): "You're invited to join
Acme Support as Manager", "You were added to Beta on Acme Support as Client".

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
`{role}` (named in the recipient's language), `{company}` from the company and `{name}` from the staff
member; `{staff}` is the brand's name, as in every email. The notice to a deleted account,
sent straight away (`sendAccountDeletedNotice`), names none of them. Each has a stand-in ("A provider", "a new role",
"your company", "A staff member") when it's missing, and `{minutes}` is how long signing
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
Scripts and background jobs have no request: their emails use the recipient's or the invitation's
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

Emails link the logo instead of attaching it (`emailLogo` in `EmailLayout`): the one a staff
Admin uploaded at `{app URL}/branding/logo?v=<id>`, a PNG Adiutor drew, shown 32 pixels high and
at most 200 wide ([decision 0052](decisions/0052-the-staffs-logo-and-the-icon-made-from-it.md)),
or Adiutor's `{app URL}/brand/logo.png` in its 140×32 box. The address is public, as mail clients
fetch it without a session, and changes with every upload. Clients that block remote images show
the alt text, the staff's name (`emails.layout.logoAlt`), instead. `src/emails/static/logo.png` is
a copy of Adiutor's for the template preview.

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
- `SMTP_URL` set: sent through the mail server the server's environment names (Mailpit in
  development, your provider in production), which the Mail server card of Settings then only
  shows
- otherwise the mail server saved on the Mail server card of Settings › Connections
  (`email.smtp`, its password encrypted with the auth secret and decrypted here; see
  [Sending email](deploying.md#sending-email)). It's read on each send, and its transport is kept
  while the setting stays the same, so a save takes effect at once, also in the background jobs.
  Only this case loads the settings (through `import()`), so `SMTP_URL` alone works as before

Over SMTP the sender is `EMAIL_FROM` when it's set, else the one saved with the mail server, else
`Adiutor <no-reply@adiutor.dev>` (`DEFAULT_EMAIL_FROM` in `src/lib/smtp.ts`). A whole send takes
at most 15 seconds (`SEND_TIMEOUT_MS` in
`src/lib/email-limits.ts`, counted from the call, so waiting for a free connection counts): after
that it fails like any other send,
so a mail server that hangs fails one email (which a queued job tries again) instead of holding a
request or the background jobs' tick until the platform stops it; the tick's own deadline is
worked out from it (see [the limits](jobs.md#failures)). The mail server may still accept an
email after its send was given up, so a job that tries again can send it twice. Each step also has
a limit (`SMTP_TIMEOUTS`: 10 seconds to connect, 10 for the greeting, 20 of silence, instead of
nodemailer's minutes), which closes the connection of a send that was given up; settings in
`SMTP_URL` still win. Without any mail server:

- with `NODE_ENV` set to `development` or `test`: the plain text is printed to the server console
- anywhere else (production, or a script without `NODE_ENV`): sending fails, so links
  never end up in logs. A production server in that state says so in its log when it starts
  (`src/server/email-check.ts`, run by `register` in `src/instrumentation.ts`), so it isn't found
  out only when someone's sign-in link doesn't arrive
- `EMAIL_OUTBOX_DIR` is refused in production unless `E2E_TESTS=1` (the end-to-end tests)

`sendThrough` sends one email through a given mail server rather than the one in use, on a
connection of its own that it closes afterwards, with the same time limits: the Mail server card tries a
mail server with it before saving, and tells every staff Admin of a change through the server
it replaced (see [Sending email](deploying.md#sending-email)). With an outbox, it writes there too.

A failed send is logged with `sendFailureOf` (also in `src/lib/email.ts`): only nodemailer's error code
and the SMTP reply code, never the error itself, because a mail server's refusal can quote the
address.

Services render and send an email only once their transaction has committed, never while it holds
its locks: a refused or rolled-back change sends nothing, and nothing waits on those locks while
React renders. Invitations return a `renderEmail` function for that (`createInvitationRecord` in
`src/server/people/invitations/record.ts`), which the caller calls next to `ctx.sendEmail`.
