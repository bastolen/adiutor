# 0035. Links in emails about requests sign the recipient in

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

The button in an email about a request ([decision 0031](0031-emails-about-requests.md)) only
opened the page: someone signed out signed in first, and anyone with MFA then confirmed on the
step-up page ([decision 0003](0003-who-needs-mfa-and-what-counts.md)). That's several steps
between an email and a reply. The email already goes to the account's own address, the inbox that
email links and password resets use.

## Decision

How it works is in [Links in emails about requests](../authentication.md#links-in-emails-about-requests).
The choices behind it:

- **The link signs its recipient in, for every role,** with a normal 7-day session that isn't
  sent to the step-up page (`fromRequestLink`, `mustStepUp`), the MFA roles included.
- **It proves no second step:** the session opens no window for changing sign-in methods and never
  counts as a fresh sign-in (`signedInAtOf`), so everything that needs a recent confirmation
  ([decision 0004](0004-recent-confirmation-for-sign-in-changes-and-lasting-access.md)) asks for it
  straight away: new ways in, grants, signing in as a user.
- **Used again and again, for 14 days,** like a trusted device: it ends whenever trusted devices
  are forgotten (`forgetSecondStepSkips`) and signs in only while its person can read the request.
- **Only a person's click signs in** (`Sec-Fetch-User: ?1`); a scanner, someone else signed in in
  the browser, or a link that no longer works gets the confirmation page.
- **Anyone with the email can use it.** The email says so. A forwarded email lets the reader in as
  the recipient, as a forwarded sign-in link always did, now for longer.

## Consequences

- A leaked mailbox gives a session without the second step for 14 days, also for staff Admins,
  Managers and company Admins, who can then manage people (but not add ways in or grant roles).
  The device list marks these sessions ("Email link"), signing out everywhere ends the links, and
  each sign-in is in the audit log.
- A link someone sends you for their own account signs you in as them when nobody is signed in
  in that browser: unlike an email link, there's no click on a page that names the account
  first. The app's header names who is signed in.
- Every new step-up rule must keep counting a link session as unconfirmed.
- Each email makes a link row; the hourly `expired-sign-in-data` job deletes ended ones.

## Alternatives considered

- **Only the roles that don't require MFA:** the staff and company Admins, often the ones on a
  request, would still face the step-up page.
- **Sessions limited to requests:** every service and page would need a new kind of session check.
- **One use per link, or a click on the confirmation page every time:** a second click would undo
  what was asked for, and mail apps that open links in a webview would use links up.
- **Only browsers the person signed in on before:** needs a lasting cookie that outlives signing
  out, and the first click on a new phone wouldn't sign in.
