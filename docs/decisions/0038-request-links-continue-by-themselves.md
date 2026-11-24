# 0038. Request links continue by themselves where the browser can't tell a click

- **Status:** Accepted. One consequence is replaced by
  [0040](0040-older-browsers-continue-by-origin.md): browsers that send none of the
  `Sec-Fetch-*` headers (Safari before 16.4) have their Continue checked by its `Origin`.
  [0041](0041-email-links-continue-by-post.md) makes a sign-in email's Continue a `POST` taken the
  same way (now `isOwnPagePost`).
- **Date:** 2026-11-22

## Context

The link in an email about a request signs a person's click in and sends anything else to a
confirmation page ([decision 0036](0036-sign-in-links-in-request-emails.md)), telling a click by
`Sec-Fetch-User: ?1`. WebKit never sends that header (WebKit bug 247697), so in Safari and every
browser on an iPhone or iPad each link stopped at the page, and its Continue, checked for the
header too, came back to it. Phones are where these emails are read most.

## Decision

How it works is in [Links in emails about requests](../authentication.md#links-in-emails-about-requests).

- **With nobody signed in in the browser, the page sends its Continue by itself**
  (`RequestLinkForm`): once per page load, only for a fresh navigation, never while prerendered.
- **The page's Continue needs no click header:** its form's `POST`, as a same-origin page load
  (`fromConfirmationPage`), which no link, other site, email or typed address can make. One that
  comes back to the page marks it (`retry=1`), so it waits for a click instead of looping.
- **Switching accounts stays a person's choice:** someone else signed in, a staff member signed in
  as a user, and a link that no longer works keep their button, and the Continue the page sends by
  itself (`auto=1`) never switches, even when someone signed in in another tab meanwhile. Approve
  and Deny keep their button too: they change a request.

This supersedes 0036's "Only a person's click signs in".

## Consequences

- Scanners that run a page's scripts sign in too. They gain nothing the link doesn't give anyone
  with the email; their sessions show in the devices ("Email link") and the audit log, and count
  toward the link's 10 sign-ins an hour.
- Merely visiting a page that sends the whole tab to `/auth/request-link?token=…` with someone's
  link signs a signed-out visitor in as that person, without a click (frames are refused). A link
  someone sends you for their own account does the same.
- Browsers that send no `Sec-Fetch-Site` (Safari before 16.4) still can't use the Continue
  (replaced by [0040](0040-older-browsers-continue-by-origin.md): a Continue with none of the
  `Sec-Fetch-*` headers counts by its `Origin`).

## Alternatives considered

- **Keep the button, letting only its Continue through:** one more step on phones.
- **Tell Safari by its user agent:** any program can send Safari's, and would sign in without
  running anything.
- **Trust `Sec-Fetch-Site: none`:** every visit from outside a page looks like that, typed
  addresses and links apps open to check them included.
