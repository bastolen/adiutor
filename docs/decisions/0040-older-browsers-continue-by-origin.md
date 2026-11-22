# 0040. Older browsers' Continue is checked by its Origin

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

A request link's confirmation page signs in only with its own Continue, a form `POST` that
`fromConfirmationPage` tells by its Fetch Metadata: `Sec-Fetch-Site: same-origin`,
`Sec-Fetch-Mode: navigate` and `Sec-Fetch-Dest: document`
([decision 0038](0038-request-links-continue-by-themselves.md)). WebKit sends none of these
headers before Safari 16.4, so there the Continue came back to the page every time, and the page
then waited for a click that came back too: such browsers couldn't open a request from its email
at all. Older iPhones and iPads that no longer update are among them. Browsers also send these
headers only to a secure address (`https`, or `localhost`), so an Adiutor served over plain
`http` on another host (in development: production refuses such an address,
`isProductionAppUrl`) had the same loop in every browser.

## Decision

How it works is in [Links in emails about requests](../authentication.md#links-in-emails-about-requests).

- **A `POST` with none of the three headers counts as the Continue when its `Origin` is exactly
  the site's own** (`new URL(appUrl).origin`, from `BETTER_AUTH_URL`). The page sends the site's
  origin (`referrer: strict-origin`), so its form names it.
- **Nothing else stands in for it:** no `Referer`, never `Origin: null`, never a missing `Origin`,
  and no prefix or pattern match.
- **A browser that sends any of the headers, even an empty one, is judged by them alone**, as
  before, whatever its `Origin`.
- **The rest stays:** the Continue the page sends by itself (`auto=1`) never switches from someone
  signed in, and a link (`GET`) is never a Continue.

This replaces 0038's consequence that such browsers can't use the Continue.

## Consequences

- `Origin` is the standard check against another site's form, and the one Better Auth's
  `formCsrfMiddleware` already applies to this `POST` when a browser sends no Fetch Metadata. No
  other site's page can make a browser send the site's origin.
- A program that isn't a browser can write the site's origin, just as it can write
  `Sec-Fetch-Site: same-origin`. That gives it nothing new: it has the link, which signs in
  anyone who has it ([decision 0036](0036-sign-in-links-in-request-emails.md)).
- On an Adiutor served over plain `http` on a host other than `localhost`, every browser's
  Continue is checked this way, not only older Safari's. That's as safe: it's the same exact
  `Origin` comparison, which no other site's page can pass.
- Browsers that send neither Fetch Metadata nor `Origin` on a form `POST` still can't use the
  Continue.

## Alternatives considered

- **Tell older Safari by its user agent:** any program can send it, and it would say nothing about
  where the `POST` came from.
- **Offer "Sign in instead" on the page after a retry:** it works everywhere, but those browsers
  would always sign in another way, the steps the link exists to save.
