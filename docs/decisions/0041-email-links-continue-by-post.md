# 0041. Email links continue only from their own page, by a POST

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

A sign-in email opens a confirmation page (`/auth/email-link`) whose "Continue signing in" opened
Better Auth's link (`GET /api/auth/magic-link/verify`). The guards let that `GET` sign in when it
was a same-origin click (`Sec-Fetch-User: ?1`) or carried no Fetch Metadata at all. WebKit never
sends `Sec-Fetch-User` ([decision 0038](0038-request-links-continue-by-themselves.md)), so in
Safari and on every iPhone the Continue came back to the page forever. Both ways through were also
too wide: browsers without Fetch Metadata (Safari before 16.4, plain `http` away from `localhost`)
skipped the page, and a link to the endpoint written in a reply is a same-origin click, so a
company user could post a fresh link of their own and switch a staff reader into their account
without the page that names it.

## Decision

How it works is in [Email links](../authentication.md#email-links).

- **The Continue is a form `POST` that only the page makes,** taken by the request link's rule
  (`isOwnPagePost`: a same-origin page load, or the site's exact `Origin` where the browser sends
  no Fetch Metadata, [decision 0040](0040-older-browsers-continue-by-origin.md)), without a click
  header.
- **Every `GET` of the link goes to the page, whatever its headers,** unused, and so does any
  other `POST`.
- **The `POST` uses Better Auth's own handler** (`magicLinkVerify`, called by the app's plugin at
  the same path, `src/lib/sign-in/email-link-plugin.ts`), so the link is used and the sign-in made
  and recorded as before.
- **The page still waits for a click:** unlike a request link's, it never continues by itself.

This applies 0038's Continue and 0040's `Origin` check to email links; it supersedes neither.

## Consequences

- Safari and iPhones can use email links again; elsewhere nothing changes.
- A link written in a reply, an old email's direct link or a crafted one always shows the page
  first.
- Browsers that send neither Fetch Metadata nor `Origin` on a form `POST` can't use the Continue.
- The plugin relies on Better Auth's `magicLinkVerify` and on calling an endpoint as a plain
  function; `request-checks.int.test.ts` runs the whole handler, so an upgrade that breaks either
  fails there.

## Alternatives considered

- **A one-time nonce in the page's form, checked on the `GET`:** needs storage per page view and
  keeps a `GET` that a link can make once the nonce leaks.
- **Copy Better Auth's verify into the app,** as the request link's plugin makes its session: an
  upgrade could change its checks silently.
- **A server action calling `auth.api`:** Better Auth's per-IP limit runs only for its HTTP
  endpoints.
