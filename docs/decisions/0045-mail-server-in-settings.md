# 0045. The mail server in Settings, unless the environment names one

- **Status:** Accepted
- **Date:** 2026-11-25

## Context

Adiutor sends sign-in links, password resets, invitations, security notices and the emails about
requests. Until now only the server's environment named the mail server (`SMTP_URL`, `EMAIL_FROM`),
so an operator had to redeploy to change it, and a fresh install sent nothing until they did.
Attachments had just made storage a setting staff Admins choose, with the environment able to lock
it ([decision 0044](0044-attachments.md)).

A mail server is more sensitive than a storage: whoever controls it can read every sign-in link and
emailed code Adiutor sends, so changing it is a way to take over accounts.

## Decision

How to set it up is in [Deploying](../deploying.md#sending-email). The choices behind it:

- **Staff Admins set it on the Email tab of Settings, and the environment wins:** `SMTP_URL` names
  the mail server and `EMAIL_FROM` the sender; set, the tab only shows them. One setting
  (`email.smtp`) holds the server, its login and the sender.
- **The password is sealed like other secrets** (`sealSecret`, with the versioned auth secrets),
  never sent back to a browser, and kept only for the server, port and username it was saved for.
- **A mail server is tried before it's saved:** a test email goes through it to the staff Admin
  saving it, and a failure names its kind only (`checkBeforeSaving`, `smtpFailureOf`), never the
  server's reply.
- **Saving needs a recent second step, is audited, and tells every staff Admin,** the one saving
  it too (it may not have been them, and a lone staff Admin is told as well), straight away through
  the mail server it replaces, which the new one can't hold back, one at a time. When there was
  none, or it fails, the emails left are queued and go through the new one (`src/server/smtp/`).
- **Sending reads the setting on each send** (`src/lib/email.ts`) and keeps its transport while
  the setting is unchanged, so a save takes effect at once, also in the jobs; with `SMTP_URL` set,
  nothing is read.

## Consequences

- A staff Admin can make the server connect to any host it reaches, as with storage. An operator
  who doesn't want that sets `SMTP_URL`.
- Rotating the auth secret holds for the password, as for other sealed secrets: keep the old
  version until the mail server has been saved again.
- The notice through the previous server is a second email sent straight away rather than queued,
  next to the one to a deleted account's address.
- In development and the tests without `SMTP_URL`, sending reads the settings from the database.

## Alternatives considered

- **The environment only:** nothing new to secure, but every change is a redeploy, and a fresh
  install can't send its first invitation without one.
- **Queuing the notice like every other:** it would go through the new mail server, which a
  malicious change controls.
- **Testing by connecting and signing in only:** quicker, but a refused sender would only show up
  on the first real email.
